import OpenAI from 'openai';
import { getProviderApiKey } from '@/src/config/ai';
import { OpenAICompatibleService } from './openai-compatible';

/** DeepSeek provider using its OpenAI-compatible chat completions API. */
export class DeepSeekService extends OpenAICompatibleService {
  constructor() {
    super('deepseek');
  }

  protected override createClient(): OpenAI {
    // Validate first so a missing/blank key produces the application's safe error.
    getProviderApiKey('deepseek');

    return new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      timeout: 60_000,
      maxRetries: 0,
    });
  }
}

export const deepSeekService = new DeepSeekService();
