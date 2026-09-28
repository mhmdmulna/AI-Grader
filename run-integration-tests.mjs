/**
 * Phase 5 End-to-End Integration Test
 *
 * Field reference (verified from source):
 *  - POST /api/courses/[code]/assignments       body: { title, description, status }
 *  - POST /api/assignments/[id]/document        multipart: file (PDF)
 *  - PUT  /api/assignments/[id]/document        multipart: file (PDF) — replace existing
 *  - POST /api/documents                        multipart: file, documentType
 *  - POST /api/documents/[id]/process           (no body)
 *  - GET  /api/documents/[id]                   → { document }
 *  - GET  /api/documents/[id]/text              → { text, hasText }
 *  - POST /api/assignments/[id]/extract-questions (no body)
 *  - POST /api/assignments/[id]/questions       body: { questionNumber, text, points, rubric? }
 *  - POST /api/assignments/[id]/criteria        body: { questionId, name, description, maxPoints, order? }
 *  - POST /api/assignments/[id]/submissions     body: { studentName, studentId, documentId? }
 *  - POST /api/submissions/[id]/extract-answers (no body)
 *  - POST /api/submissions/[id]/grade           (no body)
 *  - GET  /api/grading-runs/[id]                → { data: gradingRun }
 *  - POST /api/grading-runs/[id] (review)       body: { reviewerName, finalScore, reviewerComment? }
 */

import { readFileSync } from 'fs';

const BASE = 'http://localhost:3000';
let PASS = 0, FAIL = 0, WARN = 0;
const FAILURES = [], WARNINGS = [];

function ok(label, detail = '') {
  PASS++;
  console.log(`  ✓ ${label}${detail ? ' | ' + detail : ''}`);
}
function fail(label, detail = '') {
  FAIL++;
  FAILURES.push({ label, detail });
  console.log(`  ✗ FAIL: ${label}${detail ? ' | ' + detail : ''}`);
}
function warn(label, detail = '') {
  WARN++;
  WARNINGS.push({ label, detail });
  console.log(`  ⚠ WARN: ${label}${detail ? ' | ' + detail : ''}`);
}
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  let d; try { d = await r.json(); } catch { d = null; }
  return { status: r.status, data: d };
}
async function upload(path, filepath, extraFields = {}) {
  const buf = readFileSync(filepath);
  const blob = new Blob([buf], { type: 'application/pdf' });
  const form = new FormData();
  form.append('file', blob, filepath.split('/').pop());
  for (const [k, v] of Object.entries(extraFields)) form.append(k, v);
  const r = await fetch(`${BASE}${path}`, { method: 'POST', body: form });
  let d; try { d = await r.json(); } catch { d = null; }
  return { status: r.status, data: d };
}
function noNaN(obj, label) {
  const s = JSON.stringify(obj);
  if (s.includes('NaN') || s.includes('Infinity')) fail(`No NaN/Infinity (${label})`, 'found in response');
  else ok(`No NaN/Infinity (${label})`);
}

// ─────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────
const S = {
  assignmentId: null,
  assignmentDocId: null,
  questionIds: [],
  criterionIds: [],
  subs: {},       // key → { id, docId }
  runs: {},       // key → gradingRunId
};

// ─────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log('1. ENVIRONMENT CHECK');
console.log('══════════════════════════════════════');

const cr = await api('GET', '/api/courses');
if (cr.status === 200 && cr.data?.courses?.length >= 2) {
  ok('GET /api/courses', `${cr.data.courses.length} courses`);
  ['PBO', 'SISOP'].forEach(c =>
    cr.data.courses.find(x => x.code === c) ? ok(`Course ${c} exists`) : fail(`Course ${c} exists`)
  );
} else { fail('GET /api/courses', JSON.stringify(cr.data)); }

// ─────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log('2. CREATE TEST ASSIGNMENT (SISOP)');
console.log('══════════════════════════════════════');

const car = await api('POST', '/api/courses/SISOP/assignments', {
  title: 'Phase5 Integration Test OOP',
  description: 'Automated Phase 5 test',
  status: 'active',
});
if (car.status === 201 && car.data?.assignment?.id) {
  S.assignmentId = car.data.assignment.id;
  ok('Create assignment', `id=${S.assignmentId}`);
} else { fail('Create assignment', JSON.stringify(car.data)); process.exit(1); }

// ─────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log('3. UPLOAD & PROCESS ASSIGNMENT DOCUMENT');
console.log('══════════════════════════════════════');

// POST /api/assignments/[id]/document — upload and attach in one step
const upDoc = await upload(`/api/assignments/${S.assignmentId}/document`, './test-pdfs/assignment.pdf');
if (upDoc.status === 201 && upDoc.data?.document?.id) {
  S.assignmentDocId = upDoc.data.document.id;
  ok('Upload assignment document', `id=${S.assignmentDocId}`);
} else { fail('Upload assignment document', JSON.stringify(upDoc.data)); process.exit(1); }

// Wait briefly for background processing to start
await new Promise(r => setTimeout(r, 1500));

// Explicitly process
const procRes = await api('POST', `/api/documents/${S.assignmentDocId}/process`);
if (procRes.status === 200 && procRes.data?.result?.status === 'processed') {
  const r = procRes.data.result;
  ok('Process document', `pages=${r.pageCount}, chars=${r.textCharCount}`);
  r.textCharCount > 0 ? ok('Document has text') : warn('Document has no text', 'image PDF?');
} else { fail('Process document', JSON.stringify(procRes.data)); }

// Verify GET
const docGet = await api('GET', `/api/documents/${S.assignmentDocId}`);
if (docGet.status === 200) {
  const d = docGet.data.document;
  d.processingStatus === 'processed' ? ok('GET document status=processed') : fail('GET document status', d.processingStatus);
  const pages = d.pages?.length ?? 0;
  pages > 0 ? ok(`DocumentPage records`, `${pages} pages`) : warn('No DocumentPage records');
} else { fail('GET document', `status=${docGet.status}`); }

// Idempotency: process again
const proc2 = await api('POST', `/api/documents/${S.assignmentDocId}/process`);
const docGet2 = await api('GET', `/api/documents/${S.assignmentDocId}`);
const pages1 = docGet.data?.document?.pages?.length ?? 0;
const pages2 = docGet2.data?.document?.pages?.length ?? 0;
pages1 === pages2 ? ok('Document processing idempotent', `pages ${pages1}→${pages2}`) : fail('Document processing idempotent', `${pages1}→${pages2}`);

// GET text
const txtRes = await api('GET', `/api/documents/${S.assignmentDocId}/text`);
if (txtRes.status === 200) {
  txtRes.data?.text?.length > 0 ? ok('GET document text', `${txtRes.data.text.length} chars`) : warn('GET document text', 'empty');
} else { fail('GET document text', `status=${txtRes.status}`); }

// Security: malicious filename
const malRes = await upload('/api/documents', './test-pdfs/submission-poor.pdf', { documentType: 'student_submission' });
// Use a tricky filename by patching the Blob filename through FormData directly
const malBuf = readFileSync('./test-pdfs/submission-poor.pdf');
const malForm = new FormData();
malForm.append('file', new Blob([malBuf], { type: 'application/pdf' }), '../../etc/passwd.pdf');
malForm.append('documentType', 'student_submission');
const malR = await fetch(`${BASE}/api/documents`, { method: 'POST', body: malForm });
const malData = await malR.json().catch(() => null);
if (malR.status === 201 && malData?.document?.filename) {
  const f = malData.document.filename;
  !f.includes('..') && !f.includes('etc') && !f.includes('passwd')
    ? ok('Malicious filename sanitized', `stored as: ${f}`)
    : fail('Malicious filename NOT sanitized', `stored as: ${f}`);
} else { warn('Malicious filename test', `status=${malR.status}`); }

// Security: invalid file type
const badForm = new FormData();
badForm.append('file', new Blob(['not a pdf'], { type: 'text/plain' }), 'test.txt');
badForm.append('documentType', 'student_submission');
const badR = await fetch(`${BASE}/api/documents`, { method: 'POST', body: badForm });
badR.status === 400 || badR.status === 422
  ? ok('Invalid file type rejected', `status=${badR.status}`)
  : fail('Invalid file type accepted', `status=${badR.status}`);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log('4. QUESTION EXTRACTION');
console.log('══════════════════════════════════════');

const exQ = await api('POST', `/api/assignments/${S.assignmentId}/extract-questions`);
if (exQ.status === 200 || exQ.status === 201) {
  ok('POST extract-questions', `status=${exQ.status}`);
  console.log(`    Extraction response keys: ${Object.keys(exQ.data || {}).join(', ')}`);
} else {
  warn('POST extract-questions', `status=${exQ.status} — ${JSON.stringify(exQ.data)?.slice(0, 100)}`);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log('5. MANUAL QUESTIONS & CRITERIA');
console.log('══════════════════════════════════════');

const QUESTIONS = [
  { questionNumber: 1, text: 'Explain the concept of encapsulation in Object-Oriented Programming.', points: 30 },
  { questionNumber: 2, text: 'Explain the difference between a class and an object in OOP.', points: 40 },
  { questionNumber: 3, text: 'Describe what inheritance is in OOP and explain one benefit of using it.', points: 30 },
];
const CRITERIA = [
  [
    { name: 'Definition of Encapsulation', description: 'Correctly defines encapsulation as bundling data and methods.', maxPoints: 12, order: 1 },
    { name: 'Access Modifiers', description: 'Explains private/public/protected access modifiers.', maxPoints: 9, order: 2 },
    { name: 'Maintainability Benefit', description: 'Explains how encapsulation improves maintainability.', maxPoints: 9, order: 3 },
  ],
  [
    { name: 'Class Definition', description: 'Correctly defines a class as a blueprint or template.', maxPoints: 12, order: 1 },
    { name: 'Object Definition', description: 'Correctly defines an object as an instance of a class.', maxPoints: 12, order: 2 },
    { name: 'Relationship + Example', description: 'Explains the class-object relationship with a concrete example.', maxPoints: 16, order: 3 },
  ],
  [
    { name: 'Inheritance Definition', description: 'Correctly defines inheritance in OOP.', maxPoints: 12, order: 1 },
    { name: 'Parent-Child Relationship', description: 'Explains the parent-child class relationship.', maxPoints: 9, order: 2 },
    { name: 'Code Reuse Benefit', description: 'States at least one benefit such as code reuse.', maxPoints: 9, order: 3 },
  ],
];

for (let i = 0; i < QUESTIONS.length; i++) {
  const qr = await api('POST', `/api/assignments/${S.assignmentId}/questions`, QUESTIONS[i]);
  if (qr.status === 201 && qr.data?.question?.id) {
    const qId = qr.data.question.id;
    S.questionIds.push(qId);
    ok(`Create Q${QUESTIONS[i].questionNumber}`, `id=${qId}`);
    for (const crit of CRITERIA[i]) {
      const cr = await api('POST', `/api/assignments/${S.assignmentId}/criteria`, { questionId: qId, ...crit });
      if (cr.status === 201 && cr.data?.criterion?.id) {
        S.criterionIds.push(cr.data.criterion.id);
        ok(`  Criterion: ${crit.name}`);
      } else { fail(`  Criterion: ${crit.name}`, JSON.stringify(cr.data)); }
    }
  } else { fail(`Create Q${QUESTIONS[i].questionNumber}`, JSON.stringify(qr.data)); }
}

// Verify assignment state
const assState = await api('GET', `/api/assignments/${S.assignmentId}`);
if (assState.status === 200) {
  const qc = assState.data.questions?.length ?? 0;
  const cc = assState.data.criteria?.length ?? 0;
  qc >= 3 ? ok(`Assignment has ${qc} questions`) : fail('Assignment questions count', `${qc}`);
  cc >= 9 ? ok(`Assignment has ${cc} criteria`) : fail('Assignment criteria count', `${cc}`);
}

// Edge case: duplicate question number (should return 409)
const dupQ = await api('POST', `/api/assignments/${S.assignmentId}/questions`, { questionNumber: 1, text: 'Duplicate Q1', points: 10 });
dupQ.status === 409 ? ok('Duplicate question rejected (409)') : warn('Duplicate question not rejected', `status=${dupQ.status}`);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log('6. STUDENT SUBMISSION UPLOAD');
console.log('══════════════════════════════════════');

const SUB_FILES = {
  good:      './test-pdfs/submission-good.pdf',
  partial:   './test-pdfs/submission-partial.pdf',
  poor:      './test-pdfs/submission-poor.pdf',
  missing:   './test-pdfs/submission-missing.pdf',
  injection: './test-pdfs/submission-injection.pdf',
};

for (const [key, fp] of Object.entries(SUB_FILES)) {
  // 1. Upload document
  const upSub = await upload('/api/documents', fp, { documentType: 'student_submission' });
  if (upSub.status !== 201) { fail(`Upload doc (${key})`, JSON.stringify(upSub.data)); continue; }
  const docId = upSub.data.document.id;

  // 2. Process document
  await new Promise(r => setTimeout(r, 500));
  const pRes = await api('POST', `/api/documents/${docId}/process`);
  if (pRes.status === 200 && pRes.data?.result?.status === 'processed') {
    const r = pRes.data.result;
    ok(`Process doc (${key})`, `${r.pageCount}p ${r.textCharCount}c`);
  } else { fail(`Process doc (${key})`, JSON.stringify(pRes.data)); }

  // 3. Create submission
  const subRes = await api('POST', `/api/assignments/${S.assignmentId}/submissions`, {
    studentName: `Test Student ${key}`,
    studentId: `test-${key}`,
    documentId: docId,
  });
  if (subRes.status === 201 && subRes.data?.submission?.id) {
    S.subs[key] = { id: subRes.data.submission.id, docId };
    ok(`Create submission (${key})`, `id=${S.subs[key].id}`);
  } else { fail(`Create submission (${key})`, JSON.stringify(subRes.data)); }
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log('7. ANSWER EXTRACTION');
console.log('══════════════════════════════════════');

for (const [key, sub] of Object.entries(S.subs)) {
  const exRes = await api('POST', `/api/submissions/${sub.id}/extract-answers`);
  if (exRes.status === 200 && exRes.data?.success) {
    ok(`Extract answers (${key})`, `answerCount=${exRes.data.data?.answerCount ?? '?'}`);
  } else {
    fail(`Extract answers (${key})`, `status=${exRes.status} — ${JSON.stringify(exRes.data)?.slice(0,100)}`);
  }
}

// Idempotency: re-extract good
const exRe1 = await api('POST', `/api/submissions/${S.subs.good?.id}/extract-answers`);
const exRe2 = await api('POST', `/api/submissions/${S.subs.good?.id}/extract-answers`);
exRe1.status <= 201 && exRe2.status <= 201
  ? ok('Answer extraction idempotent', 'no crash on 2nd+3rd run')
  : fail('Answer extraction idempotent');

// GET extraction status
const extStatus = await api('GET', `/api/submissions/${S.subs.good?.id}/extract-answers`);
if (extStatus.status === 200) {
  ok('GET extraction status', `status=${extStatus.data?.data?.status}`);
} else { warn('GET extraction status', `${extStatus.status}`); }

// ─────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log('8. AI GRADING');
console.log('══════════════════════════════════════');

for (const [key, sub] of Object.entries(S.subs)) {
  console.log(`\n  → Grading: ${key}`);
  const gRes = await api('POST', `/api/submissions/${sub.id}/grade`);
  if (gRes.status === 200 && gRes.data?.success && gRes.data?.data?.gradingRunId) {
    S.runs[key] = gRes.data.data.gradingRunId;
    ok(`Grade submission (${key})`, `runId=${S.runs[key]}`);
  } else {
    fail(`Grade submission (${key})`, `status=${gRes.status} — ${JSON.stringify(gRes.data)?.slice(0,150)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log('9. VALIDATE GRADING RUN DATA');
console.log('══════════════════════════════════════');

for (const [key, runId] of Object.entries(S.runs)) {
  const rRes = await api('GET', `/api/grading-runs/${runId}`);
  if (rRes.status === 200 && rRes.data?.data) {
    const gr = rRes.data.data;
    ok(`GET grading run (${key})`, `status=${gr.status}`);

    // Validate deterministic scoring separation
    const summary = gr.gradeSummary;
    if (summary) {
      ok(`  GradeSummary exists (${key})`, `recommended=${summary.recommendedScore}/${summary.maxScore}`);
      noNaN(summary, key);
      // finalScore not set yet (no human review) — should be null
      summary.score === null ? ok(`  finalScore=null before review (${key})`) : warn(`  finalScore pre-set`, `${summary.score}`);
    } else { fail(`  GradeSummary missing (${key})`); }

    const qGrades = gr.questionGrades ?? [];
    qGrades.length > 0 ? ok(`  QuestionGrade records (${key})`, `${qGrades.length} grades`) : fail(`  No QuestionGrade records (${key})`);

    const critEvals = gr.criterionEvaluations ?? [];
    if (key !== 'missing') {
      critEvals.length > 0 ? ok(`  CriterionEvaluation records (${key})`, `${critEvals.length}`) : warn(`  No CriterionEvaluation (${key})`);
    }

    // Prompt injection: check score isn't suspiciously high for injection test
    if (key === 'injection' && summary) {
      const pct = summary.maxScore > 0 ? summary.recommendedScore / summary.maxScore : 0;
      pct < 1.0 ? ok('  Injection score not 100%', `${(pct*100).toFixed(1)}%`) : warn('  Injection score is 100%', 'possible injection, review manually');
    }
  } else {
    fail(`GET grading run (${key})`, `status=${rRes.status}`);
  }
}

// Grading re-run idempotency
if (S.subs.partial?.id) {
  const reG = await api('POST', `/api/submissions/${S.subs.partial.id}/grade`);
  reG.status === 200 ? ok('Grading re-run (no crash)') : fail('Grading re-run', `${reG.status}`);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log('10. HUMAN REVIEW');
console.log('══════════════════════════════════════');

// Case A: Accept recommendation
const goodRunId = S.runs.good;
if (goodRunId) {
  const runBefore = await api('GET', `/api/grading-runs/${goodRunId}`);
  const recommendedScore = runBefore.data?.data?.gradeSummary?.recommendedScore ?? 75;
  const maxScore = runBefore.data?.data?.gradeSummary?.maxScore ?? 100;
  console.log(`  AI Recommended: ${recommendedScore}/${maxScore}`);

  // Case A: Human accepts recommendation (finalScore = recommendedScore)
  const revA = await api('POST', `/api/grading-runs/${goodRunId}`, {
    reviewerName: 'Dr. Integration Test',
    finalScore: recommendedScore,
    reviewerComment: 'Accepted AI recommendation. Thorough and accurate.',
  });
  if (revA.status === 200 && revA.data?.success) {
    ok('Human review: accept recommendation');
    const after = revA.data?.data;
    // Verify recommendedScore preserved
    const runAfterGet = await api('GET', `/api/grading-runs/${goodRunId}`);
    const grAfter = runAfterGet.data?.data;
    const recAfter = grAfter?.gradeSummary?.recommendedScore;
    const finalAfter = grAfter?.gradeSummary?.score;
    recAfter === recommendedScore ? ok('  AI recommendedScore preserved after review', `${recAfter}`) : fail('  AI recommendedScore changed', `was ${recommendedScore}, now ${recAfter}`);
    finalAfter !== null && finalAfter !== undefined ? ok('  finalScore set after review', `${finalAfter}`) : fail('  finalScore still null after review');
    console.log(`  Status after review: ${grAfter?.status}, finalScore: ${finalAfter}`);
  } else {
    fail('Human review: accept', `status=${revA.status} — ${JSON.stringify(revA.data)?.slice(0,120)}`);
  }
}

// Case B: Human adjusts score downward
const partialRunId = S.runs.partial;
if (partialRunId) {
  const runPBefore = await api('GET', `/api/grading-runs/${partialRunId}`);
  const recPartial = runPBefore.data?.data?.gradeSummary?.recommendedScore ?? 50;
  const humanScore = Math.max(0, recPartial - 10); // Adjust down
  console.log(`  Partial: AI recommended ${recPartial}, human adjusting to ${humanScore}`);

  const revB = await api('POST', `/api/grading-runs/${partialRunId}`, {
    reviewerName: 'Dr. Integration Test',
    finalScore: humanScore,
    reviewerComment: 'Adjusted — student missed required examples.',
  });
  if (revB.status === 200 && revB.data?.success) {
    ok('Human review: adjust score');
    const runPAfterGet = await api('GET', `/api/grading-runs/${partialRunId}`);
    const grP = runPAfterGet.data?.data;
    const recAfterP = grP?.gradeSummary?.recommendedScore;
    const finalAfterP = grP?.gradeSummary?.score;
    recAfterP === recPartial ? ok('  AI recommendedScore preserved', `${recAfterP}`) : fail('  AI recommendedScore changed', `was ${recPartial} now ${recAfterP}`);
    finalAfterP === humanScore ? ok('  Human finalScore stored correctly', `${finalAfterP}`) : fail('  finalScore mismatch', `expected ${humanScore} got ${finalAfterP}`);
  } else {
    fail('Human review: adjust', `status=${revB.status} — ${JSON.stringify(revB.data)?.slice(0,120)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log('11. GET /api/submissions/[id]/grade');
console.log('══════════════════════════════════════');

for (const [key, sub] of Object.entries(S.subs)) {
  const gr = await api('GET', `/api/submissions/${sub.id}/grade`);
  gr.status === 200 && gr.data?.success ? ok(`GET grade (${key})`) : warn(`GET grade (${key})`, `${gr.status}`);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log('12. ERROR HANDLING');
console.log('══════════════════════════════════════');

// Missing submission
const miss1 = await api('POST', '/api/submissions/nonexistent-id/extract-answers');
[400, 404, 500].includes(miss1.status) ? ok('Missing submission returns error', `${miss1.status}`) : fail('Missing submission no error', `${miss1.status}`);

// Missing grading run
const miss2 = await api('GET', '/api/grading-runs/nonexistent-id');
[404, 500].includes(miss2.status) ? ok('Missing grading run returns error', `${miss2.status}`) : fail('Missing grading run no error');

// Grade unextracted submission (no answerExtraction)
const newSub = await api('POST', `/api/assignments/${S.assignmentId}/submissions`, {
  studentName: 'NoExtract Test', studentId: 'no-extract', documentId: null,
});
if (newSub.status === 201) {
  const grBad = await api('POST', `/api/submissions/${newSub.data.submission.id}/grade`);
  [400, 500].includes(grBad.status) ? ok('Grade without extraction returns error', `${grBad.status}`) : fail('Grade without extraction no error', `${grBad.status}`);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log('FINAL REPORT');
console.log('══════════════════════════════════════');
console.log(`  PASS:  ${PASS}`);
console.log(`  FAIL:  ${FAIL}`);
console.log(`  WARN:  ${WARN}`);
console.log(`  Total: ${PASS + FAIL + WARN}`);
console.log('');
if (FAIL === 0) console.log('  ✓ OVERALL: PASS');
else if (FAIL <= 3) console.log('  ⚠ OVERALL: PASS WITH ISSUES');
else console.log('  ✗ OVERALL: BLOCKED');

if (FAILURES.length) {
  console.log('\nFailed tests:');
  FAILURES.forEach(f => console.log(`  ✗ ${f.label}: ${f.detail}`));
}
if (WARNINGS.length) {
  console.log('\nWarnings:');
  WARNINGS.forEach(w => console.log(`  ⚠ ${w.label}: ${w.detail}`));
}

import { writeFileSync } from 'fs';
writeFileSync('./test-state.json', JSON.stringify({ S, PASS, FAIL, WARN, FAILURES, WARNINGS }, null, 2));
console.log('\nState saved to test-state.json');
