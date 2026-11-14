import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { ITEM_MAP, CAT_MAP, TABLES } from '@/lib/menu';
import {
  bridgeStatus,
  checkPin,
  checkTableCode,
  clientIp,
  enqueueOrder,
  hit,
  isShiftOpen,
  romeDay,
  unauthorized,
} from '@/lib/server';
import type { CartLineInput, Lang, Order, OrderLine } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Personale (PIN). ?day=YYYYMMDD per un altro giorno, ?all=1 per le ultime 100 di tutti i giorni. Default: oggi. */
export async function GET(req: Request) {
  if (!checkPin(req)) return unauthorized();
  const url = new URL(req.url);
  const all = url.searchParams.get('all') === '1';
  const day = /^\d{8}$/.test(url.searchParams.get('day') || '') ? url.searchParams.get('day')! : romeDay();
  const ids = await store.lrange('orders', 0, 199);
  const orders: Order[] = [];
  for (const id of ids) {
    if (!all && !id.startsWith(day + '-')) continue;
    const o = await store.get<Order>(`order:${id}`);
    if (o) orders.push(o);
    if (orders.length >= 100) break;
  }
  return NextResponse.json({ orders, day: all ? null : day });
}

export async function POST(req: Request) {
  let body: {
    clientId?: string;
    table?: number;
    covers?: number;
    note?: string;
    lang?: Lang;
    k?: string;
    lines?: CartLineInput[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  const table = Number(body.table);
  if (!Number.isInteger(table) || table < 1 || table > TABLES) {
    return NextResponse.json({ error: 'bad_table' }, { status: 400 });
  }

  // chi invia? cliente (codice del tavolo nel QR) oppure personale (PIN)
  const customer = typeof body.k === 'string' && body.k.length > 0;
  if (customer) {
    if (!checkTableCode(table, body.k)) return NextResponse.json({ error: 'bad_code' }, { status: 403 });
    if (!(await isShiftOpen())) return NextResponse.json({ error: 'closed' }, { status: 403 });
  } else if (!checkPin(req)) {
    return unauthorized();
  }

  // doppio tap / retry: stessa richiesta = stesso ordine
  if (body.clientId) {
    const prev = await store.get<{ id: string; number: number }>(`dedupe:${body.clientId}`);
    if (prev) return NextResponse.json({ ok: true, ...prev, duplicate: true });
  }

  const maxLines = customer ? 30 : 80;
  const maxQty = customer ? 20 : 99;
  if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > maxLines) {
    return NextResponse.json({ error: 'empty' }, { status: 400 });
  }

  const lines: OrderLine[] = [];
  for (const raw of body.lines) {
    const item = ITEM_MAP[raw.itemId];
    const qty = Math.floor(Number(raw.qty));
    if (!item || !(qty >= 1 && qty <= maxQty)) {
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

  // anti-spam solo per i clienti: 1 invio ogni 15 s per tavolo, max 8 invii/10 min per tavolo, max 25/10 min per rete
  if (customer) {
    if ((await hit(`rl15:${table}`, 15)) > 1) return NextResponse.json({ error: 'too_fast' }, { status: 429 });
    if ((await hit(`rlt:${table}`, 600)) > 8) return NextResponse.json({ error: 'too_many' }, { status: 429 });
    if ((await hit(`rli:${clientIp(req)}`, 600)) > 25) return NextResponse.json({ error: 'too_many' }, { status: 429 });
  }

  const day = romeDay();
  const number = await store.incr(`seq:${day}`, 60 * 60 * 36);
  const covers = Math.floor(Number(body.covers));
  const order: Order = {
    id: `${day}-${number}`,
    number,
    source: customer ? 'customer' : 'staff',
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
