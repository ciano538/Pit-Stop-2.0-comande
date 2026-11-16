import { NextResponse } from 'next/server';
import { checkTableCode, getTable, isShiftOpen } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** Cliente (codice del QR): il suo tavolo è attivo? */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const table = Number(u.searchParams.get('t'));
  if (!Number.isInteger(table) || !checkTableCode(table, u.searchParams.get('k'))) {
    return NextResponse.json({ error: 'bad_code' }, { status: 403 });
  }
  const [shift, st] = await Promise.all([isShiftOpen(), getTable(table)]);
  return NextResponse.json({ shift, open: !!st?.open, sid: st?.sid ?? '' });
}
