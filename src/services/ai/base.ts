/**
 * Base AI service interface
 * 
 * This defines the contract that all AI provider implementations must follow.
 * Each provider (OpenAI, Claude, Gemini) will implement this interface.
 */

import { AIRequest, AIResponse } from '@/src/types';

export interface IAIService {
  /**
   * Send a completion request to the AI provider
   */
  complete(request: AIRequest): Promise<AIResponse>;
  
  /**
   * Check if the service is properly configured
   */
  isConfigured(): boolean;
}
