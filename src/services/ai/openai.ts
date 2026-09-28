import { OpenAICompatibleService } from './openai-compatible';

/** Optional OpenAI provider retained for explicit AI_PROVIDER=openai use. */
export class OpenAIService extends OpenAICompatibleService {
  constructor() {
    super('openai');
  }
}

export const openAIService = new OpenAIService();
