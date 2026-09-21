export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black px-4">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-center py-32">
        <div className="flex flex-col items-center gap-8 text-center">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="text-2xl font-bold text-white">AI</span>
            </div>
            <h1 className="text-4xl font-bold text-black dark:text-white">
              AI Grader
            </h1>
          </div>
          
          <p className="max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            AI-assisted grading system for <strong>PBO</strong> and <strong>SISOP</strong> courses.
            <br />
            Supporting human graders with intelligent evaluation, evidence extraction, and feedback generation.
          </p>

          <div className="mt-8 flex flex-col gap-4 w-full max-w-md">
            <a
              href="/courses"
              className="flex h-12 w-full items-center justify-center rounded-lg bg-blue-600 px-5 text-white font-medium transition-colors hover:bg-blue-700"
            >
              View Courses
            </a>
            <p className="text-sm text-zinc-500 dark:text-zinc-500">
              Phase 2: Course & Assignment Management
            </p>
          </div>

          <div className="mt-8 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 w-full">
            <h2 className="text-xl font-semibold mb-3 text-black dark:text-white">
              ✅ Phase 2 Complete
            </h2>
            <ul className="text-left text-sm text-zinc-600 dark:text-zinc-400 space-y-2">
              <li>✅ Course management (PBO & SISOP)</li>
              <li>✅ Assignment management with status</li>
              <li>✅ Question management</li>
              <li>✅ Grading criteria foundation</li>
              <li>✅ Server-side API routes</li>
              <li>✅ Basic UI for validation</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
