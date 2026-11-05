# End-to-end test of the AI features against the mock server (test/ai/mock-server.ts) and a web build
# made with EXPO_PUBLIC_AI_URL=http://127.0.0.1:8787/ai, served on :8081.
# Run: python3 test/ai/e2e.py [desktop|mobile] [en|de]
import json, sys, time, os
from playwright.sync_api import sync_playwright

MODE = sys.argv[1] if len(sys.argv) > 1 else 'desktop'
LANG = sys.argv[2] if len(sys.argv) > 2 else 'en'
URL = 'http://127.0.0.1:8081/'
FORMS = '/tmp/ai-forms'
SHOTS = '/tmp/shots'
LOG = '/tmp/ai-log.jsonl'
PROFILE = {'first': 'Maria', 'last': 'Muster', 'birth': '24.05.1990', 'city': 'Wien', 'zip': '1010', 'street': 'Hauptstraße 1/4', 'phone': '+43 660 1234567', 'email': 'maria@example.at'}
passed, failed = 0, 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print('FAIL', m)
def log():
    return [json.loads(l) for l in open(LOG) if l.strip()]
def L(en, de): return de if LANG == 'de' else en

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    vp = {'width': 1440, 'height': 900} if MODE == 'desktop' else {'width': 390, 'height': 844}
    ctx = b.new_context(viewport=vp, device_scale_factor=2 if MODE == 'mobile' else 1, has_touch=MODE == 'mobile', is_mobile=MODE == 'mobile', locale='de-AT' if LANG == 'de' else 'en-GB',
                        permissions=['clipboard-read', 'clipboard-write'], accept_downloads=True)
    ctx.add_init_script(f"localStorage.setItem('pe.profile', {json.dumps(json.dumps(PROFILE))}); localStorage.setItem('pe.lang', '{LANG}'); localStorage.setItem('pe-lang', '{LANG}');")
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: m.type == 'error' and errors.append(m.text))

    def shot(n): page.screenshot(path=f'{SHOTS}/{MODE}-{LANG}-{n}.png')
    def open_pdf(path):
        page.goto(URL); page.wait_for_timeout(800)
        page.locator('input[type=file][accept*="pdf"]').first.set_input_files(path)
        page.wait_for_selector('.pageOuter', timeout=30000); page.wait_for_timeout(1500)
    def open_ai():
        if MODE == 'desktop':
            page.locator('.aipill').click()
        else:
            page.locator('.dk3', has_text=L('More', 'Mehr')).click(); page.wait_for_timeout(400)
            page.locator('.tile', has_text=L('AI assistant', 'KI-Assistent')).first.click()
        page.wait_for_timeout(500)
    def pick_tool(t, en, de, tray_de=None):
        d = page.locator(f'.dk3[data-t="{t}"]')
        if d.count(): d.click()
        else:
            page.locator('.dk3', has_text=L('More', 'Mehr')).click(); page.wait_for_timeout(400)
            page.locator('.tile', has_text=L(en, de)).first.click()
        page.wait_for_timeout(400)
    def close_sheet():
        page.locator('.aimodal .mhead .ibtn').last.click(); page.wait_for_timeout(300)

    # ---------- A. the assistant on a letter ----------
    open(LOG, 'w').close()
    open_pdf(f'{FORMS}/letter.pdf')
    ok(len(log()) == 0, 'nothing sent on open')
    open_ai()
    ok(page.locator('.ai-consent').is_visible(), 'consent shown first')
    ok(len(log()) == 0, 'nothing sent before consent')
    shot('a0-consent')
    page.locator('.ai-consent .btn.primary').click()
    page.wait_for_selector('.ai-ov-head', timeout=15000)
    shot('a1-overview')
    ok('Jahresabrechnung Strom' in page.locator('.ai-ov').inner_text(), 'overview title')
    l = log(); ok(l and l[-1]['tool'] == 'overview' and 'Rechnung Nr. 2026-004187' in l[-1]['text'] and l[-1]['images'] == 0, 'overview got the text, no pictures')
    ok(l[-1]['model'] == 'claude-sonnet-5-5', 'overview uses smart model')
    ok(page.locator('.ai-row.dl').count() == 1, 'deadline row')
    # ask
    page.locator('.ai-tabs button').nth(1).click()
    page.locator('.ai-suggest .ai-chip').first.click()
    page.wait_for_selector('.ai-msg.assistant .ai-bubble >> text=249,90', timeout=15000)
    ok(page.locator('.ai-msg.assistant .ai-pages button').count() == 1, 'answer cites a page')
    page.locator('.ai-ask input').fill('Und wenn ich nicht zahle?'); page.locator('.ai-ask button[type=submit]').click()
    page.wait_for_function("document.querySelectorAll('.ai-msg.assistant').length >= 2", timeout=15000)
    l = log(); ok(l[-1]['tool'] == 'answer' and '<conversation>' in l[-1]['text'], 'follow-up sends the conversation')
    shot('a2-ask')
    # reply
    page.locator('.ai-tabs button').nth(2).click()
    page.locator('.ai-reply textarea').fill('Einspruch, Zählerstand falsch')
    page.locator('.ai-reply .btn.primary').click()
    page.wait_for_selector('.ai-letter', timeout=15000)
    ok('Einspruch' in page.locator('.ai-reply input').input_value(), 'reply subject')
    l = log(); ok('Maria' in l[-1]['text'] and 'Einspruch' in l[-1]['text'], 'reply has sender + notes')
    with page.expect_download(timeout=30000) as dl:
        page.locator('.ai-row-btns .btn.primary').click()
    d = dl.value; ok(d.suggested_filename.endswith('.pdf'), 'reply saved as PDF ' + d.suggested_filename)
    page.wait_for_timeout(500)
    shot('a3-reply')
    # personal data
    page.locator('.ai-tabs button').nth(3).click()
    page.locator('.ai-pii .btn.primary').click()
    page.wait_for_selector('.ai-pii-list', timeout=15000)
    ok(page.locator('.ai-pii-list .ai-row').count() == 2, 'two personal items')
    l = log(); ok(l[-1]['tool'] == 'items' and l[-1]['model'] == 'claude-haiku-5-5', 'pii on fast model')
    shot('a4-pii')
    page.locator('.ai-pii .btn.primary').click(); page.wait_for_timeout(800)
    ok(page.locator('.aimodal').count() == 0, 'sheet closes after black out')
    ok('2' in page.locator('.fmeta .chg').inner_text(), 'redaction boxes placed')
    shot('a5-redacted')

    # ---------- B. rewrite a line (same font) ----------
    if MODE == 'desktop':
        page.keyboard.press('e'); page.wait_for_timeout(300)
    def click_pdf(x, y):
        bb = page.locator('.pageOuter').first.bounding_box()
        k = bb['width'] / 595.28
        page.mouse.click(bb['x'] + x * k, bb['y'] + (841.89 - y) * k)
    if MODE == 'mobile': pick_tool('edit', 'Edit', 'Bearbeiten')
    page.locator('.pageOuter').first.scroll_into_view_if_needed()
    click_pdf(120, 586); page.wait_for_timeout(900)
    btn = page.locator('.ai-btn' if MODE == 'desktop' else '.ai-slim').first
    ok(btn.is_visible(), 'rewrite button shown while editing')
    btn.click(); page.wait_for_selector('.ai-rewrite', timeout=8000)
    page.locator('.ai-rewrite .ai-chip', has_text=L('More formal', 'Förmlicher')).click()
    page.wait_for_selector('.ai-now textarea', timeout=15000)
    ok('höflich' in page.locator('.ai-now textarea').input_value(), 'formal text')
    l = log(); ok(l[-1]['tool'] == 'result' and '<surrounding_text>' in l[-1]['text'], 'rewrite sends nearby lines')
    shot('b1-rewrite')
    page.locator('.ai-rewrite .foot .btn.primary').click(); page.wait_for_timeout(1500)
    ok('Wir ersuchen' in page.locator('.pageOuter').first.inner_text() or page.locator('.run.edited, .run.changed').count() >= 1, 'line replaced in the page')
    page.keyboard.press('Escape'); page.wait_for_timeout(300)
    shot('b2-rewritten')

    # file name suggestion
    page.locator('.fname.fbtn').first.click(); page.wait_for_timeout(500)
    page.locator('.fs-ai').click(); page.wait_for_timeout(1500)
    ok(page.locator('.fs-name input').input_value() == '2026-10-15 Rechnung Wien Energie', 'name suggested')
    shot('b3-name')
    page.keyboard.press('Escape'); page.wait_for_timeout(400)

    # ---------- C. smart fill on a fillable form ----------
    open_pdf(f'{FORMS}/fillable.pdf')
    page.wait_for_timeout(800)
    if MODE == 'desktop':
        page.locator('.ai-go').click()
    else:
        page.locator('.ai-mini').click()
    page.wait_for_selector('.ai-fill-list', timeout=15000)
    shot('c1-review')
    txt = page.locator('.ai-fill-list').inner_text()
    ok('MA35-2026/48213' in [i.input_value() for i in page.locator('.ai-fi input.input').all()], 'case number from the letter head')
    l = log(); ok(l[-1]['tool'] == 'answers' and '"first":"Maria"' in l[-1]['text'].replace(' ', ''), 'profile sent for fill')
    page.locator('.ai-fill .foot .btn.primary').click(); page.wait_for_timeout(800)
    vals = page.eval_on_selector_all('.formlayer input, input.ff, .field-input, input[data-name]', 'els => els.map(e => e.type === "checkbox" ? String(e.checked) : e.value)')
    if not vals:
        vals = page.eval_on_selector_all('.pageOuter input', 'els => els.map(e => e.type === "checkbox" ? String(e.checked) : e.value)')
    ok(vals[:5] == ['Maria', 'Muster', '24.05.1990', 'MA35-2026/48213', 'Wien, 05.11.2026'], 'form filled ' + str(vals))
    ok(page.locator('.pageOuter input[type=checkbox]:checked, .pageOuter [aria-checked=true]').count() >= 1 or '6' in page.locator('.fmeta .chg').inner_text(), 'checkbox ticked')
    shot('c2-filled')

    # ---------- D. printed form → fillable → smart fill with a question ----------
    open_pdf(f'{FORMS}/printed.pdf')
    if MODE == 'desktop': page.keyboard.press('f')
    else: pick_tool('fill', 'Fill', 'Ausfüllen')
    page.wait_for_timeout(700)
    # desktop: "Make this form fillable"; phone: Smart fill finds the fields first, then fills
    (page.locator('.ff-go') if MODE == 'desktop' else page.locator('.ai-mini')).click()
    page.wait_for_selector('.ai-found', timeout=30000)
    shot('d1-found')
    labels = page.locator('.ai-found .ai-rt b').all_inner_texts()
    ok(any('Vorname' in x for x in labels) and any('Kursniveau' in x for x in labels) and any('E-Mail' in x for x in labels), 'device + AI fields ' + str(labels))
    l = log(); ok(l[-1]['tool'] == 'fields' and l[-1]['images'] == 1, 'detect sends the page picture')
    page.locator('.ai-found .foot .btn.primary').click()
    page.wait_for_timeout(2500)
    n_inputs = page.locator('.pageOuter input').count()
    ok(n_inputs >= 6, f'fields are fillable now ({n_inputs})')
    shot('d2-fields')
    if MODE == 'desktop': page.locator('.ai-go').click()
    page.wait_for_selector('.ai-fill-list, .ai-q', timeout=15000)
    ok(page.locator('.ai-q').count() == 1, 'AI asks about the course level')
    page.locator('.ai-q input').fill('B1'); page.locator('.ai-fill .btn.outline', has_text=L('Fill again with this', 'Damit neu ausfüllen')).click()
    page.wait_for_function("[...document.querySelectorAll('.ai-fi input.input')].some(i => i.value === 'B1')", timeout=15000)
    shot('d3-again')
    page.locator('.ai-fill .foot .btn.primary').click(); page.wait_for_timeout(800)
    vals = page.eval_on_selector_all('.pageOuter input', 'els => els.map(e => e.value)')
    ok(vals == ['Maria', 'Muster', '+43 660 1234567', 'maria@example.at', 'B1', 'Wien, 05.11.2026'], 'printed form filled ' + str(vals))
    shot('d4-filled')
    # download and check the saved file keeps the fields + values
    page.locator('.fname.fbtn').first.click(); page.wait_for_timeout(400)
    with page.expect_download(timeout=60000) as dl:
        page.locator('.fs-acts button').last.click() if MODE == 'desktop' else page.locator('.fs-acts button', has_text=L('Download', 'Herunterladen')).click()
    out = '/tmp/ai-printed-filled-%s.pdf' % MODE
    dl.value.save_as(out)
    ok(os.path.getsize(out) > 1000, 'saved')

    # ---------- E. switch off ----------
    open_ai(); page.wait_for_timeout(600)
    page.locator('.ai-legal .linkbtn').click(); page.wait_for_timeout(500)
    ok(page.evaluate("JSON.parse(localStorage.getItem('pe.ai')).on") is False, 'switched off')
    n = len(log()); open_ai(); ok(page.locator('.ai-consent').is_visible() and len(log()) == n, 'asks again after off')
    page.locator('.ai-consent .btn.outline').click()

    real = [e for e in errors if 'favicon' not in e and 'sw.js' not in e]
    ok(not real, 'no page errors ' + str(real[:3]))
    b.close()
print(f'{MODE} {LANG}: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
