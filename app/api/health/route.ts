import { NextResponse } from 'next/server';
import { prisma } from '@/src/lib/prisma';
import { createOperationalHealthService } from '@/src/services/health/health.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const healthService = createOperationalHealthService(prisma);

export async function GET() {
  const health = await healthService.check();
  return NextResponse.json(health, {
    status: health.status === 'ready' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
