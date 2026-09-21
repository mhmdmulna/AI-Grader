/**
 * Assignment card component
 */

import Link from 'next/link';

interface AssignmentCardProps {
  id: string;
  title: string;
  description?: string;
  status: string;
  questionCount: number;
  submissionCount: number;
}

export function AssignmentCard({
  id,
  title,
  description,
  status,
  questionCount,
  submissionCount,
}: AssignmentCardProps) {
  const statusColors = {
    draft: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    active: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    archived: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  };

  return (
    <Link
      href={`/assignments/${id}`}
      className="block p-5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 dark:hover:border-blue-500 transition-colors bg-white dark:bg-zinc-900"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </h3>
        <span
          className={`px-2 py-1 text-xs font-medium rounded ${
            statusColors[status as keyof typeof statusColors] || statusColors.draft
          }`}
        >
          {status}
        </span>
      </div>
      {description && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3 line-clamp-2">
          {description}
        </p>
      )}
      <div className="flex gap-4 text-sm text-zinc-500 dark:text-zinc-500">
        <span>{questionCount} questions</span>
        <span>•</span>
        <span>{submissionCount} submissions</span>
      </div>
    </Link>
  );
}
