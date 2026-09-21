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
- **AI Providers:** OpenAI (primary), Claude & Gemini (future)

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
- OpenAI API key

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
- `OPENAI_API_KEY`: Your OpenAI API key
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

⏳ **Phase 4: Pending Implementation**
- AI-assisted question extraction from PDFs
- Student submission upload
- Answer extraction from submissions
- Vision-based analysis for screenshots
- Answer normalization

## Database Schema

Key entities:
- **Course**: PBO or SISOP
- **Assignment**: Assignment within a course (with status: draft/active/archived)
- **Question**: Individual questions with rubrics
- **GradingCriterion**: Specific criteria for evaluating questions
- **Document**: PDF documents (assignment questions, student submissions)
- **DocumentPage**: Individual pages with extracted text and metadata
- **Submission**: Student PDF submissions
- **ExtractedAnswer**: Parsed answers from PDFs
- **Grade**: AI-generated scores with evidence
- **GradeReview**: Human review and adjustments

## Document Processing

The system supports two document types:
- **Assignment Question Documents**: PDF containing assignment questions
- **Student Submission Documents**: PDF containing student answers (future)

### Processing Pipeline
```
PDF Upload → Validation → Storage → Text Extraction → Page Processing → Processed
```

### Features
- Maximum file size: 20MB (configurable)
- PDF validation and security checks
- Automatic text extraction
- Page-level metadata
- Processing status tracking

### Limitations
- Text-only extraction (OCR not yet implemented)
- Scanned/image-only PDFs will have limited text
- Vision analysis will be added in Phase 4

## AI Architecture

**Server-Side Only**: All AI API calls happen server-side to protect API keys.

**Provider Support**:
- ✅ OpenAI (implemented)
- ⏳ Claude (future)
- ⏳ Gemini (future)

**Service Separation**:
- Document analyzer
- Answer extractor
- Grader
- Feedback generator

Each service has a distinct purpose and does not overlap.

## Development Commands

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
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
