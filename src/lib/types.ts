export type Lang = 'it' | 'en' | 'de';
export type L = { it: string; en: string; de: string };
export type Station = 'cucina' | 'bar';

export interface Category {
  id: string;
  station: Station;
  name: L;
}

export interface MenuItem {
  id: string;
  cat: string;
  /** prezzo in centesimi */
  price: number;
  name: L;
  desc?: L;
  /** scelte obbligatorie (es. gusto della bibita) */
  opts?: L[];
}

/** Riga del carrello inviata dal client */
export interface CartLineInput {
  itemId: string;
  opt?: number | null;
  qty: number;
  note?: string;
}

/** Riga salvata nell'ordine (sempre in italiano: è ciò che si stampa) */
export interface OrderLine {
  name: string;
  opt?: string;
  qty: number;
  /** prezzo unitario in centesimi */
  price: number;
  note?: string;
  station: Station;
}

export interface Order {
  /** chi ha inserito la comanda */
  source?: 'staff' | 'customer';
  id: string;
  number: number;
  table: number;
  covers?: number;
  note?: string;
  lang: Lang;
  createdAt: string;
  lines: OrderLine[];
  total: number;
}

export interface PrintJob {
  id: string;
  target: 'kitchen' | 'cassa';
  label: string;
  /** byte ESC/POS in base64 */
  data: string;
}
