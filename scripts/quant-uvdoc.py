# Makes the scanner's AI model smaller for the app (15.8 MB -> about 8 MB): the weights are stored as
# 8-bit numbers with one scale per 64 weights (public/scan/uvdoc.q8), the graph itself without them
# (public/scan/uvdoc.onnx, which names them as external data "uvdoc.w"). The AI worker turns the
# 8-bit weights back into 32-bit floats before the model is loaded. The flattening grid moves by well
# under a pixel on average (checked on curled-page photos; run with --check).
#   python3 scripts/quant-uvdoc.py [--check photo.jpg ...]
import struct, sys, os
import numpy as np, onnx
from onnx import numpy_helper, TensorProto

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'scripts/models/uvdoc-fp16.onnx')
G = 64

m = onnx.load(SRC)
q8, scales, counts = [], [], []
offset = 0
for t in m.graph.initializer:
    a = numpy_helper.to_array(t)
    if a.dtype not in (np.float16, np.float32) or a.size < 1000:
        continue
    w = a.astype(np.float32).reshape(-1)
    n = w.size
    wp = np.concatenate([w, np.zeros((-n) % G, np.float32)]).reshape(-1, G)
    sc = (np.abs(wp).max(1, keepdims=True) / 127).astype(np.float16).astype(np.float32)
    sc[sc == 0] = 1
    q = np.clip(np.round(wp / sc), -127, 127).astype(np.int8)
    q8.append(q.reshape(-1)); scales.append(sc.reshape(-1).astype(np.float16)); counts.append(n)
    # the graph: a 32-bit tensor kept outside, at its place in the rebuilt weights
    dims = list(t.dims)
    t.Clear()
    t.name, t.data_type = t.name, TensorProto.FLOAT
    t.dims.extend(dims)
    t.data_location = TensorProto.EXTERNAL
    for k, v in (('location', 'uvdoc.w'), ('offset', str(offset)), ('length', str(n * 4))):
        e = t.external_data.add(); e.key, e.value = k, v
    offset += n * 4
# names were cleared with the rest: put them back from the original
orig = onnx.load(SRC)
names = [t.name for t in orig.graph.initializer if numpy_helper.to_array(t).dtype in (np.float16, np.float32) and numpy_helper.to_array(t).size >= 1000]
ext = [t for t in m.graph.initializer if t.data_location == TensorProto.EXTERNAL]
for t, nm in zip(ext, names):
    t.name = nm

out_graph = os.path.join(ROOT, 'public/scan/uvdoc.onnx')
onnx.save(m, out_graph)
# uvdoc.q8: "UVQ8", group size, tensor count, the count of each tensor, then all 8-bit weights
# (each tensor padded to whole groups), then all scales (16-bit floats)
with open(os.path.join(ROOT, 'public/scan/uvdoc.q8'), 'wb') as f:
    f.write(b'UVQ8'); f.write(struct.pack('<II', G, len(counts))); f.write(struct.pack(f'<{len(counts)}I', *counts))
    for q in q8: f.write(q.tobytes())
    for s in scales: f.write(s.tobytes())
print('graph', os.path.getsize(out_graph), 'weights', os.path.getsize(os.path.join(ROOT, 'public/scan/uvdoc.q8')), 'tensors', len(counts))

if '--check' in sys.argv:
    import onnxruntime as ort
    from PIL import Image
    imgs = sys.argv[sys.argv.index('--check') + 1:]
    # rebuild the weights as the worker does
    buf = open(os.path.join(ROOT, 'public/scan/uvdoc.q8'), 'rb').read()
    g, k = struct.unpack_from('<II', buf, 4); cs = struct.unpack_from(f'<{k}I', buf, 12)
    p = 12 + 4 * k; qs = []
    for n in cs:
        L = -(-n // g) * g; qs.append(np.frombuffer(buf, np.int8, L, p)); p += L
    ws = []
    for n, q in zip(cs, qs):
        L = -(-n // g) * g; s = np.frombuffer(buf, np.float16, L // g, p).astype(np.float32); p += L // g * 2
        ws.append((q.astype(np.float32).reshape(-1, g) * s[:, None]).reshape(-1)[:n])
    os.makedirs('/tmp/uvq', exist_ok=True)
    np.concatenate(ws).astype(np.float32).tofile('/tmp/uvq/uvdoc.w')
    onnx.save(onnx.load(out_graph, load_external_data=False), '/tmp/uvq/uvdoc.onnx')
    a = ort.InferenceSession(SRC, providers=['CPUExecutionProvider'])
    b = ort.InferenceSession('/tmp/uvq/uvdoc.onnx', providers=['CPUExecutionProvider'])
    for f in imgs:
        x = np.asarray(Image.open(f).convert('RGB').resize((488, 712), Image.BILINEAR), np.float32).transpose(2, 0, 1)[None] / 255
        ra, rb = a.run(None, {'img': x})[0], b.run(None, {'img': x})[0]
        d = np.abs(ra - rb) * 1000
        print(os.path.basename(f), 'grid moves (px on a 2000 px page): mean %.2f, max %.2f' % (d.mean(), d.max()))
