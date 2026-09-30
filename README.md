# AI Grader

AI-assisted grading system for **PBO** (Object-Oriented Programming) and **SISOP** (Operating Systems) courses.

## Overview

This application helps human graders evaluate student assignments through:

- PDF document processing
- Answer extraction (text + images)
- AI-assisted evaluation
- Evidence-based scoring
- Feedback generation
- Human review and approval

**Important:** This is NOT an autonomous grading system. Human graders remain the final decision makers.

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **Database:** PostgreSQL + Prisma ORM
- **Styling:** Tailwind CSS
- **AI Providers:** DeepSeek (default), OpenAI (optional)

## Architecture

```
src/
├── app/              # Next.js app router pages and API routes
├── components/       # React components (future)
├── lib/              # Shared utilities and Prisma client
├── services/         # Business logic layer
│   ├── ai/          # AI provider implementations
│   ├── document/    # PDF processing (future)
│   ├── extraction/  # Answer extraction (future)
│   ├── grading/     # Grading logic (future)
│   └── feedback/    # Feedback generation (future)
├── types/           # TypeScript type definitions
└── config/          # Configuration files
```

## Setup

### Prerequisites

- Node.js 20+
- PostgreSQL database
- DeepSeek API key for AI workflows (not required for official-reference tests)

### Installation

1. Clone the repository and install dependencies:

```bash
npm install
```

2. Set up environment variables:

```bash
cp .env.example .env
```

Edit `.env` and add:
- `DATABASE_URL`: PostgreSQL connection string
- `AI_PROVIDER`: AI provider name (defaults to `deepseek`)
- `DEEPSEEK_API_KEY`: Your server-side DeepSeek API key
- `DEEPSEEK_BASE_URL`: DeepSeek API endpoint (defaults to `https://api.deepseek.com`)
- `DEEPSEEK_MODEL`: DeepSeek model (defaults to `deepseek-chat`)
- `MAX_DOCUMENT_SIZE_MB`: Maximum PDF size (default: 20)
- `STORAGE_PATH`: Document storage location (default: ./storage/documents)

3. Initialize the database:

```bash
npm run db:generate
npm run db:push
npm run db:seed
```

4. Start the development server:

```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000)

## Project Status

✅ **Phase 1: Foundation Setup (COMPLETE)**
- Project structure
- Type definitions
- Service layer architecture
- Database schema
- AI provider configuration
- API route example

✅ **Phase 2: Course & Assignment Management (COMPLETE)**
- Course management (PBO & SISOP)
- Assignment CRUD with status tracking
- Question management foundation
- Grading criteria data model
- Server-side API routes
- Basic validation UI

✅ **Phase 3: Document Processing (COMPLETE)**
- PDF upload infrastructure
- File validation and storage
- PDF text extraction
- Page metadata extraction
- Document processing status tracking
- Assignment document management
- Server-side document API

✅ **Phase 4: Answer Extraction (COMPLETE)**
- AI-assisted question extraction from assignment PDFs
- Answer extraction from student submissions
- Evidence tracking and confidence scoring
- Text-first extraction strategy (OpenAI integration)
- Extraction status monitoring
- Batch processing for multiple submissions
- Structured data output (no grading/evaluation)

✅ **Phase 5: AI-Assisted Grading (COMPLETE)**
- Criterion-level AI evaluation with rubrics
- Deterministic score calculation (not AI)
- Evidence-based reasoning and confidence tracking
- Question-level score aggregation
- Overall score calculation
- Human-in-the-loop review workflow
- Grading run tracking with status
- Feedback generation based on evaluations

✅ **Official Grading References (Phase 2 Provider Roadmap)**
- Versioned, lab-assistant-provided answer keys per question
- Versioned assignment rubrics with assignment-level or question-level criteria
- Criterion max scores, optional weights, and optional grading instructions
- Backend validation for ownership, score totals, weights, and malformed criteria
- Existing AI grading remains unchanged; reference-aware grading is planned for a later phase

✅ **Official Reference Readiness (Phase 3 Provider Roadmap)**
- Read-only readiness validation for active official answer keys and rubrics
- Blocking errors for missing, malformed, mislinked, or incorrectly totaled references
- Non-blocking quality warnings and deterministic summary counts
- `GET /api/assignments/{id}/official-references/readiness`
- Readiness is not yet connected to AI grading; rubric-based grading remains a later phase

✅ **Structured Student Answer Extraction (Phase 4 Provider Roadmap)**
- Maps AI-extracted student responses to existing assignment question IDs and numbers
- Reports missing, duplicate, unmapped, ambiguous, malformed, and low-confidence results
- Persists one deterministic answer per mapped question with confidence, source pages, and evidence
- Stores extraction summaries and diagnostics in the existing `AnswerExtraction.metadata` JSON field
- `POST /api/submissions/{id}/extract-answers` returns structured answers and diagnostics
- Extraction remains independent of official-reference readiness and does not grade responses

### Structured Answer Extraction Contract

Each mapped answer contains `assignmentId`, `questionId`, `questionNumber`, `content`,
`sourcePages`, optional `confidence`, a quality classification, and answer-specific warnings.
The extraction result also contains a `qualityStatus`, assignment-wide diagnostics, and counts
for mapped, missing, duplicate, unmapped, low-confidence, and malformed answers. Records that
cannot map to an assignment question are reported but are not persisted as `ExtractedAnswer` rows.

✅ **Official Answer-Key Comparison (Phase 5 Provider Roadmap)**
- Compares persisted answers for positive-point questions with active official answer keys
- Uses normalized exact matching and deterministic token-overlap signals; it does not assign scores
- Returns matched, partial, not-matched, missing-data, and needs-review statuses
- Withholds comparison for answers affected by extraction diagnostics or low confidence
- Includes Phase 3 readiness failures without changing readiness behavior elsewhere
- `POST /api/submissions/{id}/compare-answer-key` returns response-only comparison results

### Answer-Key Comparison Contract

Each question result identifies the question, persisted student answer, and active answer key. It
includes a similarity signal, rationale, source pages, extraction confidence, warnings, and blocking
issues. The assignment summary reports matched, partial, not-matched, missing, and needs-review
counts. Similarity is a lexical signal for future rubric grading, not a grade or semantic correctness
guarantee. Results are not persisted because the current schema has no dedicated comparison model.

✅ **Official Rubric Draft Grading (Phase 6 Provider Roadmap)**
- Uses active official answer keys and one active official rubric as the only grading authority
- Evaluates each official criterion through the configured AI provider with strict backend validation
- Treats Phase 5 lexical similarity as diagnostic context, never as a score
- Clamps draft points to official criterion maximums and flags altered or low-confidence output
- Explicitly handles missing answers, missing references, and extraction uncertainty
- `POST /api/submissions/{id}/grade-with-rubric` returns a human-reviewable draft

### Official Rubric Draft Contract

Each criterion result includes its official criterion and answer-key references, maximum and draft
points, concise feedback, student-answer evidence, confidence, review status, warnings, and blocking
issues. Assignment and question totals are deterministic sums of validated criterion results.
Assignment-level criteria remain separately totaled because distributing their points across questions
would invent a scoring rule. Draft results are response-only and never overwrite existing grades,
grading runs, deterministic score calculations, or final review decisions.

✅ **Human Review and Finalization (Phase 7 Provider Roadmap)**
- Persists an exact Phase 6 draft with rubric, answer-key version, criterion, AI, usage, warning, and blocking metadata
- Supports explicit criterion approval, score/feedback overrides, manual review flags, draft approval, and rejection
- Records reviewer identity, reason, previous values, final values, and timestamps in append-only audit entries
- Finalizes only approved, unblocked drafts whose scores remain within the official rubric maximums
- Writes finalized totals into the existing `GradingRun`, `QuestionGrade`, and `GradeSummary` domain
- Refuses to replace an existing grading run unless `allowReplacement` is explicitly true and a replacement reason is supplied

### Human Review Lifecycle

`POST /api/submissions/{id}/grade-with-rubric/save-draft` generates and stores one new draft.
`GET /api/submissions/{id}/grading-drafts` lists stored drafts and audit history.
`PATCH /api/grading-drafts/{draftId}/review` accepts `approve_criterion`,
`override_criterion`, `mark_criterion_needs_review`, `approve_draft`, or `reject_draft`.
`POST /api/grading-drafts/{draftId}/finalize` converts an approved draft into the existing
final-grade records. The lifecycle is `draft` or `needs_review` → `approved` or `rejected` →
`finalized`; AI generation never approves or finalizes its own output.

✅ **Finalized Grade Spreadsheet Export (Phase 8 Provider Roadmap)**
- Accepts a user-provided `.xlsx` workbook and writes a separate output workbook
- Creates a uniquely named `Grading Results` sheet by default, preserving all source sheets and cells
- Can target an explicitly named existing sheet and match rows by `studentId` or `submissionId`
- Updates one unambiguous matching row or appends a new row when no match exists
- Detects mapped headers case-insensitively and appends missing result columns when allowed
- Exports final totals, question and criterion detail, feedback, status, reviewer, and finalization time
- Rejects unsupported, malformed, protected, duplicate-identifier, merged-cell, formula-overwrite, and conflicting-cell operations
- `POST /api/assignments/{id}/spreadsheet/export` performs the export without calling an AI provider

### Spreadsheet Export Workflow

Send multipart form data with an `.xlsx` file in `file` and an optional JSON object in `options`.
The options may specify `sheetName`, `headerRow`, `identifierField`, `allowCreateColumns`,
`overwriteExistingCells`, and custom `columns` header names. `studentId` is the default stable
identifier. Use `submissionId` when an assignment can contain more than one submission for the same
student. Existing non-empty mapped result cells are not replaced unless
`overwriteExistingCells: true`; formula cells are never overwritten.

If no sheet is selected, the exporter creates a new result sheet. If an existing sheet is selected,
only mapped result cells and newly appended result columns are changed in the output copy. The API
returns the output path, selected sheet, updated/appended row counts, added columns, skipped records,
and safety warnings. Phase 8 supports `.xlsx` only; CSV and live Google Sheets sync remain out of scope.

## Database Schema

Key entities:
- **Course**: PBO or SISOP
- **Assignment**: Assignment within a course (with status: draft/active/archived)
- **Question**: Individual questions with rubrics and type (text, code, diagram, mixed)
- **GradingCriterion**: Specific criteria for evaluating questions
- **OfficialAnswerKey**: Versioned lab-assistant reference answer for a question
- **OfficialRubric**: Versioned lab-assistant rubric for an assignment
- **OfficialRubricCriterion**: Validated assignment-level or question-level rubric criterion
- **RubricGradingDraft**: Durable AI draft and review/finalization state
- **RubricGradingDraftCriterion**: AI recommendation plus explicit final human criterion value
- **RubricGradingDraftAudit**: Append-only reviewer override and finalization history
- **Document**: PDF documents (assignment questions, student submissions)
- **DocumentPage**: Individual pages with extracted text and metadata
- **QuestionExtraction**: Status tracking for AI question extraction
- **AnswerExtraction**: Status tracking for AI answer extraction
- **Evidence**: Evidence supporting answer extraction
- **Submission**: Student PDF submissions
- **ExtractedAnswer**: Parsed answers from PDFs with confidence scores
- **GradingRun**: Tracks each grading operation
- **CriterionEvaluation**: AI evaluation per criterion with recommendedScore, reasoning, confidence
- **QuestionGrade**: Aggregated question scores with human review support
- **GradeSummary**: Overall grading result with feedback
- **Grade**: AI-generated scores with evidence (deprecated)
- **GradeReview**: Human review and adjustments

## Document Processing & Extraction

The system supports two document workflows:
1. **Assignment Question Extraction** (Phase 4): Extract structured questions from assignment PDFs
2. **Student Answer Extraction** (Phase 4): Extract answers from submission PDFs matched to questions

### Processing Pipeline
```
PDF Upload → Validation → Storage → Text Extraction → AI Extraction → Structured Data
```

### Question Extraction
- Identifies question numbers, types, and content
- Extracts rubrics and point values
- Tracks source pages
- No grading/evaluation (extraction only)

### Answer Extraction
- Matches student answers to assignment questions
- Extracts answer content with page references
- Generates evidence and confidence scores
- Batch processing support

### Features
- Maximum file size: 20MB (configurable)
- PDF validation and security checks
- Automatic text extraction
- Page-level metadata
- Processing and extraction status tracking
- Provider abstraction (DeepSeek default, OpenAI optional)

### Limitations
- Text-first extraction (vision for Phase 4B)
- OCR not yet implemented
- Scanned/image-only PDFs will have limited extraction quality

## AI Architecture

**Server-Side Only**: All AI API calls happen server-side to protect API keys.

**Provider Support**:
- ✅ DeepSeek (default)
- ✅ OpenAI (optional)
- ⏳ Claude (future)
- ⏳ Gemini (future)

**Service Separation**:
- Document processor (Phase 3)
- Question extractor (Phase 4)
- Answer extractor (Phase 4)
- Grader (Phase 5)
- Feedback generator (Phase 6)

Each service has a distinct purpose and does not overlap. Phase 4 extracts structure WITHOUT evaluation.

## Development Commands

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run test:ai      # Run provider-layer tests
npm run test:phase2  # Run official answer key/rubric tests
npm run test:phase3  # Run official-reference readiness tests
npm run test:phase4  # Run structured student-answer extraction tests
npm run test:phase5  # Run official answer-key comparison tests
npm run test:phase6  # Run official rubric draft-grading tests
npm run test:phase7  # Run human review and finalization workflow tests
npm run test:phase8  # Run finalized-grade spreadsheet export tests
npm run db:generate  # Regenerate Prisma client
npm run db:push      # Push schema changes to database
npm run db:seed      # Seed courses (PBO & SISOP)
npm run db:studio    # Open Prisma Studio (database GUI)
```

## Security

- ✅ API keys stored in environment variables
- ✅ Never exposed to client-side code
- ✅ AI calls happen only in API routes (server-side)
- ✅ No hardcoded credentials

## License

Private educational project.
