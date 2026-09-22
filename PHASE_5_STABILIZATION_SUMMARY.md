# Ringkasan Sesi: Phase 5 Testing & Stabilization — AI Grader

Dokumen ini merangkum seluruh inspeksi, temuan masalah (bugs), perbaikan yang telah diterapkan, dan status pengujian pada sesi stabilisasi pipeline Fase 1–5.

---

## 1. Tujuan & Aturan Utama Sesi
* **Fokus**: Menstabilkan, menguji, memvalidasi, dan memperbaiki pipeline Fase 1–5 yang sudah ada agar berjalan *end-to-end* secara andal.
* **Prinsip**: 
  - Tidak menambah fitur baru (Fase 6 tidak dimulai).
  - Tidak mengubah arsitektur inti.
  - **AI mengevaluasi, Aplikasi menghitung, Manusia memutuskan.**

---

## 2. Hasil Inspeksi & Rekonstruksi Pipeline Aktual

Pipeline yang diinspeksi:
```text
Course (PBO / SISOP)
    ↓
Assignment
    ↓
Assignment Question Document (PDF)
    ↓
Document Processing (Storage + PDF Parsing)
    ↓
Question Extraction (AI)
    ↓
Questions & Criteria Setup
    ↓
Student Submission (PDF)
    ↓
Document Processing
    ↓
Answer Extraction (AI + Evidence Grounding)
    ↓
AI Criterion Evaluation (Rubric-based)
    ↓
Deterministic Score Calculation (Aplikasi / Non-AI)
    ↓
Grade Summary & AI Feedback
    ↓
Human Review (Accept / Adjust Score & Comment)
    ↓
Final Grade
```

---

## 3. Temuan Masalah & Perbaikan yang Diterapkan

### 1. Perbaikan Ekstraksi PDF (`pdf-parse` v2.4.5 API Mismatch) — **[CRITICAL]**
* **Penyebab**: `pdf-parser.service.ts` memanggil `pdfParse(buffer)` sebagai fungsi legacy. Di versi `pdf-parse@2.4.5`, ekspor modul berupa class `PDFParse` (`new PDFParse({ data: buffer })` lalu `await parser.getText()`). Hal ini menyebabkan *runtime crash* saat dokumen PDF diproses.
* **Perbaikan**: Diperbarui pada [pdf-parser.service.ts](file:///D:/ai-grader/src/services/document/pdf-parser.service.ts) dengan deteksi ganda: instansiasi class `new pdfParseModule.PDFParse()` jika ada, atau fallback fungsi callable legacy, serta mapping halaman dan karakter yang valid.

### 2. Idempotensi Ekstraksi Soal & Jawaban — **[HIGH]**
* **Penyebab**: 
  - Menjalankan ekstraksi soal berulang kali pada assignment yang sama memicu duplikasi atau konflik unique constraint `[assignmentId, questionNumber]`.
  - Menjalankan ekstraksi jawaban berulang kali pada submission menduplikasi record `extractedAnswer` dan `evidence`.
* **Perbaikan**: 
  - Pada [extraction/index.ts](file:///D:/ai-grader/src/services/extraction/index.ts), ditambahkan pembersihan (`deleteMany`) record lama sebelum menuliskan hasil ekstraksi baru saat re-ekstraksi dijalankan.

### 3. Idempotensi Pemrosesan Halaman Dokumen — **[MEDIUM]**
* **Penyebab**: Menjalankan ulang pemrosesan dokumen (`processDocument`) pada [document/index.ts](file:///D:/ai-grader/src/services/document/index.ts) menduplikasi entri tabel `DocumentPage`.
* **Perbaikan**: Ditambahkan `prisma.documentPage.deleteMany({ where: { documentId } })` sebelum memasukkan record halaman yang baru diekstrak.

### 4. Idempotensi Grading Run & Re-Grading — **[HIGH]**
* **Penyebab**: Model `GradingRun` memiliki constraint `@unique` pada `submissionId`. Menjalankan penilaian kedua kali akan melempar error constraint database.
* **Perbaikan**: Pada [grading/index.ts](file:///D:/ai-grader/src/services/grading/index.ts), proses grading kini memeriksa dan menghapus `GradingRun` lama beserta relasinya secara bersih sebelum membuat run baru.

### 5. Keamanan Perhitungan Skor & Pembagian Nol (`NaN`) — **[HIGH]**
* **Penyebab**: Pada [question-grader.service.ts](file:///D:/ai-grader/src/services/grading/question-grader.service.ts), rumus `normalizedScore = eval_.recommendedScore / eval_.maxScore` menghasilkan nilai `NaN` jika kriteria memiliki `maxScore = 0`, serta tidak memperhitungkan jika bobot kriteria belum dinormalisasi.
* **Perbaikan**: Ditambahkan pengecekan `eval_.maxScore > 0`, normalisasi bobot berbasis `totalWeights`, penanganan jika evaluasi kosong (skor 0), dan dukungan passing daftar soal assignment ke `gradeAllQuestions`.

---

## 4. Status Verifikasi Teknis Sesi Ini

| Pengujian / Pengecekan | Status | Keterangan |
|---|---|---|
| **Database & Prisma** | **PASS** | `npx prisma db push` berhasil disinkronkan ke PostgreSQL `ai_grader`. Course `PBO` & `SISOP` ter-seed via `seed.ts`. |
| **PDF Text Extraction** | **PASS** | Terverifikasi langsung via unit test `PDFParse` Node.js menghasilkan parsing halaman dan teks yang tepat. |
| **Next.js Dev Server** | **PASS** | Log server menunjukkan endpoint `/`, `/courses`, `/api/courses/PBO/assignments`, dan upload dokumen assignment `/api/assignments/[id]/document` merespons status `200` & `201`. |
| **TypeScript Typecheck** | **PASS** | `npx tsc --noEmit` keluar dengan exit code 0 tanpa error tipe. |

---

## 5. File yang Dimodifikasi pada Sesi Ini

1. [src/services/document/pdf-parser.service.ts](file:///D:/ai-grader/src/services/document/pdf-parser.service.ts): Adaptasi kompatibilitas `PDFParse` class v2.4.5.
2. [src/services/document/index.ts](file:///D:/ai-grader/src/services/document/index.ts): Idempotensi penyimpanan record `DocumentPage`.
3. [src/services/extraction/index.ts](file:///D:/ai-grader/src/services/extraction/index.ts): Idempotensi ekstraksi soal dan jawaban mahasiswa.
4. [src/services/grading/index.ts](file:///D:/ai-grader/src/services/grading/index.ts): Dukungan re-run grading submission tanpa menabrak unique constraint.
5. [src/services/grading/question-grader.service.ts](file:///D:/ai-grader/src/services/grading/question-grader.service.ts): Penanganan pembagian nol dan perhitungan skor deterministik yang lebih tangguh.

---

## 6. Langkah Kerja Berikutnya (Next Steps)
1. Menuntaskan warning/error ESLint (`npm run lint`) pada komponen UI (seperti `DocumentViewer.tsx` dan `CreateAssignmentForm.tsx`).
2. Menyiapkan berkas template konfigurasi aman `.env.example`.
3. Menjalankan pengujian skenario submission terkontrol (Case A: Baik, Case B: Sebagian, Case C: Buruk, Case D: Jawaban Hilang) dan alur *Human Review* akhir.
