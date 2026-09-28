import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, readdirSync } from 'fs';
import { PDFDocument } from 'pdf-lib';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// For Node.js: point workerSrc to the actual worker file as a file:// URL
const workerPath = path.join(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
const workerURL = pathToFileURL(workerPath).href;

pdfjs.GlobalWorkerOptions.workerSrc = workerURL;
console.log('workerSrc:', workerURL);

const STORAGE_PATH = process.env.STORAGE_PATH || './storage/documents';

async function testParse(filepath) {
  console.log('\n--- Testing:', filepath);
  const buffer = readFileSync(filepath);
  const uint8 = new Uint8Array(buffer);

  const loadingTask = pdfjs.getDocument({ data: uint8, verbosity: 0 });
  const doc = await loadingTask.promise;
  console.log('  Pages:', doc.numPages);

  let fullText = '';
  for (let i = 1; i <= Math.min(doc.numPages, 2); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str ?? '').join(' ').trim();
    console.log(`  Page ${i} chars:`, pageText.length, '| Preview:', pageText.slice(0, 100));
    fullText += pageText + '\n';
  }
  await doc.destroy();

  const pdfDoc = await PDFDocument.load(buffer);
  console.log('  pdf-lib pages:', pdfDoc.getPageCount());
  console.log('  RESULT: SUCCESS ✓');
}

try {
  const files = readdirSync(STORAGE_PATH).filter(f => f.endsWith('.pdf'));
  if (files.length === 0) {
    console.log('No PDF files found in', STORAGE_PATH);
  } else {
    await testParse(`${STORAGE_PATH}/${files[0]}`);
  }
} catch (e) {
  console.error('FAILED:', e.message);
  process.exit(1);
}
