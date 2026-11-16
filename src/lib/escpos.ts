import iconv from 'iconv-lite';
import type { Order, OrderLine, Station } from './types';

/** Colonne di stampa: 48 per carta 80 mm (Epson TM-T80/T88/T20, Font A). Per carta 58 mm usa 32. */
const COLS = Number(process.env.PRINT_COLS) || 48;

const clean = (s: string) =>
  s
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/½/g, '1/2')
    .replace(/¼/g, '1/4');

class Esc {
  private c: Buffer[] = [];
  raw(...b: number[]) {
    this.c.push(Buffer.from(b));
    return this;
  }
  text(s: string) {
    this.c.push(iconv.encode(clean(s), 'cp858'));
    return this;
  }
  ln(s = '') {
    return this.text(s).raw(0x0a);
  }
  /** reset + code page CP858 (Europa occidentale con €) */
  init() {
    return this.raw(0x1b, 0x40, 0x1b, 0x74, 19);
  }
  align(a: 'l' | 'c' | 'r') {
    return this.raw(0x1b, 0x61, a === 'l' ? 0 : a === 'c' ? 1 : 2);
  }
  bold(on: boolean) {
    return this.raw(0x1b, 0x45, on ? 1 : 0);
  }
  size(w: 1 | 2 | 3, h: 1 | 2 | 3) {
    return this.raw(0x1d, 0x21, ((w - 1) << 4) | (h - 1));
  }
  feed(n: number) {
    return this.raw(0x1b, 0x64, n);
  }
  cut() {
    return this.feed(3).raw(0x1d, 0x56, 0x42, 0x00);
  }
  build() {
    return Buffer.concat(this.c);
  }
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of clean(text).split(/\s+/)) {
    if (!word) continue;
    if ((cur + ' ' + word).trim().length <= width) cur = (cur + ' ' + word).trim();
    else {
      if (cur) out.push(cur);
      cur = word;
      while (cur.length > width) {
        out.push(cur.slice(0, width));
        cur = cur.slice(width);
      }
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

const eur = (c: number) => (c / 100).toFixed(2).replace('.', ',');
const rule = (ch = '-') => ch.repeat(COLS);

function lr(left: string, right: string, width = COLS) {
  const space = width - left.length - right.length;
  return space >= 1 ? left + ' '.repeat(space) + right : left + ' ' + right;
}

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(iso))
    .replace(',', '');
}

const STATION_LABEL: Record<Station, string> = { cucina: 'CUCINA', bar: 'BAR' };

const lineTitle = (l: OrderLine) => (l.name + (l.opt ? ` - ${l.opt}` : '')).toUpperCase();

function header(e: Esc, order: Order, title: string) {
  e.init().align('c').bold(true).size(1, 1).ln(title);
  e.size(3, 3).ln(`TAVOLO ${order.table}`);
  e.size(1, 1).bold(false);
  e.ln(`Comanda n. ${order.number}   ${fmtDate(order.createdAt)}`);
  if (order.covers) e.ln(`Coperti: ${order.covers}`);
  e.align('l').ln(rule('='));
}

function orderNote(e: Esc, order: Order) {
  if (!order.note) return;
  e.ln(rule('-')).bold(true).ln('NOTA:');
  for (const w of wrap(order.note, COLS)) e.ln(w);
  e.bold(false);
}

/** Copia per CUCINA/BAR: nessun prezzo, righe in doppia altezza per leggibilità */
export function kitchenTicket(order: Order, reprint = false): Buffer {
  const e = new Esc();
  header(e, order, (reprint ? '*** RISTAMPA *** ' : '') + (order.source === 'customer' ? 'COMANDA DA CLIENTE' : 'COMANDA'));
  const stations: Station[] = ['cucina', 'bar'];
  for (const st of stations) {
    const lines = order.lines.filter((l) => l.station === st);
    if (!lines.length) continue;
    e.bold(true).ln(`[ ${STATION_LABEL[st]} ]`).bold(false);
    for (const l of lines) {
      e.bold(true).size(1, 2);
      const wrapped = wrap(`${l.qty}x ${lineTitle(l)}`, COLS - 3);
      wrapped.forEach((w, i) => e.ln(i === 0 ? w : '   ' + w));
      e.size(1, 1);
      if (l.note) for (const w of wrap('>> ' + l.note, COLS - 3)) e.ln('   ' + w);
      e.bold(false);
      e.ln();
    }
  }
  orderNote(e, order);
  e.ln(rule('='));
  e.cut();
  return e.build();
}

/** Copia per la CASSA: prezzi e totale, documento non fiscale */
export function cassaTicket(order: Order, reprint = false): Buffer {
  const e = new Esc();
  header(e, order, (reprint ? '*** RISTAMPA *** ' : '') + (order.source === 'customer' ? 'COPIA CASSA (CLIENTE)' : 'COPIA CASSA'));
  for (const l of order.lines) {
    const left = `${l.qty}x ${lineTitle(l)}`;
    const right = eur(l.price * l.qty);
    const w = COLS - right.length - 1;
    const wrapped = wrap(left, w);
    e.ln(lr(wrapped[0], right));
    for (const extra of wrapped.slice(1)) e.ln('   ' + extra);
    if (l.note) for (const n of wrap('>> ' + l.note, COLS - 3)) e.ln('   ' + n);
  }
  orderNote(e, order);
  e.ln(rule('-'));
  e.bold(true).size(1, 2).ln(lr('TOTALE EUR', eur(order.total), COLS));
  e.size(1, 1).bold(false);
  e.align('c').ln().ln('Documento non fiscale').ln('Pit Stop 2.0 - Castelnuovo del Garda');
  e.cut();
  return e.build();
}

export function testTicket(target: string): Buffer {
  const e = new Esc();
  e.init().align('c').bold(true).size(2, 2).ln('PIT STOP 2.0');
  e.size(1, 1).bold(false).ln('Test di stampa - ' + target);
  e.ln(fmtDate(new Date().toISOString()));
  e.ln('Àà Èè Éé Ìì Òò Ùù Üü Öö Ää ß € ½').ln();
  e.cut();
  return e.build();
}

/** Conto riepilogativo del tavolo (tutte le comande della sessione, piatti uguali accorpati) */
export function billTicket(table: number, orders: Order[]): Buffer {
  const e = new Esc();
  e.init().align('c').bold(true).size(1, 1).ln('CONTO PROVVISORIO');
  e.size(3, 3).ln(`TAVOLO ${table}`);
  e.size(1, 1).bold(false).ln(fmtDate(new Date().toISOString())).align('l').ln(rule('='));

  const merged = new Map<string, { line: OrderLine; qty: number }>();
  for (const o of orders) {
    for (const l of o.lines) {
      const key = `${l.name}|${l.opt ?? ''}|${l.price}`;
      const cur = merged.get(key);
      if (cur) cur.qty += l.qty;
      else merged.set(key, { line: l, qty: l.qty });
    }
  }
  let total = 0;
  for (const { line, qty } of merged.values()) {
    const right = eur(line.price * qty);
    total += line.price * qty;
    const wrapped = wrap(`${qty}x ${lineTitle(line)}`, COLS - right.length - 1);
    e.ln(lr(wrapped[0], right));
    for (const extra of wrapped.slice(1)) e.ln('   ' + extra);
  }
  e.ln(rule('-'));
  e.bold(true).size(1, 2).ln(lr('TOTALE EUR', eur(total), COLS));
  e.size(1, 1).bold(false);
  e.align('c').ln().ln('Documento non fiscale').ln(`Comande: ${orders.length}`).ln('Pit Stop 2.0 - Castelnuovo del Garda');
  e.cut();
  return e.build();
}
