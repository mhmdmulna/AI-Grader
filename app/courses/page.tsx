/**
 * Courses page - List all courses
 */

import Link from 'next/link';
import { CourseCard } from '@/src/components/CourseCard';

async function getCourses() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/courses`, {
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error('Failed to fetch courses');
  }

  return res.json();
}

interface CourseWithCount {
  id: string;
  code: 'PBO' | 'SISOP';
  name: string;
  _count: {
    assignments: number;
  };
}

export default async function CoursesPage() {
  const { courses } = await getCourses();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
              Courses
            </h1>
            <p className="text-zinc-600 dark:text-zinc-400 mt-1">
              Select a course to manage assignments
            </p>
          </div>
          <Link
            href="/"
            className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            ← Back to Home
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {courses.map((course: CourseWithCount) => (
            <CourseCard
              key={course.id}
              code={course.code}
              name={course.name}
              assignmentCount={course._count.assignments}
            />
          ))}
        </div>

        {courses.length === 0 && (
          <div className="text-center py-12 text-zinc-500 dark:text-zinc-500">
            No courses found. Run database seed to create PBO and SISOP courses.
          </div>
        )}
      </div>
    </div>
  );
}
