// The editor, tools and scanner, loaded together as one chunk after the start screen is up. What the
// start screen needs later (pdf-lib, converting, shared files) comes through here too, so all of it
// stays in this one chunk instead of being loaded with the start screen.
export { Editor } from './Editor';
export { Tools } from './Tools';
export { Scanner } from './scan/Scanner';
export { PDFDocument } from 'pdf-lib';
export { loadDoc, addImagePage, imageBytes, save } from './pdfops';
export { convertFile } from './convert';
export { sharedToPdf, savePdfFile } from './sharedPdf';
export { shareFile } from './share';
export { loadOcr } from './ocr';
export const loadCantoo = () => import('@cantoo/pdf-lib');
