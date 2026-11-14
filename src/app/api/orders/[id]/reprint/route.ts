import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { checkPin, enqueueOrder, unauthorized } from '@/lib/server';
import type { Order } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!checkPin(req)) return unauthorized();
  const order = await store.get<Order>(`order:${params.id}`);
  if (!order) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await enqueueOrder(order, true);
  return NextResponse.json({ ok: true });
}
