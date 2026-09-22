/**
 * PDF parser service
 * 
 * Handles PDF text extraction and metadata extraction.
 */

import { PDFDocument } from 'pdf-lib';

// Dynamic import for pdf-parse
let pdfParseModule: any = null;

async function getPdfParse() {
  if (!pdfParseModule) {
    pdfParseModule = await import('pdf-parse');
  }
  return pdfParseModule;
}

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

export class PDFParserService {
  /**
   * Extract text from PDF buffer
   */
  async extractText(buffer: Buffer): Promise<PDFTextExtractionResult> {
    try {
      const pdfParseModule = await getPdfParse();
      
      let fullText = '';
      let pageCount = 1;
      const pages: Array<{
        pageNumber: number;
        text: string;
        hasText: boolean;
        charCount: number;
      }> = [];

      if (pdfParseModule.PDFParse) {
        const parser = new pdfParseModule.PDFParse({ data: buffer });
        const result = await parser.getText();
        fullText = result.text || '';
        pageCount = result.total || (result.pages ? result.pages.length : 1);
        
        if (result.pages && result.pages.length > 0) {
          result.pages.forEach((p: { num?: number; text?: string }, idx: number) => {
            const trimmed = (p.text || '').trim();
            pages.push({
              pageNumber: p.num || idx + 1,
              text: trimmed,
              hasText: trimmed.length > 0,
              charCount: trimmed.length,
            });
          });
        }
        await parser.destroy();
      } else if (typeof pdfParseModule === 'function') {
        const data = await pdfParseModule(buffer);
        fullText = data.text;
        pageCount = data.numpages;
        const pageSplits = fullText.split('\f');
        for (let i = 0; i < pageCount; i++) {
          const pageText = pageSplits[i] || '';
          const trimmedText = pageText.trim();
          pages.push({
            pageNumber: i + 1,
            text: trimmedText,
            hasText: trimmedText.length > 0,
            charCount: trimmedText.length,
          });
        }
      }

      if (pages.length === 0) {
        pages.push({
          pageNumber: 1,
          text: fullText.trim(),
          hasText: fullText.trim().length > 0,
          charCount: fullText.trim().length,
        });
      }

      return {
        fullText,
        pageCount: pages.length,
        pages,
        totalCharCount: fullText.length,
      };
    } catch (error) {
      throw new Error(`PDF text extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extract PDF metadata
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
      throw new Error(`PDF metadata extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get page dimensions
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
      throw new Error(`Page dimension extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate if buffer is a valid PDF
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
