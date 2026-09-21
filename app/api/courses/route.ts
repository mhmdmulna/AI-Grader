/**
 * GET /api/courses
 * 
 * List all courses (PBO and SISOP)
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';

export async function GET() {
  try {
    const courses = await prisma.course.findMany({
      orderBy: {
        code: 'asc',
      },
      include: {
        _count: {
          select: {
            assignments: true,
          },
        },
      },
    });

    return NextResponse.json({ courses });
  } catch (error) {
    console.error('Error fetching courses:', error);
    return NextResponse.json(
      { error: 'Failed to fetch courses' },
      { status: 500 }
    );
  }
}
