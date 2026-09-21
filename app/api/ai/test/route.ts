/**
 * Test API route to verify AI service configuration
 * 
 * This demonstrates:
 * 1. Server-side only AI calls
 * 2. API key security (never exposed to client)
 * 3. Error handling
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAIService } from '@/src/services/ai';

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

    // Get AI service (defaults to OpenAI)
    const aiService = getAIService('openai');

    // Check if configured
    if (!aiService.isConfigured()) {
      return NextResponse.json(
        { error: 'AI service not configured. Check environment variables.' },
        { status: 503 }
      );
    }

    // Call AI service (server-side only)
    const response = await aiService.complete({ prompt });

    return NextResponse.json({
      success: true,
      response: response.content,
      provider: response.provider,
      model: response.model,
      usage: response.usage,
    });
  } catch (error) {
    console.error('AI test route error:', error);
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
