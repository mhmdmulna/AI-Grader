/**
 * Document upload section (wrapper for upload and viewer)
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DocumentUpload } from './DocumentUpload';
import { DocumentViewer } from './DocumentViewer';

interface DocumentUploadSectionProps {
  assignmentId: string;
  documentId?: string | null;
}

export function DocumentUploadSection({ assignmentId, documentId: initialDocumentId }: DocumentUploadSectionProps) {
  const router = useRouter();
  const [documentId, setDocumentId] = useState<string | null>(initialDocumentId || null);

  const handleUploadSuccess = (newDocumentId: string) => {
    setDocumentId(newDocumentId);
    router.refresh();
  };

  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
        Question Document
      </h2>

      {!documentId ? (
        <DocumentUpload
          assignmentId={assignmentId}
          onUploadSuccess={handleUploadSuccess}
        />
      ) : (
        <DocumentViewer documentId={documentId} />
      )}
    </div>
  );
}
