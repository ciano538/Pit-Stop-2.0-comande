import { NextResponse } from 'next/server';
import { TABLES } from '@/lib/menu';
import { checkPin, closeTable, enqueueBill, getTable, openTable, tableOrders, unauthorized } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** Cassa (PIN): stato e totale di tutti i tavoli */
export async function GET(req: Request) {
  if (!checkPin(req)) return unauthorized();
  const tables = await Promise.all(
    Array.from({ length: TABLES }, (_, i) => i + 1).map(async (table) => {
      const [st, orders] = await Promise.all([getTable(table), tableOrders(table)]);
      return {
        table,
        open: !!st?.open,
        since: st?.since ?? null,
        orders: orders.length,
        customerOrders: orders.filter((o) => o.source === 'customer').length,
        total: orders.reduce((s, o) => s + o.total, 0),
      };
    }),
  );
  return NextResponse.json({ tables });
}

/** Cassa (PIN): { table, action: 'open' | 'close' | 'bill' } */
export async function POST(req: Request) {
  if (!checkPin(req)) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { table?: number; action?: string };
  const table = Number(body.table);
  if (!Number.isInteger(table) || table < 1 || table > TABLES) {
    return NextResponse.json({ error: 'bad_table' }, { status: 400 });
  }
  if (body.action === 'open') {
    await openTable(table);
  } else if (body.action === 'close') {
    await closeTable(table);
  } else if (body.action === 'bill') {
    const orders = await tableOrders(table);
    if (!orders.length) return NextResponse.json({ error: 'empty' }, { status: 400 });
    await enqueueBill(table, orders);
  } else {
    return NextResponse.json({ error: 'bad_action' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
