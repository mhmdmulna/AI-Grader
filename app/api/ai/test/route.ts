/**
 * Test API route to verify AI service configuration
 * 
 * This demonstrates:
 * 1. Server-side only AI calls
 * 2. API key security (never exposed to client)
 * 3. Error handling
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  AIServiceError,
  getAIErrorResponse,
  getAIService,
} from '@/src/services/ai';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt } = body;

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid prompt' },
        { status: 400 }
      );
    }

    // Get the configured AI service (defaults to DeepSeek).
    const aiService = getAIService();

    // Call AI service (server-side only)
    const response = await aiService.complete({ prompt });

    return NextResponse.json({
      success: true,
      response: response.content,
      provider: response.provider,
      model: response.model,
      promptVersion: response.promptVersion,
      usage: response.usage,
      requestLatencyMs: response.requestLatencyMs,
    });
  } catch (error) {
    if (error instanceof AIServiceError) {
      console.error('AI test route error:', error.toSafeLog());
      const response = getAIErrorResponse(error);
      return NextResponse.json(response.body, { status: response.status });
    }

    console.error('AI test route error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      {
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}
