/**
 * GET /api/assignments/[id]
 * 
 * Get assignment details including questions and criteria
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: {
        course: true,
        questions: {
          orderBy: {
            questionNumber: 'asc',
          },
        },
        criteria: {
          orderBy: [
            { questionId: 'asc' },
            { order: 'asc' },
          ],
        },
        _count: {
          select: {
            submissions: true,
          },
        },
      },
    });

    if (!assignment) {
      return NextResponse.json(
        { error: 'Assignment not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      assignment,
      questions: assignment.questions,
      criteria: assignment.criteria,
    });
  } catch (error) {
    console.error('Error fetching assignment:', error);
    return NextResponse.json(
      { error: 'Failed to fetch assignment' },
      { status: 500 }
    );
  }
}
