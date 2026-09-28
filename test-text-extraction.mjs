import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerURL = pathToFileURL(path.join(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
pdfjs.GlobalWorkerOptions.workerSrc = workerURL;

const testFiles = [
  './test-pdfs/assignment.pdf',
  './test-pdfs/submission-good.pdf',
  './test-pdfs/submission-partial.pdf',
];

for (const filepath of testFiles) {
  const buffer = readFileSync(filepath);
  const uint8 = new Uint8Array(buffer);
  const doc = await (pdfjs.getDocument({ data: uint8, verbosity: 0 })).promise;
  let totalChars = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str ?? '').join(' ').trim();
    totalChars += text.length;
  }
  await doc.destroy();
  console.log(`${filepath}: ${doc.numPages} pages, ${totalChars} chars - ${totalChars > 0 ? '✓ HAS TEXT' : '⚠ NO TEXT'}`);
}
