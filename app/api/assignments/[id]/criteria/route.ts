/**
 * POST /api/assignments/[id]/criteria
 * 
 * Create a grading criterion for an assignment
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import type { CreateCriterionRequest } from '@/src/types';

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

    const body: CreateCriterionRequest = await request.json();

    if (!body.questionId || !body.name || !body.description) {
      return NextResponse.json(
        { error: 'Question ID, name, and description are required' },
        { status: 400 }
      );
    }

    if (typeof body.maxPoints !== 'number' || body.maxPoints < 0) {
      return NextResponse.json(
        { error: 'Valid maxPoints value is required' },
        { status: 400 }
      );
    }

    // Verify question exists and belongs to this assignment
    const question = await prisma.question.findUnique({
      where: { id: body.questionId },
    });

    if (!question || question.assignmentId !== id) {
      return NextResponse.json(
        { error: 'Question not found or does not belong to this assignment' },
        { status: 404 }
      );
    }

    const criterion = await prisma.gradingCriterion.create({
      data: {
        assignmentId: id,
        questionId: body.questionId,
        name: body.name.trim(),
        description: body.description.trim(),
        maxPoints: body.maxPoints,
        order: body.order ?? 0,
      },
    });

    return NextResponse.json({ criterion }, { status: 201 });
  } catch (error) {
    console.error('Error creating criterion:', error);
    return NextResponse.json(
      { error: 'Failed to create criterion' },
      { status: 500 }
    );
  }
}
