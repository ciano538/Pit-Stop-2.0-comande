import { NextResponse } from 'next/server';
import { TABLES } from '@/lib/menu';
import { checkPin, tableCode, unauthorized } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** Solo personale: codici per stampare i QR dei tavoli */
export async function GET(req: Request) {
  if (!checkPin(req)) return unauthorized();
  if (!process.env.TABLE_SECRET && !process.env.BRIDGE_TOKEN) {
    return NextResponse.json({ error: 'no_secret' }, { status: 500 });
  }
  const tables = Array.from({ length: TABLES }, (_, i) => ({ table: i + 1, code: tableCode(i + 1) }));
  return NextResponse.json({ tables, dedicatedSecret: !!process.env.TABLE_SECRET });
}
