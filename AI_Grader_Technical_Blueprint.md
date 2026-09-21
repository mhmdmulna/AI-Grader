# AI Grader — Personal Assistant Grading System
## Technical & Product Requirements Document (PRD + Technical Blueprint)

## 1. Project Overview

### 1.1 Objective

Membangun aplikasi **AI-assisted grading** pribadi untuk membantu proses koreksi tugas mahasiswa pada dua mata kuliah:

- **PBO (Pemrograman Berorientasi Objek)**
- **SISOP (Sistem Operasi)**

Aplikasi menerima dokumen tugas mahasiswa dalam bentuk PDF, termasuk PDF yang mayoritas berisi **screenshot kode, terminal/Xinu, output program, dan penjelasan**.

Sistem tidak menggantikan korektor. Pada versi awal, AI berfungsi sebagai **assistant grader**:

> AI menganalisis jawaban → memberikan breakdown nilai + evidence + feedback → manusia melakukan review/approve/edit → nilai final disimpan.

Tujuan utama:

1. Mengurangi pekerjaan koreksi manual.
2. Memungkinkan **batch grading**.
3. Menjaga konsistensi penilaian.
4. Menggunakan rubric yang dibuat dan disetujui terlebih dahulu.
5. Menghindari pengiriman ulang soal secara tidak perlu sehingga menghemat token.
6. Menyimpan konfigurasi/rubric setiap assignment sehingga tugas mahasiswa berikutnya cukup di-upload.
7. Memberikan feedback yang detail dan dapat diaudit.
8. Menyediakan pemisahan data antara PBO dan SISOP.
9. Menjadikan OpenAI sebagai grading engine utama, dengan opsi Claude/Gemini sebagai second opinion.

---

# 2. Scope

## 2.1 Mata Kuliah

Aplikasi memiliki dua workspace utama:

```text
PBO
└── Assignments
    ├── Tugas 1
    ├── Tugas 2
    └── dst.

SISOP
└── Assignments
    ├── Tugas 1
    ├── Tugas 2
    └── dst.
```

Mahasiswa PBO dan SISOP berbeda, sehingga hasil dan data submission harus dipisahkan berdasarkan mata kuliah.

## 2.2 Pengguna

Versi awal hanya ditujukan untuk **satu pengguna/operator**, yaitu korektor.

Tidak diperlukan multi-user system pada MVP.

---

# 3. Input

## 3.1 Soal

Input assignment terdiri dari:

- PDF soal
- bobot setiap nomor
- requirement soal
- informasi tambahan jika diperlukan

Contoh:

```text
Question 1 = 20 points
Question 2 = 80 points
Total = 100 points
```

AI harus membaca soal terlebih dahulu dan menghasilkan draft rubric.

Rubric kemudian harus dapat diperiksa dan diedit oleh pengguna sebelum dikunci.

## 3.2 Submission Mahasiswa

Input mahasiswa berupa PDF.

Format aktual yang menjadi dasar desain:

- identitas mahasiswa
- screenshot kode
- screenshot output
- screenshot terminal/Xinu
- penjelasan jika ada
- beberapa nomor soal dalam satu PDF

Contoh submission yang telah diuji:

```text
Nama
NIM
Kelas

TP MOD 02 PBO

1. Code
   Output

2. Code
   Output
```

Submission contoh menunjukkan bahwa text extraction biasa hanya dapat membaca struktur/teks terbatas, sementara konten utama berupa screenshot. Oleh karena itu pipeline wajib mendukung vision/image processing.

---

# 4. Core Design Principle

## 4.1 Jangan Mengandalkan PDF → Markdown Saja

Pipeline tidak boleh mengasumsikan bahwa PDF memiliki text layer yang lengkap.

Arsitektur harus mendukung:

```text
PDF
 ↓
Text Extraction
 +
Page Rendering
 ↓
Image/Vision Processing
 ↓
Normalized Answer
```

Jika halaman mempunyai text yang dapat diekstrak, gunakan text extraction untuk efisiensi.

Jika halaman berupa screenshot/image, render halaman menjadi image dan gunakan vision model.

## 4.2 Vision Is Required

Karena submission PBO dapat berupa screenshot NetBeans dan submission SISOP dapat berupa screenshot Xinu/terminal, vision model menjadi komponen inti.

Sistem harus dapat membaca:

- source code pada screenshot
- output program
- command/terminal
- error message
- konfigurasi/hasil yang terlihat
- penjelasan yang terdapat sebagai gambar
- struktur visual submission

Vision tidak langsung menentukan nilai pada tahap extraction.

---

# 5. High-Level Architecture

```text
┌───────────────────────────────────────────────┐
│                  WEB APP                     │
│                                               │
│       PBO              SISOP                  │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │ Assignment Store │
              │                  │
              │ Question         │
              │ Rubric           │
              │ Expected Criteria│
              └────────┬─────────┘
                       │
                       │
             ┌─────────▼─────────┐
             │ PDF Processing     │
             │                   │
             │ Text Extraction   │
             │ Page Rendering    │
             │ Vision            │
             └─────────┬─────────┘
                       │
                       ▼
             ┌────────────────────┐
             │ Answer Normalizer  │
             │                    │
             │ Code               │
             │ Output             │
             │ Explanation        │
             │ Evidence           │
             └─────────┬──────────┘
                       │
                       ▼
             ┌────────────────────┐
             │ AI Grading Engine  │
             │                    │
             │ OpenAI             │
             │                    │
             │ Question           │
             │ Rubric             │
             │ Student Evidence   │
             └─────────┬──────────┘
                       │
                       ▼
             ┌────────────────────┐
             │ Structured Result  │
             │                    │
             │ Score              │
             │ Breakdown          │
             │ Evidence           │
             │ Feedback           │
             │ Confidence         │
             └─────────┬──────────┘
                       │
                       ▼
             ┌────────────────────┐
             │ Human Review       │
             │                    │
             │ Approve / Edit     │
             └─────────┬──────────┘
                       │
                       ▼
             ┌────────────────────┐
             │ Final Results      │
             │ Export             │
             └────────────────────┘
```

---

# 6. Assignment Memory

Setiap assignment harus mempunyai persistent configuration.

Contoh:

```text
PBO
└── Tugas 1
    ├── Original Question PDF
    ├── Parsed Questions
    ├── Rubric
    ├── Expected Criteria
    ├── Assignment Metadata
    └── Submissions
```

Setelah rubric disetujui, mahasiswa berikutnya **tidak perlu meng-upload soal kembali**.

Workflow:

```text
Upload Question
        ↓
AI Analyze
        ↓
Generate Draft Rubric
        ↓
Human Review
        ↓
Approve / Edit
        ↓
Lock Rubric
        ↓
Upload Student PDFs
        ↓
Grade
```

---

# 7. Question Analysis

Saat soal pertama kali di-upload, AI harus melakukan:

1. Identifikasi jumlah soal.
2. Identifikasi nomor soal.
3. Identifikasi bobot.
4. Identifikasi requirement.
5. Identifikasi expected output jika tersedia.
6. Identifikasi constraint.
7. Identifikasi konsep yang harus dinilai.
8. Menghasilkan draft grading criteria.
9. Memastikan total bobot sama dengan total nilai assignment.

Contoh:

```json
{
  "assignment": "PBO_TUGAS_01",
  "total_points": 100,
  "questions": [
    {
      "number": 1,
      "max_points": 20,
      "criteria": []
    },
    {
      "number": 2,
      "max_points": 80,
      "criteria": []
    }
  ]
}
```

---

# 8. Rubric Generation

AI membuat draft rubric berdasarkan isi soal.

Contoh struktur:

```text
Question 1 — 20 points

Criterion A — 5
Criterion B — 5
Criterion C — 5
Criterion D — 5
```

Rubric tidak langsung dianggap final.

Status:

```text
DRAFT
 ↓
REVIEW
 ↓
APPROVED
 ↓
LOCKED
```

Setelah LOCKED, rubric menjadi sumber penilaian batch.

---

# 9. Rubric Guardrails

AI tidak boleh bebas menentukan angka di luar struktur rubric.

Jika criterion memiliki:

```text
Maximum = 5
```

maka score hanya boleh berada dalam rentang:

```text
0–5
```

Untuk menjaga konsistensi, criterion sebaiknya memiliki scoring scale yang eksplisit.

Contoh:

```text
5 = requirement terpenuhi secara lengkap
4 = hampir lengkap, terdapat minor issue
3 = sebagian besar benar tetapi ada kekurangan
2 = implementasi sebagian
1 = bukti sangat terbatas
0 = tidak ditemukan/tidak dikerjakan
```

Skala dapat berbeda jika pengguna mengubahnya.

Total nilai:

```text
Question Score = Σ Criterion Scores
```

dan:

```text
Final Score = Σ Question Scores
```

AI tidak boleh menghasilkan nilai melebihi maximum.

---

# 10. Student PDF Processing

Setiap submission diproses sebagai pipeline independen.

```text
Student PDF
 ↓
Identify pages
 ↓
Extract text where possible
 ↓
Render image pages where necessary
 ↓
Vision analysis
 ↓
Question segmentation
 ↓
Answer normalization
```

## 10.1 Student Identification

Sistem mencoba mengekstrak:

- nama
- NIM
- kelas
- assignment identifier jika tersedia

Contoh:

```json
{
  "name": "Dina Lusiyana",
  "nim": "103032400102",
  "class": "IT-48-03"
}
```

Jika data tidak ditemukan atau ambigu:

```text
Need Review
```

---

# 11. Answer Normalization

Vision layer tidak memberikan nilai.

Ia hanya membuat representasi jawaban.

Contoh:

```json
{
  "student": {
    "name": "...",
    "nim": "...",
    "class": "..."
  },
  "answers": [
    {
      "question": 1,
      "code": "...",
      "output": "...",
      "explanation": "...",
      "visual_evidence": "...",
      "source_pages": [1, 2]
    }
  ]
}
```

Field dapat bernilai `null` jika tidak ditemukan.

Jangan mengarang isi yang tidak terlihat.

---

# 12. Evidence-Based Grading

Setiap score wajib mempunyai alasan/evidence.

Contoh:

```text
Question 2
Score: 16/20

Criterion: Inheritance
Score: 5/5

Evidence:
"Screenshot page 2 menunjukkan class X menggunakan inheritance
terhadap class Y."

Criterion: Constructor
Score: 4/5

Evidence:
"Constructor ditemukan tetapi satu atribut yang diwajibkan
tidak diinisialisasi."
```

Evidence harus berasal dari submission yang benar-benar terlihat/terbaca.

Jika bukti tidak cukup:

```text
Evidence unavailable
```

dan confidence diturunkan.

---

# 13. Three-Stage AI Pipeline

AI processing dipisahkan menjadi tiga tahap.

## Stage A — Extraction

Tujuan:

> Apa yang terdapat pada jawaban mahasiswa?

Output:

```text
code
output
explanation
visual evidence
page reference
```

Tidak memberikan nilai.

## Stage B — Evaluation

Input:

```text
Question
+
Approved Rubric
+
Normalized Student Answer
```

Output:

```text
criterion score
criterion evidence
question score
```

## Stage C — Feedback

Output:

```text
strengths
mistakes
explanation
suggested feedback
```

Dengan pemisahan ini, extraction error dapat dibedakan dari grading error.

---

# 14. Detailed Grading Result

Setiap mahasiswa harus mendapatkan:

```text
Student
NIM
Class

Question 1
    Criterion 1
    Criterion 2
    Criterion 3
    Score

Question 2
    Criterion 1
    Criterion 2
    Criterion 3
    Score

Final Score
Confidence
Feedback
Review Status
```

Contoh:

```text
Dina Lusiyana
103032400102

Q1      18/20
Q2      65/80
----------------
TOTAL   83/100

Confidence: HIGH

Feedback:
...
```

---

# 15. Confidence System

Setiap submission/question dapat memiliki confidence.

Minimum:

```text
HIGH
MEDIUM
LOW
```

Confidence dipengaruhi oleh:

- kualitas screenshot
- keterbacaan kode
- kelengkapan jawaban
- keberadaan evidence
- ambiguity
- extraction uncertainty
- grading uncertainty

Contoh:

```text
HIGH
→ bukti jelas dan lengkap

MEDIUM
→ terdapat bagian yang ambigu

LOW
→ screenshot blur / code terpotong /
   requirement tidak dapat diverifikasi
```

Confidence bukan nilai mahasiswa.

---

# 16. Human Review

MVP menggunakan model:

> AI Assistant Grader

bukan:

> Fully Autonomous Grader

AI memberikan rekomendasi.

Manusia melakukan:

```text
Approve
```

atau:

```text
Edit Score
```

atau:

```text
Edit Feedback
```

atau:

```text
Request Recheck
```

Status:

```text
PROCESSING
AI_GRADED
NEEDS_REVIEW
APPROVED
EDITED
FAILED
```

---

# 17. Batch Grading

Sistem harus mendukung upload banyak PDF sekaligus.

Contoh:

```text
Upload:
001_StudentA.pdf
002_StudentB.pdf
003_StudentC.pdf
...
050_StudentZ.pdf
```

Kemudian:

```text
[ Grade All ]
```

Sistem memproses submission secara asynchronous/queue-based.

Dashboard:

```text
50 Uploaded
45 Graded
3 Need Review
2 Processing
0 Failed
```

---

# 18. Batch Consistency

Untuk menjaga stabilitas:

1. Semua submission dalam assignment menggunakan rubric yang sama.
2. Semua submission menggunakan grading model/configuration yang sama.
3. Rubric tidak berubah selama batch aktif.
4. Prompt grading tidak berubah di tengah batch.
5. Scoring dilakukan berdasarkan criterion, bukan impression keseluruhan.
6. Nilai final dihitung secara deterministic dari criterion scores.
7. AI tidak boleh melihat score mahasiswa lain sebagai referensi.
8. Original evidence disimpan.
9. Model/version dan prompt version disimpan bersama hasil grading.

Jika rubric ingin diubah:

```text
Create new rubric version
```

bukan mengubah hasil lama secara diam-diam.

---

# 19. Model Strategy

## Primary Grader

OpenAI API menjadi grading engine utama.

Semua grading default menggunakan konfigurasi/model OpenAI yang sama untuk menjaga konsistensi.

## Optional Second Opinion

Claude dan Gemini dapat digunakan sebagai optional second opinion.

Contoh:

```text
OpenAI:
Score = 72

[ Ask Claude ]

Claude:
Score = 75

Difference:
3 points
```

Second opinion tidak otomatis mengubah nilai.

Jangan melakukan:

```text
(OpenAI + Claude) / 2
```

sebagai default.

Pengguna tetap menjadi final decision maker.

---

# 20. Model Selection

Arsitektur API harus dibuat provider-agnostic.

Contoh:

```text
AIProvider
├── OpenAIProvider
├── ClaudeProvider
└── GeminiProvider
```

Tetapi configuration default:

```text
PRIMARY_GRADER = OPENAI
```

Dengan demikian provider dapat diganti tanpa mengubah grading engine.

---

# 21. Token Optimization

## 21.1 Cache Assignment

Soal hanya dianalisis sekali.

Jangan mengirim:

```text
Question PDF
+
Student 1
Question PDF
+
Student 2
...
```

setiap kali.

Simpan:

```text
Question
Rubric
Expected Criteria
```

di database.

## 21.2 Normalize Before Grading

Grading tidak perlu menerima seluruh PDF jika extraction sudah menghasilkan informasi yang relevan.

Pipeline:

```text
PDF
 ↓
Vision
 ↓
Normalized Answer
 ↓
Grader
```

## 21.3 Reuse Extraction

Jika hasil extraction sudah tersimpan, retry grading tidak perlu melakukan vision extraction lagi.

```text
Stored Extraction
       ↓
Retry Grading
```

## 21.4 Regrade

Jika feedback ingin diubah tetapi evidence tidak berubah:

```text
reuse normalized answer
```

dan hindari re-upload/re-read PDF.

---

# 22. Web App vs Telegram

## Decision

**Web application menjadi interface utama.**

Telegram tidak otomatis mengurangi token. Token usage terutama ditentukan oleh data yang dikirim ke model.

Website lebih sesuai karena sistem memiliki:

- assignment management
- rubric editor
- batch upload
- grading dashboard
- evidence review
- score editing
- export
- status processing

Telegram dapat ditambahkan di masa depan sebagai convenience interface.

Contoh future:

```text
Telegram
 ↓
Upload PDF
 ↓
Backend
 ↓
AI Grader
 ↓
Notification
```

Tetapi bukan prioritas MVP.

---

# 23. Suggested UI

## Dashboard

```text
AI GRADER

[PBO]                         [SISOP]

Assignments
--------------------------------
PBO — Tugas 1
50 submissions
45 graded
3 review

PBO — Tugas 2
...

[ + New Assignment ]
```

## Assignment Detail

```text
PBO — Tugas 1

Questions: 5
Total: 100
Rubric: APPROVED

[ View Rubric ]
[ Upload Submissions ]
[ Grade All ]

--------------------------------

Students

Name        Score    Confidence   Status
Student A   87       HIGH         Approved
Student B   76       MEDIUM       Review
Student C   92       HIGH         Approved
```

## Review Page

```text
Student A

Q1
18 / 20

Criterion A    5/5
Evidence: ...

Criterion B    4/5
Evidence: ...

Q2
69 / 80

...

FINAL
87 / 100

Confidence: HIGH

[ Approve ]
[ Edit Score ]
[ Recheck ]
```

---

# 24. Database Model

MVP minimal schema:

```text
Course
- id
- name

Assignment
- id
- course_id
- name
- question_file
- status
- rubric_version
- created_at

Question
- id
- assignment_id
- number
- text
- max_points
- expected_criteria

Rubric
- id
- assignment_id
- version
- status

RubricCriterion
- id
- rubric_id
- question_id
- name
- description
- max_points
- scoring_guideline

Submission
- id
- assignment_id
- student_name
- student_nim
- student_class
- original_file
- status

Extraction
- id
- submission_id
- normalized_answer
- extraction_model
- extraction_version

Grade
- id
- submission_id
- score
- confidence
- feedback
- grader_model
- prompt_version
- status

CriterionGrade
- id
- grade_id
- criterion_id
- score
- evidence
- explanation

Review
- id
- grade_id
- original_score
- final_score
- reviewer_action
- reviewed_at
```

---

# 25. File Storage

Original PDF harus disimpan.

Jangan hanya menyimpan hasil extraction.

```text
Original PDF
+
Rendered pages if needed
+
Normalized extraction
+
Grade result
```

Hal ini memungkinkan re-check tanpa upload ulang.

---

# 26. Error Handling

Sistem harus menangani:

### PDF corrupt

```text
FAILED
Reason: Cannot read PDF
```

### Screenshot terlalu blur

```text
NEEDS_REVIEW
Reason: Evidence unreadable
```

### Student identity tidak ditemukan

```text
NEEDS_REVIEW
```

### Question number tidak terdeteksi

```text
NEEDS_REVIEW
```

### Vision extraction gagal

```text
EXTRACTION_FAILED
```

### Grading API gagal

```text
GRADING_FAILED
```

Semua harus bisa di-retry tanpa memproses ulang bagian yang sudah berhasil.

---

# 27. Security

API key tidak boleh berada di frontend.

Arsitektur:

```text
Browser
 ↓
Backend
 ↓
OpenAI API
```

bukan:

```text
Browser
 ↓
OpenAI API
```

API key disimpan di environment variable/server secret.

Karena aplikasi hanya untuk pribadi, authentication dapat dibuat sederhana pada MVP, tetapi deployment tetap tidak boleh mengekspos API key.

---

# 28. Auditability

Setiap hasil grading sebaiknya menyimpan:

```text
assignment_id
rubric_version
grader_model
prompt_version
extraction_model
timestamp
criterion_scores
evidence
AI_feedback
confidence
human_final_score
```

Dengan demikian hasil dapat ditelusuri kembali.

---

# 29. Important Grading Rules

AI harus mengikuti aturan:

1. Jangan mengarang kode yang tidak terlihat.
2. Jangan menganggap output benar jika output tidak terlihat.
3. Jangan memberikan score berdasarkan nama mahasiswa.
4. Jangan menggunakan mahasiswa lain sebagai benchmark.
5. Jangan mengubah rubric secara otomatis.
6. Jangan melebihi maximum points.
7. Jangan memberi score jika evidence tidak cukup tanpa menandai uncertainty.
8. Bedakan "tidak terlihat" dengan "salah".
9. Bedakan "tidak dikerjakan" dengan "tidak terbaca".
10. Semua score harus dapat ditelusuri ke criterion.
11. Feedback harus sesuai dengan evidence.
12. Final score berasal dari rubric calculation, bukan improvisasi LLM.

---

# 30. Prompt Architecture

Prompt tidak dibuat menjadi satu prompt raksasa.

Gunakan beberapa prompt terpisah.

## Prompt 1 — Assignment Analyzer

```text
Role:
You analyze academic assignment documents.

Task:
Extract questions, requirements, point allocations,
constraints, expected outputs and grading-relevant criteria.

Do not grade students.
Do not invent missing information.
```

## Prompt 2 — Answer Extractor

```text
Role:
You extract information from a student's submission.

Extract:
- student identity
- question number
- code
- output
- explanation
- visible evidence

Do not grade.
Do not infer invisible content.
```

## Prompt 3 — Grader

```text
Role:
You are an assistant grader.

Evaluate the student's normalized answer strictly
against the approved rubric.

For every criterion:
- assign score within maximum
- provide evidence
- explain score

Do not modify rubric.
Do not invent evidence.
```

## Prompt 4 — Feedback Generator

```text
Generate concise but detailed student-facing feedback
based only on grading evidence.

Do not introduce new claims.
```

---

# 31. Structured Output

AI grader wajib mengembalikan structured JSON.

Contoh:

```json
{
  "submission": {
    "student_name": "...",
    "student_nim": "..."
  },
  "questions": [
    {
      "number": 1,
      "criteria": [
        {
          "criterion_id": "Q1-C1",
          "score": 5,
          "max_score": 5,
          "evidence": "...",
          "reason": "..."
        }
      ],
      "score": 18,
      "max_score": 20
    }
  ],
  "total_score": 83,
  "confidence": "HIGH",
  "feedback": "...",
  "needs_review": false
}
```

Backend melakukan validation terhadap JSON sebelum menyimpan.

---

# 32. Deterministic Score Calculation

Walaupun AI mengembalikan `total_score`, backend harus menghitung ulang.

```text
Backend Total
=
Σ Criterion Scores
```

Kemudian:

```text
AI Total == Backend Total
```

Jika berbeda:

```text
GRADING_ERROR
```

dan hasil tidak langsung di-approve.

---

# 33. MVP Scope

Versi pertama hanya perlu:

### Core

- [ ] Web app
- [ ] PBO workspace
- [ ] SISOP workspace
- [ ] Create assignment
- [ ] Upload question PDF
- [ ] Vision-based question analysis
- [ ] Draft rubric generation
- [ ] Rubric editor
- [ ] Rubric approval/lock
- [ ] Batch PDF upload
- [ ] Vision-based submission extraction
- [ ] OpenAI grading
- [ ] Detailed score breakdown
- [ ] Evidence
- [ ] Feedback
- [ ] Confidence
- [ ] Grade All
- [ ] Human review
- [ ] Edit score
- [ ] Approve result
- [ ] Persistent assignment memory

### Export

Minimal:

- [ ] CSV/Excel grade export

---

# 34. V2

Setelah MVP stabil:

- [ ] Claude second opinion
- [ ] Gemini second opinion
- [ ] Automatic low-confidence detection
- [ ] Recheck selected submissions
- [ ] Better code extraction
- [ ] Student-facing feedback export
- [ ] PDF feedback generation
- [ ] Statistical grading analysis
- [ ] Score distribution dashboard
- [ ] Telegram notification/upload
- [ ] Assignment cloning
- [ ] Rubric version comparison

---

# 35. V3 — Optional

Jika nantinya dibutuhkan:

- multi-user
- multiple lecturers/assistants
- authentication
- shared assignments
- permission system
- cloud deployment
- institution-level dashboard

Tidak diperlukan untuk penggunaan pribadi.

---

# 36. Recommended Processing Flow

## New Assignment

```text
Create Assignment
       ↓
Upload Question PDF
       ↓
Render pages
       ↓
Vision Analysis
       ↓
Question Extraction
       ↓
Draft Rubric
       ↓
Human Review
       ↓
Approve
       ↓
LOCK
```

## Batch Grading

```text
Upload PDFs
       ↓
Queue
       ↓
PDF Processing
       ↓
Vision Extraction
       ↓
Normalized Answer
       ↓
OpenAI Grader
       ↓
JSON Validation
       ↓
Backend Score Calculation
       ↓
Confidence Evaluation
       ↓
Save
       ↓
Human Review
       ↓
Approve/Edit
```

---

# 37. Core Product Philosophy

Sistem ini bukan:

> "AI yang menentukan nilai mahasiswa."

Sistem ini adalah:

> **"AI yang melakukan pekerjaan koreksi repetitif, memberikan alasan dan evidence, lalu membantu korektor mengambil keputusan akhir secara cepat dan konsisten."**

Human tetap memiliki kontrol atas:

- rubric
- score
- feedback
- approval
- final grade

---

# 38. Success Criteria

MVP dianggap berhasil jika:

1. Soal berbentuk image-only PDF tetap dapat dianalisis.
2. Screenshot kode dapat diekstrak dengan cukup akurat untuk grading.
3. Screenshot output dapat diidentifikasi.
4. Sistem dapat membedakan nomor soal.
5. Rubric dapat dibuat sekali dan digunakan berkali-kali.
6. Puluhan submission dapat diproses dengan batch grading.
7. Setiap score memiliki evidence.
8. Nilai tidak melewati bobot maksimum.
9. Backend menghitung ulang final score.
10. Submission yang ambigu ditandai untuk human review.
11. User tidak perlu meng-upload soal ulang untuk setiap mahasiswa.
12. PBO dan SISOP tetap terpisah.
13. OpenAI menjadi grader utama.
14. Model lain dapat ditambahkan tanpa mengubah core architecture.
15. Hasil grading dapat diedit dan di-approve manusia.

---

# 39. Final Recommended Architecture

```text
                    ┌─────────────────────┐
                    │      WEB APP        │
                    └──────────┬──────────┘
                               │
                 ┌─────────────▼─────────────┐
                 │       ASSIGNMENT DB       │
                 │                           │
                 │ PBO / SISOP               │
                 │ Questions                 │
                 │ Rubric                    │
                 │ Expected Criteria         │
                 └─────────────┬─────────────┘
                               │
                  ┌────────────▼────────────┐
                  │    DOCUMENT ENGINE      │
                  │                         │
                  │ PDF Parser              │
                  │ Page Renderer            │
                  │ Text Extraction         │
                  │ Vision                   │
                  └────────────┬────────────┘
                               │
                  ┌────────────▼────────────┐
                  │   ANSWER NORMALIZER     │
                  │                         │
                  │ Code                    │
                  │ Output                  │
                  │ Explanation             │
                  │ Evidence                │
                  └────────────┬────────────┘
                               │
                  ┌────────────▼────────────┐
                  │      AI GRADING         │
                  │                         │
                  │ OpenAI = Primary        │
                  │ Claude = Optional       │
                  │ Gemini = Optional       │
                  └────────────┬────────────┘
                               │
                  ┌────────────▼────────────┐
                  │   JSON VALIDATOR        │
                  │                         │
                  │ Score Range             │
                  │ Required Evidence       │
                  │ Schema                  │
                  └────────────┬────────────┘
                               │
                  ┌────────────▼────────────┐
                  │  DETERMINISTIC ENGINE   │
                  │                         │
                  │ Calculate Final Score   │
                  └────────────┬────────────┘
                               │
                  ┌────────────▼────────────┐
                  │     HUMAN REVIEW        │
                  │                         │
                  │ Approve / Edit / Retry  │
                  └────────────┬────────────┘
                               │
                  ┌────────────▼────────────┐
                  │       RESULTS           │
                  │                         │
                  │ Dashboard               │
                  │ CSV / Excel             │
                  └─────────────────────────┘
```

# 40. Development Principle

Jangan membangun semua fitur sekaligus.

Urutan implementasi yang disarankan:

```text
Phase 1
PDF/Image Processing
        ↓
Phase 2
Question Analyzer
        ↓
Phase 3
Rubric Engine
        ↓
Phase 4
Student Answer Extraction
        ↓
Phase 5
Single Student Grading
        ↓
Phase 6
Human Review
        ↓
Phase 7
Batch Grading
        ↓
Phase 8
Dashboard + Export
        ↓
Phase 9
Second Opinion Providers
```

**Prioritas utama adalah membuat satu submission dapat dikoreksi dengan benar terlebih dahulu.**

Setelah single grading terbukti stabil, baru jalankan `Grade All`.

Dengan demikian batch processing tidak memperbanyak error yang belum kita pahami.
