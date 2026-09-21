/**
 * GET /api/courses/[code]
 * 
 * Get course details by code (PBO or SISOP)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;

    if (code !== 'PBO' && code !== 'SISOP') {
      return NextResponse.json(
        { error: 'Invalid course code. Must be PBO or SISOP' },
        { status: 400 }
      );
    }

    const course = await prisma.course.findUnique({
      where: { code },
      include: {
        _count: {
          select: {
            assignments: true,
          },
        },
      },
    });

    if (!course) {
      return NextResponse.json(
        { error: 'Course not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ course });
  } catch (error) {
    console.error('Error fetching course:', error);
    return NextResponse.json(
      { error: 'Failed to fetch course' },
      { status: 500 }
    );
  }
}
