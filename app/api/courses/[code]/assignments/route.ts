/**
 * GET /api/courses/[code]/assignments
 * POST /api/courses/[code]/assignments
 * 
 * List and create assignments for a course
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import type { CreateAssignmentRequest } from '@/src/types';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;

    if (code !== 'PBO' && code !== 'SISOP') {
      return NextResponse.json(
        { error: 'Invalid course code' },
        { status: 400 }
      );
    }

    const course = await prisma.course.findUnique({
      where: { code },
    });

    if (!course) {
      return NextResponse.json(
        { error: 'Course not found' },
        { status: 404 }
      );
    }

    const assignments = await prisma.assignment.findMany({
      where: {
        courseId: course.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        _count: {
          select: {
            questions: true,
            submissions: true,
          },
        },
      },
    });

    return NextResponse.json({ assignments });
  } catch (error) {
    console.error('Error fetching assignments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch assignments' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;

    if (code !== 'PBO' && code !== 'SISOP') {
      return NextResponse.json(
        { error: 'Invalid course code' },
        { status: 400 }
      );
    }

    const course = await prisma.course.findUnique({
      where: { code },
    });

    if (!course) {
      return NextResponse.json(
        { error: 'Course not found' },
        { status: 404 }
      );
    }

    const body: CreateAssignmentRequest = await request.json();

    if (!body.title || body.title.trim() === '') {
      return NextResponse.json(
        { error: 'Assignment title is required' },
        { status: 400 }
      );
    }

    const assignment = await prisma.assignment.create({
      data: {
        courseId: course.id,
        title: body.title.trim(),
        description: body.description?.trim() || null,
        status: body.status || 'draft',
      },
    });

    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error) {
    console.error('Error creating assignment:', error);
    return NextResponse.json(
      { error: 'Failed to create assignment' },
      { status: 500 }
    );
  }
}
