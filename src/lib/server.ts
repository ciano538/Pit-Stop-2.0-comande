import { NextResponse } from 'next/server';
import { store } from './store';
import { cassaTicket, kitchenTicket, testTicket } from './escpos';
import type { Order, PrintJob } from './types';

/** PIN opzionale per camerieri: se STAFF_PIN è impostato, serve l'header x-staff-pin */
export function pinRequired() {
  return !!process.env.STAFF_PIN;
}
export function checkPin(req: Request) {
  const pin = process.env.STAFF_PIN;
  if (!pin) return true;
  return req.headers.get('x-staff-pin') === pin;
}

/** Il bridge di stampa si autentica con BRIDGE_TOKEN */
export function checkBridge(req: Request) {
  const t = process.env.BRIDGE_TOKEN;
  if (!t) return false;
  return req.headers.get('authorization') === `Bearer ${t}`;
}

export const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 });

export async function enqueue(job: PrintJob) {
  await store.set(`job:${job.id}`, job, 60 * 60 * 24);
  await store.rpush('printq', job.id);
}

/** Crea i due ticket (cucina + cassa) e li mette in coda per il bridge */
export async function enqueueOrder(order: Order, reprint = false) {
  const tag = reprint ? `r${Date.now().toString(36)}` : 'n';
  await enqueue({
    id: `${order.id}-${tag}-k`,
    target: 'kitchen',
    label: `Tavolo ${order.table} #${order.number} cucina`,
    data: kitchenTicket(order, reprint).toString('base64'),
  });
  await enqueue({
    id: `${order.id}-${tag}-c`,
    target: 'cassa',
    label: `Tavolo ${order.table} #${order.number} cassa`,
    data: cassaTicket(order, reprint).toString('base64'),
  });
}

export async function enqueueTest() {
  const t = Date.now().toString(36);
  for (const target of ['kitchen', 'cassa'] as const) {
    await enqueue({
      id: `test-${t}-${target}`,
      target,
      label: `Test ${target}`,
      data: testTicket(target === 'kitchen' ? 'CUCINA' : 'CASSA').toString('base64'),
    });
  }
}

export async function bridgeStatus() {
  const hb = await store.get<{ t: number; p: string }>('bridge:hb');
  const age = hb ? Date.now() - hb.t : Infinity;
  const online = age < 45_000;
  return {
    bridge: online,
    printer: online && hb?.p === 'ok',
    pending: await store.llen('printq'),
  };
}
