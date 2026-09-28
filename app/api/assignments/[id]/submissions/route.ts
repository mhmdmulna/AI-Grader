/**
 * POST /api/assignments/[id]/submissions
 *
 * Create a student submission for an assignment.
 * The submission is linked to an already-uploaded document.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: assignmentId } = await params;

    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignment) {
      return NextResponse.json(
        { error: 'Assignment not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { studentName, studentId, documentId } = body;

    if (!studentName || !studentId) {
      return NextResponse.json(
        { error: 'studentName and studentId are required' },
        { status: 400 }
      );
    }

    // Validate document exists if provided
    if (documentId) {
      const doc = await prisma.document.findUnique({ where: { id: documentId } });
      if (!doc) {
        return NextResponse.json(
          { error: 'Document not found' },
          { status: 404 }
        );
      }
      if (doc.documentType !== 'student_submission') {
        return NextResponse.json(
          { error: 'Document must be of type student_submission' },
          { status: 400 }
        );
      }
    }

    const submission = await prisma.submission.create({
      data: {
        assignmentId,
        studentName: studentName.trim(),
        studentId: studentId.trim(),
        documentId: documentId || null,
        pdfUrl: documentId || '', // Legacy field — use documentId as fallback
        status: 'uploaded',
      },
    });

    return NextResponse.json({ submission }, { status: 201 });
  } catch (error) {
    console.error('Error creating submission:', error);
    return NextResponse.json(
      { error: 'Failed to create submission' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: assignmentId } = await params;

    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignment) {
      return NextResponse.json(
        { error: 'Assignment not found' },
        { status: 404 }
      );
    }

    const submissions = await prisma.submission.findMany({
      where: { assignmentId },
      orderBy: { createdAt: 'desc' },
      include: {
        document: {
          select: {
            id: true,
            originalFilename: true,
            processingStatus: true,
            hasText: true,
          },
        },
        answerExtraction: {
          select: {
            id: true,
            status: true,
            answerCount: true,
          },
        },
        gradingRun: {
          select: {
            id: true,
            status: true,
            gradeSummary: {
              select: {
                recommendedScore: true,
                maxScore: true,
                score: true,
                status: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json({ submissions });
  } catch (error) {
    console.error('Error fetching submissions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch submissions' },
      { status: 500 }
    );
  }
}
