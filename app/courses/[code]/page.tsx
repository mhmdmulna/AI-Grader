/**
 * Course detail page - View assignments for a course
 */

import Link from 'next/link';
import { AssignmentCard } from '@/src/components/AssignmentCard';
import { CreateAssignmentForm } from '@/src/components/CreateAssignmentForm';

async function getCourseAssignments(code: string) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/courses/${code}/assignments`,
    { cache: 'no-store' }
  );

  if (!res.ok) {
    throw new Error('Failed to fetch assignments');
  }

  return res.json();
}

async function getCourse(code: string) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/courses/${code}`,
    { cache: 'no-store' }
  );

  if (!res.ok) {
    throw new Error('Failed to fetch course');
  }

  return res.json();
}

export default async function CoursePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const { course } = await getCourse(code);
  const { assignments } = await getCourseAssignments(code);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <Link
            href="/courses"
            className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 mb-4 inline-block"
          >
            ← Back to Courses
          </Link>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-16 h-16 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="text-3xl font-bold text-white">
                {course.code[0]}
              </span>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
                {course.code}
              </h1>
              <p className="text-zinc-600 dark:text-zinc-400">{course.name}</p>
            </div>
          </div>
        </div>

        <div className="mb-8">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
            Create New Assignment
          </h2>
          <CreateAssignmentForm courseCode={course.code} />
        </div>

        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
            Assignments ({assignments.length})
          </h2>

          {assignments.length > 0 ? (
            <div className="grid grid-cols-1 gap-4">
              {assignments.map((assignment: any) => (
                <AssignmentCard
                  key={assignment.id}
                  id={assignment.id}
                  title={assignment.title}
                  description={assignment.description}
                  status={assignment.status}
                  questionCount={assignment._count.questions}
                  submissionCount={assignment._count.submissions}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-zinc-500 dark:text-zinc-500 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg">
              No assignments yet. Create one above to get started.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
