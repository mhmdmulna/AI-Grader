/**
 * Assignment detail page - View questions and criteria
 */

import Link from 'next/link';

async function getAssignment(id: string) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/assignments/${id}`,
    { cache: 'no-store' }
  );

  if (!res.ok) {
    throw new Error('Failed to fetch assignment');
  }

  return res.json();
}

export default async function AssignmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { assignment, questions, criteria } = await getAssignment(id);

  const totalPoints = questions.reduce((sum: number, q: any) => sum + q.points, 0);

  // Group criteria by question
  const criteriaByQuestion = criteria.reduce((acc: any, c: any) => {
    if (!acc[c.questionId]) {
      acc[c.questionId] = [];
    }
    acc[c.questionId].push(c);
    return acc;
  }, {});

  const statusColors = {
    draft: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    active: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    archived: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <Link
          href={`/courses/${assignment.course.code}`}
          className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 mb-4 inline-block"
        >
          ← Back to {assignment.course.code}
        </Link>

        {/* Assignment Header */}
        <div className="mb-8 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                  {assignment.course.code}
                </span>
                <span className="text-zinc-400">•</span>
                <span
                  className={`px-2 py-1 text-xs font-medium rounded ${
                    statusColors[assignment.status as keyof typeof statusColors] ||
                    statusColors.draft
                  }`}
                >
                  {assignment.status}
                </span>
              </div>
              <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
                {assignment.title}
              </h1>
              {assignment.description && (
                <p className="text-zinc-600 dark:text-zinc-400 mt-2">
                  {assignment.description}
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-6 text-sm">
            <div>
              <span className="text-zinc-500 dark:text-zinc-400">Questions:</span>
              <span className="ml-2 font-medium text-zinc-900 dark:text-zinc-100">
                {questions.length}
              </span>
            </div>
            <div>
              <span className="text-zinc-500 dark:text-zinc-400">Total Points:</span>
              <span className="ml-2 font-medium text-zinc-900 dark:text-zinc-100">
                {totalPoints}
              </span>
            </div>
            <div>
              <span className="text-zinc-500 dark:text-zinc-400">Submissions:</span>
              <span className="ml-2 font-medium text-zinc-900 dark:text-zinc-100">
                {assignment._count.submissions}
              </span>
            </div>
          </div>
        </div>

        {/* Questions */}
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
            Questions
          </h2>

          {questions.length > 0 ? (
            <div className="space-y-4">
              {questions.map((question: any) => (
                <div
                  key={question.id}
                  className="p-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                      Question {question.questionNumber}
                    </h3>
                    <span className="px-3 py-1 rounded bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-sm font-medium">
                      {question.points} points
                    </span>
                  </div>

                  <p className="text-zinc-700 dark:text-zinc-300 mb-4 whitespace-pre-wrap">
                    {question.text}
                  </p>

                  {question.expectedCriteria && (
                    <div className="mb-4 p-3 rounded bg-zinc-50 dark:bg-zinc-800">
                      <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                        Expected Criteria:
                      </h4>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        {question.expectedCriteria}
                      </p>
                    </div>
                  )}

                  {/* Grading Criteria */}
                  {criteriaByQuestion[question.id] &&
                    criteriaByQuestion[question.id].length > 0 && (
                      <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                        <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3">
                          Grading Criteria:
                        </h4>
                        <div className="space-y-2">
                          {criteriaByQuestion[question.id].map((criterion: any) => (
                            <div
                              key={criterion.id}
                              className="flex items-start justify-between p-3 rounded bg-zinc-50 dark:bg-zinc-800"
                            >
                              <div className="flex-1">
                                <p className="font-medium text-zinc-900 dark:text-zinc-100 text-sm">
                                  {criterion.name}
                                </p>
                                <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                                  {criterion.description}
                                </p>
                              </div>
                              <span className="ml-4 text-sm font-medium text-blue-600 dark:text-blue-400">
                                {criterion.maxPoints} pts
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-zinc-500 dark:text-zinc-500 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg">
              No questions yet. Questions will be added in future phases.
            </div>
          )}
        </div>

        {/* Future Actions */}
        <div className="mt-8 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
            Future Features
          </h3>
          <ul className="text-sm text-zinc-600 dark:text-zinc-400 space-y-2">
            <li>• Upload question document (PDF)</li>
            <li>• AI-assisted question extraction</li>
            <li>• Create/edit questions manually</li>
            <li>• Define grading criteria</li>
            <li>• Upload student submissions</li>
            <li>• Batch grading with AI</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
