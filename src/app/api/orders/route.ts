import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { ITEM_MAP, CAT_MAP, TABLES } from '@/lib/menu';
import { bridgeStatus, checkPin, enqueueOrder, unauthorized } from '@/lib/server';
import type { CartLineInput, Lang, Order, OrderLine } from '@/lib/types';

export const dynamic = 'force-dynamic';

const romeDay = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date()).replace(/-/g, '');

export async function GET(req: Request) {
  if (!checkPin(req)) return unauthorized();
  const ids = await store.lrange('orders', 0, 49);
  const orders: Order[] = [];
  for (const id of ids) {
    const o = await store.get<Order>(`order:${id}`);
    if (o) orders.push(o);
  }
  return NextResponse.json({ orders });
}

export async function POST(req: Request) {
  if (!checkPin(req)) return unauthorized();

  let body: {
    clientId?: string;
    table?: number;
    covers?: number;
    note?: string;
    lang?: Lang;
    lines?: CartLineInput[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  // doppio tap / retry: stessa richiesta = stesso ordine
  if (body.clientId) {
    const prev = await store.get<{ id: string; number: number }>(`dedupe:${body.clientId}`);
    if (prev) return NextResponse.json({ ok: true, ...prev, duplicate: true });
  }

  const table = Number(body.table);
  if (!Number.isInteger(table) || table < 1 || table > TABLES) {
    return NextResponse.json({ error: 'bad_table' }, { status: 400 });
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 80) {
    return NextResponse.json({ error: 'empty' }, { status: 400 });
  }

  const lines: OrderLine[] = [];
  for (const raw of body.lines) {
    const item = ITEM_MAP[raw.itemId];
    const qty = Math.floor(Number(raw.qty));
    if (!item || !(qty >= 1 && qty <= 99)) {
      return NextResponse.json({ error: 'bad_line', itemId: raw.itemId }, { status: 400 });
    }
    let opt: string | undefined;
    if (item.opts) {
      const idx = Number(raw.opt);
      if (!Number.isInteger(idx) || !item.opts[idx]) {
        return NextResponse.json({ error: 'missing_option', itemId: item.id }, { status: 400 });
      }
      opt = item.opts[idx].it;
    }
    const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 140) : '';
    lines.push({
      name: item.name.it,
      opt,
      qty,
      price: item.price,
      note: note || undefined,
      station: CAT_MAP[item.cat].station,
    });
  }

  const day = romeDay();
  const number = await store.incr(`seq:${day}`, 60 * 60 * 36);
  const covers = Math.floor(Number(body.covers));
  const order: Order = {
    id: `${day}-${number}`,
    number,
    table,
    covers: covers >= 1 && covers <= 60 ? covers : undefined,
    note: typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : undefined,
    lang: (['it', 'en', 'de'] as const).includes(body.lang as Lang) ? (body.lang as Lang) : 'it',
    createdAt: new Date().toISOString(),
    lines,
    total: lines.reduce((s, l) => s + l.price * l.qty, 0),
  };

  await store.set(`order:${order.id}`, order, 60 * 60 * 24 * 3);
  await store.lpush('orders', order.id);
  await store.ltrim('orders', 0, 199);
  await enqueueOrder(order);

  const result = { id: order.id, number: order.number };
  if (body.clientId) await store.set(`dedupe:${body.clientId}`, result, 300);

  const status = await bridgeStatus();
  return NextResponse.json({ ok: true, ...result, printerOnline: status.printer });
}
