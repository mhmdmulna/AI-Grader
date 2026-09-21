/**
 * Document viewer component (client-side)
 */

'use client';

import { useEffect, useState } from 'react';

interface DocumentViewerProps {
  documentId: string;
}

interface DocumentData {
  id: string;
  originalFilename: string;
  fileSize: number;
  processingStatus: string;
  pageCount?: number;
  hasText: boolean;
  textCharCount?: number;
  errorMessage?: string;
  createdAt: string;
}

export function DocumentViewer({ documentId }: DocumentViewerProps) {
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [extractedText, setExtractedText] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    fetchDocument();
  }, [documentId]);

  const fetchDocument = async () => {
    try {
      const response = await fetch(`/api/documents/${documentId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch document');
      }
      const data = await response.json();
      setDocument(data.document);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load document');
    } finally {
      setLoading(false);
    }
  };

  const loadExtractedText = async () => {
    if (!document || !document.hasText) return;

    try {
      const response = await fetch(`/api/documents/${documentId}/text`);
      if (!response.ok) {
        throw new Error('Failed to fetch text');
      }
      const data = await response.json();
      setExtractedText(data.text);
      setShowText(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load text');
    }
  };

  if (loading) {
    return (
      <div className="p-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <p className="text-zinc-600 dark:text-zinc-400">Loading document...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
        <p className="text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  if (!document) return null;

  const statusColors = {
    uploaded: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    processed: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  };

  return (
    <div className="space-y-4">
      <div className="p-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {document.originalFilename}
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
              {(document.fileSize / 1024 / 1024).toFixed(2)} MB
            </p>
          </div>
          <span
            className={`px-2 py-1 text-xs font-medium rounded ${
              statusColors[document.processingStatus as keyof typeof statusColors] || statusColors.uploaded
            }`}
          >
            {document.processingStatus}
          </span>
        </div>

        {document.processingStatus === 'processed' && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-zinc-500 dark:text-zinc-400">Pages:</span>
              <span className="ml-2 font-medium text-zinc-900 dark:text-zinc-100">
                {document.pageCount || 0}
              </span>
            </div>
            <div>
              <span className="text-zinc-500 dark:text-zinc-400">Text extracted:</span>
              <span className="ml-2 font-medium text-zinc-900 dark:text-zinc-100">
                {document.hasText ? 'Yes' : 'No'}
              </span>
            </div>
            {document.textCharCount && (
              <div>
                <span className="text-zinc-500 dark:text-zinc-400">Characters:</span>
                <span className="ml-2 font-medium text-zinc-900 dark:text-zinc-100">
                  {document.textCharCount.toLocaleString()}
                </span>
              </div>
            )}
          </div>
        )}

        {document.processingStatus === 'failed' && document.errorMessage && (
          <div className="mt-4 p-3 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            Error: {document.errorMessage}
          </div>
        )}

        {document.processingStatus === 'processed' && document.hasText && !showText && (
          <button
            onClick={loadExtractedText}
            className="mt-4 px-4 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            View Extracted Text
          </button>
        )}
      </div>

      {showText && extractedText && (
        <div className="p-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Extracted Text
            </h4>
            <button
              onClick={() => setShowText(false)}
              className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Hide
            </button>
          </div>
          <div className="p-4 rounded bg-zinc-50 dark:bg-zinc-800 max-h-96 overflow-y-auto">
            <pre className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap font-mono">
              {extractedText}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
