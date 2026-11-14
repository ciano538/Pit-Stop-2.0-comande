import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { checkBridge, unauthorized } from '@/lib/server';
import type { PrintJob } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Il bridge in sala interroga questo endpoint ogni ~2 s.
 * ?p=ok|ko  → stato dell'ultima stampa (per l'indicatore nell'app)
 * Restituisce fino a 10 lavori in ordine di arrivo. I lavori restano in coda finché
 * il bridge non li conferma con /api/bridge/ack (nessuna perdita se il bridge cade).
 */
export async function GET(req: Request) {
  if (!checkBridge(req)) return unauthorized();
  const p = new URL(req.url).searchParams.get('p') === 'ko' ? 'ko' : 'ok';
  await store.set('bridge:hb', { t: Date.now(), p }, 120);

  const ids = await store.lrange('printq', 0, 9);
  const jobs: PrintJob[] = [];
  for (const id of ids) {
    const job = await store.get<PrintJob>(`job:${id}`);
    if (job) jobs.push(job);
    else await store.lrem('printq', id); // scaduto
  }
  return NextResponse.json({ jobs });
}
