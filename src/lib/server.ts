import crypto from 'node:crypto';
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

/* ---------- Ordinazione da parte dei clienti (QR al tavolo) ---------- */

/** Segreto per i codici dei QR: TABLE_SECRET (consigliato), altrimenti BRIDGE_TOKEN */
function tableSecret() {
  return process.env.TABLE_SECRET || process.env.BRIDGE_TOKEN || '';
}

/** Codice segreto del tavolo, fisso nel tempo (quindi il QR stampato resta valido) */
export function tableCode(table: number) {
  return crypto.createHmac('sha256', tableSecret()).update(`table:${table}`).digest('hex').slice(0, 10);
}

export function checkTableCode(table: number, k: unknown) {
  if (!tableSecret() || typeof k !== 'string') return false;
  const a = Buffer.from(tableCode(table));
  const b = Buffer.from(k);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Turno aperto = i clienti possono ordinare. Si chiude da solo dopo 14 ore (se ci si dimentica). */
export async function isShiftOpen() {
  const s = await store.get<{ open: boolean }>('shift');
  return !!s?.open;
}
export async function setShift(open: boolean) {
  if (open) await store.set('shift', { open: true, since: Date.now() }, 60 * 60 * 14);
  else await store.del('shift');
}

/** Contatore a finestra: restituisce quante volte la chiave è stata usata negli ultimi `ttl` secondi */
export const hit = (key: string, ttl: number) => store.incr(key, ttl);

export const clientIp = (req: Request) =>
  req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

/** Giorno corrente a Roma, formato YYYYMMDD (stesso prefisso degli id delle comande) */
export const romeDay = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date()).replace(/-/g, '');
