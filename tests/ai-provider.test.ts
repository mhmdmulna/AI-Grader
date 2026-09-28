import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import test from 'node:test';
import {
  AI_PROVIDERS,
  DEFAULT_AI_PROVIDER,
  getProviderApiKey,
  resolveAIProvider,
} from '@/src/config/ai';
import { AIServiceError } from '@/src/services/ai/errors';
import { parseStructuredJson } from '@/src/services/ai/json';
import { getAIService } from '@/src/services/ai';
import {
  isAnswerExtractionResponse,
  isCriterionEvaluationResponse,
  isFeedbackResponse,
  isQuestionExtractionResponse,
} from '@/src/services/ai/validation';

test('provider selection defaults to DeepSeek', () => {
  const previous = process.env.AI_PROVIDER;
  delete process.env.AI_PROVIDER;

  try {
    assert.equal(DEFAULT_AI_PROVIDER, 'deepseek');
    assert.equal(resolveAIProvider(), 'deepseek');
    assert.equal(getAIService().provider, 'deepseek');
  } finally {
    if (previous === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previous;
  }
});

test('DeepSeek default configuration is correct', () => {
  assert.deepEqual(AI_PROVIDERS.deepseek, {
    enabled: true,
    defaultModel: 'deepseek-chat',
    modelEnvVar: 'DEEPSEEK_MODEL',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    defaultBaseUrl: 'https://api.deepseek.com',
    baseUrlEnvVar: 'DEEPSEEK_BASE_URL',
  });
});

test('missing DeepSeek API key produces an actionable safe error', async () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;

  try {
    assert.throws(
      () => getProviderApiKey('deepseek'),
      (error: unknown) => {
        assert.ok(error instanceof AIServiceError);
        assert.equal(error.provider, 'deepseek');
        assert.equal(error.code, 'configuration_error');
        assert.match(error.message, /DEEPSEEK_API_KEY/);
        assert.doesNotMatch(error.message, /Bearer|sk-/i);
        return true;
      }
    );
    await assert.rejects(
      () => getAIService('deepseek').complete({ prompt: 'No network request should be made.' }),
      (error: unknown) => error instanceof AIServiceError &&
        error.provider === 'deepseek' &&
        error.code === 'configuration_error'
    );
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
  }
});

test('valid and fenced JSON responses parse successfully', () => {
  assert.deepEqual(parseStructuredJson('{"score": 8}'), { score: 8 });
  assert.deepEqual(parseStructuredJson('```json\n{"score": 8}\n```'), { score: 8 });
});

test('malformed JSON responses are rejected', () => {
  assert.throws(() => parseStructuredJson('{"score": }'), SyntaxError);
  assert.throws(() => parseStructuredJson('result: {"score": 8}'), SyntaxError);
});

test('extraction, evaluation, and feedback schemas validate backend responses', () => {
  assert.equal(isQuestionExtractionResponse({
    questions: [{ number: 1, type: 'text', content: 'Explain X', sourcePages: [1] }],
  }), true);
  assert.equal(isQuestionExtractionResponse({ questions: [{ number: '1' }] }), false);

  assert.equal(isAnswerExtractionResponse({
    answers: [{ questionNumber: 1, content: 'Answer', sourcePages: [2], confidence: 0.9 }],
  }), true);
  assert.equal(isAnswerExtractionResponse({
    answers: [{ questionNumber: 1, content: 'Answer', sourcePages: [2], confidence: 2 }],
  }), false);

  assert.equal(isCriterionEvaluationResponse({
    recommendedScore: 8,
    reasoning: 'Grounded in the submitted answer.',
    evidenceReferences: ['page-2'],
    confidence: 0.85,
  }), true);
  assert.equal(isCriterionEvaluationResponse({
    recommendedScore: 8,
    reasoning: 'Missing confidence.',
    evidenceReferences: [],
  }), false);

  assert.equal(isFeedbackResponse({
    strength: 'Clear explanation',
    improvement: 'Add an example',
    evidenceReferences: ['page-2'],
    suggestions: ['Include a concrete example'],
  }), true);
  assert.equal(isFeedbackResponse({ strength: 'Incomplete' }), false);
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.ts', '.tsx', '.js', '.jsx'].includes(extname(entry.name)) ? [path] : [];
  });
}

test('AI secrets are not exposed through public environment variables or client modules', () => {
  const envTemplate = readFileSync('.env.example', 'utf8');
  assert.doesNotMatch(envTemplate, /NEXT_PUBLIC_(?:DEEPSEEK|OPENAI)_API_KEY/);

  for (const file of [...sourceFiles('app'), ...sourceFiles('src')]) {
    const content = readFileSync(file, 'utf8');
    if (/^\s*['"]use client['"]/m.test(content)) {
      assert.doesNotMatch(content, /DEEPSEEK_API_KEY|OPENAI_API_KEY/);
    }
  }

  const providerSource = readFileSync('src/config/ai.ts', 'utf8');
  assert.doesNotMatch(providerSource, /(?:sk-|Bearer\s+)[A-Za-z0-9_-]{12,}/);
});
