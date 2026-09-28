import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = '';
console.log('pdfjs version:', pdfjs.version);
console.log('getDocument:', typeof pdfjs.getDocument);
console.log('SUCCESS: pdfjs-dist loads correctly in Node.js ESM mode');
