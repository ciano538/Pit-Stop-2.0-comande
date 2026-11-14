import { NextResponse } from 'next/server';
import { checkPin, enqueueTest, unauthorized } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!checkPin(req)) return unauthorized();
  await enqueueTest();
  return NextResponse.json({ ok: true });
}
