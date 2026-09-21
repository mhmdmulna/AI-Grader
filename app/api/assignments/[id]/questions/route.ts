/**
 * POST /api/assignments/[id]/questions
 * 
 * Create a question for an assignment
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import type { CreateQuestionRequest } from '@/src/types';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const assignment = await prisma.assignment.findUnique({
      where: { id },
    });

    if (!assignment) {
      return NextResponse.json(
        { error: 'Assignment not found' },
        { status: 404 }
      );
    }

    const body: CreateQuestionRequest = await request.json();

    if (!body.text || body.text.trim() === '') {
      return NextResponse.json(
        { error: 'Question text is required' },
        { status: 400 }
      );
    }

    if (typeof body.questionNumber !== 'number' || body.questionNumber < 1) {
      return NextResponse.json(
        { error: 'Valid question number is required' },
        { status: 400 }
      );
    }

    if (typeof body.points !== 'number' || body.points < 0) {
      return NextResponse.json(
        { error: 'Valid points value is required' },
        { status: 400 }
      );
    }

    // Check if question number already exists
    const existing = await prisma.question.findUnique({
      where: {
        assignmentId_questionNumber: {
          assignmentId: id,
          questionNumber: body.questionNumber,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Question ${body.questionNumber} already exists` },
        { status: 409 }
      );
    }

    const question = await prisma.question.create({
      data: {
        assignmentId: id,
        questionNumber: body.questionNumber,
        text: body.text.trim(),
        points: body.points,
        rubric: body.rubric?.trim() || null,
        expectedCriteria: body.expectedCriteria?.trim() || null,
      },
    });

    return NextResponse.json({ question }, { status: 201 });
  } catch (error) {
    console.error('Error creating question:', error);
    return NextResponse.json(
      { error: 'Failed to create question' },
      { status: 500 }
    );
  }
}
