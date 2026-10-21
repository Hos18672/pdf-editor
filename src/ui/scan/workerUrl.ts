// Loads the scanner's worker script (public/scan/worker.js) and hands it out as a Blob URL: workers
// can't be started from file:// pages (Android app), Blob URLs work everywhere.
import { appBase } from '../assets';
import { WORKER_VERSION } from './workerVersion';

let url: Promise<string> | null = null;

export function workerUrl(): Promise<string> {
  url ??= new Promise<string>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('GET', `${appBase()}scan/worker.js?v=${WORKER_VERSION}`);
    x.responseType = 'text';
    x.onload = () => (x.status === 200 || (x.status === 0 && x.responseText)
      ? resolve(URL.createObjectURL(new Blob([x.responseText], { type: 'application/javascript' })))
      : reject(new Error('scan worker missing')));
    x.onerror = () => reject(new Error('scan worker missing'));
    x.send();
  }).catch((e) => { url = null; throw e; });
  return url;
}
