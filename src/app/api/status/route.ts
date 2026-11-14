import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { bridgeStatus, pinRequired } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    ...(await bridgeStatus()),
    storage: store.kind,
    pinRequired: pinRequired(),
  });
}
