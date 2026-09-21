/**
 * Document upload component (client-side)
 */

'use client';

import { useState } from 'react';

interface DocumentUploadProps {
  assignmentId: string;
  onUploadSuccess?: (documentId: string) => void;
  onUploadError?: (error: string) => void;
}

export function DocumentUpload({ assignmentId, onUploadSuccess, onUploadError }: DocumentUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // Validate file type
      if (selectedFile.type !== 'application/pdf') {
        setError('Only PDF files are supported');
        setFile(null);
        return;
      }

      // Validate file size (client-side check)
      const maxSize = parseInt(process.env.NEXT_PUBLIC_MAX_DOCUMENT_SIZE_MB || '20') * 1024 * 1024;
      if (selectedFile.size > maxSize) {
        setError(`File size exceeds ${process.env.NEXT_PUBLIC_MAX_DOCUMENT_SIZE_MB || '20'}MB`);
        setFile(null);
        return;
      }

      setFile(selectedFile);
      setError('');
      setSuccess(false);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setError('');
    setSuccess(false);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`/api/assignments/${assignmentId}/document`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Upload failed');
      }

      const data = await response.json();
      setSuccess(true);
      setFile(null);
      
      if (onUploadSuccess) {
        onUploadSuccess(data.document.id);
      }

      // Reset file input
      const fileInput = document.getElementById('file-upload') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Upload failed';
      setError(errorMessage);
      
      if (onUploadError) {
        onUploadError(errorMessage);
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
        Upload Question Document
      </h3>

      <div className="space-y-4">
        {error && (
          <div className="p-3 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="p-3 rounded bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 text-sm">
            Document uploaded successfully! Processing started.
          </div>
        )}

        <div>
          <label
            htmlFor="file-upload"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
          >
            Select PDF File
          </label>
          <input
            id="file-upload"
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
            disabled={uploading}
            className="block w-full text-sm text-zinc-900 dark:text-zinc-100 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/20 dark:file:text-blue-400 dark:hover:file:bg-blue-900/30"
          />
          {file && (
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
            </p>
          )}
        </div>

        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="w-full px-4 py-2 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? 'Uploading...' : 'Upload Document'}
        </button>

        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          Maximum file size: {process.env.NEXT_PUBLIC_MAX_DOCUMENT_SIZE_MB || '20'}MB
        </p>
      </div>
    </div>
  );
}
