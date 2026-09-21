/**
 * Course card component
 */

import Link from 'next/link';

interface CourseCardProps {
  code: string;
  name: string;
  assignmentCount: number;
}

export function CourseCard({ code, name, assignmentCount }: CourseCardProps) {
  return (
    <Link 
      href={`/courses/${code}`}
      className="block p-6 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 dark:hover:border-blue-500 transition-colors bg-white dark:bg-zinc-900"
    >
      <div className="flex items-center gap-3 mb-2">
        <div className="w-12 h-12 rounded-lg bg-blue-600 flex items-center justify-center">
          <span className="text-xl font-bold text-white">{code[0]}</span>
        </div>
        <div>
          <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            {code}
          </h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {name}
          </p>
        </div>
      </div>
      <div className="mt-4 text-sm text-zinc-500 dark:text-zinc-500">
        {assignmentCount} {assignmentCount === 1 ? 'assignment' : 'assignments'}
      </div>
    </Link>
  );
}
