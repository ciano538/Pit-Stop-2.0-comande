import { NextResponse } from 'next/server';
import { checkPin, isShiftOpen, setShift, unauthorized } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** Pubblico: i clienti leggono se le ordinazioni sono aperte */
export async function GET() {
  return NextResponse.json({ open: await isShiftOpen() });
}

/** Solo personale (PIN): apre/chiude le ordinazioni */
export async function POST(req: Request) {
  if (!checkPin(req)) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { open?: boolean };
  await setShift(!!body.open);
  return NextResponse.json({ ok: true, open: !!body.open });
}
