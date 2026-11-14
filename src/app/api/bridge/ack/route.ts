import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { checkBridge, unauthorized } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!checkBridge(req)) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string') : [];
  for (const id of ids) {
    await store.lrem('printq', id);
    await store.del(`job:${id}`);
  }
  return NextResponse.json({ ok: true, acked: ids.length });
}
