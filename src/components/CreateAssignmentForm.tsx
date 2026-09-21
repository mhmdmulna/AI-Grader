/**
 * Create assignment form component (client-side)
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface CreateAssignmentFormProps {
  courseCode: string;
}

export function CreateAssignmentForm({ courseCode }: CreateAssignmentFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'draft' | 'active' | 'archived'>('draft');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`/api/courses/${courseCode}/assignments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          description,
          status,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create assignment');
      }

      const { assignment } = await res.json();
      
      // Reset form
      setTitle('');
      setDescription('');
      setStatus('draft');

      // Redirect to assignment page
      router.push(`/assignments/${assignment.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      {error && (
        <div className="p-3 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="title" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          Title *
        </label>
        <input
          type="text"
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className="w-full px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
          placeholder="e.g., Tugas 1"
        />
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          Description
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
          placeholder="Optional description..."
        />
      </div>

      <div>
        <label htmlFor="status" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          Status
        </label>
        <select
          id="status"
          value={status}
          onChange={(e) => setStatus(e.target.value as any)}
          className="w-full px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
        >
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      <button
        type="submit"
        disabled={loading || !title.trim()}
        className="w-full px-4 py-2 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Creating...' : 'Create Assignment'}
      </button>
    </form>
  );
}
