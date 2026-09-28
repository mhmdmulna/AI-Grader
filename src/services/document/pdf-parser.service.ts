/**
 * PDF parser service
 *
 * Handles PDF text extraction and metadata extraction.
 *
 * Uses pdfjs-dist directly in Node.js mode to avoid the pdf-parse v2
 * fake-worker path resolution bug in Next.js/Turbopack.
 *
 * The worker is loaded from a file:// URL so it runs in a real
 * Worker thread and resolves correctly on all platforms.
 */

import { PDFDocument } from 'pdf-lib';
import path from 'path';
import { pathToFileURL } from 'url';

export interface PDFMetadata {
  pageCount: number;
  title?: string;
  author?: string;
  creator?: string;
  producer?: string;
  creationDate?: Date;
}

export interface PDFTextExtractionResult {
  fullText: string;
  pageCount: number;
  pages: Array<{
    pageNumber: number;
    text: string;
    hasText: boolean;
    charCount: number;
  }>;
  totalCharCount: number;
}

/**
 * Build the file:// URL for the pdfjs worker.
 * We resolve it relative to node_modules so it works regardless
 * of where the service is imported from within the project.
 */
function getWorkerURL(): string {
  const workerPath = path.join(
    process.cwd(),
    'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
  );
  return pathToFileURL(workerPath).href;
}

export class PDFParserService {
  /**
   * Extract text from PDF buffer using pdfjs-dist in Node.js mode.
   *
   * The workerSrc is set to a file:// URL so pdfjs-dist spawns the worker
   * from the correct location instead of trying to find it inside the
   * Next.js build output (which fails in Turbopack dev mode).
   */
  async extractText(buffer: Buffer): Promise<PDFTextExtractionResult> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

      // Set workerSrc to an absolute file:// URL — required on Windows and
      // for pdfjs-dist v5 which no longer accepts bare paths.
      pdfjs.GlobalWorkerOptions.workerSrc = getWorkerURL();

      const uint8 = new Uint8Array(buffer);
      const loadingTask = pdfjs.getDocument({ data: uint8, verbosity: 0 });
      const doc = await loadingTask.promise;

      const pageCount = doc.numPages;
      const pages: PDFTextExtractionResult['pages'] = [];
      let fullText = '';

      for (let i = 1; i <= pageCount; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pageText = (content.items as any[])
          .filter((item) => typeof item.str === 'string')
          .map((item) => item.str as string)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        fullText += (fullText ? '\n' : '') + pageText;
        pages.push({
          pageNumber: i,
          text: pageText,
          hasText: pageText.length > 0,
          charCount: pageText.length,
        });
      }

      await doc.destroy();

      return {
        fullText,
        pageCount,
        pages,
        totalCharCount: fullText.length,
      };
    } catch (error) {
      throw new Error(
        `PDF text extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Extract PDF metadata using pdf-lib (no worker dependency).
   */
  async extractMetadata(buffer: Buffer): Promise<PDFMetadata> {
    try {
      const pdfDoc = await PDFDocument.load(buffer);
      const pageCount = pdfDoc.getPageCount();

      const title = pdfDoc.getTitle();
      const author = pdfDoc.getAuthor();
      const creator = pdfDoc.getCreator();
      const producer = pdfDoc.getProducer();
      const creationDate = pdfDoc.getCreationDate();

      return {
        pageCount,
        title: title || undefined,
        author: author || undefined,
        creator: creator || undefined,
        producer: producer || undefined,
        creationDate: creationDate || undefined,
      };
    } catch (error) {
      throw new Error(
        `PDF metadata extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get page dimensions using pdf-lib.
   */
  async getPageDimensions(buffer: Buffer): Promise<Array<{ width: number; height: number }>> {
    try {
      const pdfDoc = await PDFDocument.load(buffer);
      const dimensions = [];

      for (let i = 0; i < pdfDoc.getPageCount(); i++) {
        const page = pdfDoc.getPage(i);
        const { width, height } = page.getSize();
        dimensions.push({ width, height });
      }

      return dimensions;
    } catch (error) {
      throw new Error(
        `Page dimension extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Validate if buffer is a valid PDF using pdf-lib.
   */
  async isValidPDF(buffer: Buffer): Promise<boolean> {
    try {
      await PDFDocument.load(buffer);
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
export const pdfParserService = new PDFParserService();
