'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORIES, ITEMS, ITEM_MAP, QUICK_NOTES, TABLES } from '@/lib/menu';
import { DICT, LANGS, eur } from '@/lib/i18n';
import { XT } from '@/lib/i18n-customer';
import type { Lang, MenuItem } from '@/lib/types';

type Line = { uid: string; itemId: string; opt: number | null; qty: number; note: string };
type Status = { bridge: boolean; printer: boolean; pending: number; pinRequired: boolean; storage: string };

const uid = () => Math.random().toString(36).slice(2, 10);
const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

/**
 * Modalità personale (default): PIN, scelta tavolo, stato stampante.
 * Modalità cliente (fixedTable + code, dalla pagina /t/N?k=...): tavolo fisso, nessun PIN,
 * funziona solo a turno aperto.
 */
export default function OrderApp({ fixedTable, code }: { fixedTable?: number; code?: string }) {
  const customer = fixedTable !== undefined;
  const [lang, setLang] = useState<Lang>('it');
  const [pin, setPin] = useState('');
  const [needPin, setNeedPin] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [shiftOpen, setShiftOpen] = useState<boolean | null>(null);
  const [table, setTable] = useState<number | null>(fixedTable ?? null);
  const [covers, setCovers] = useState<number | ''>('');
  const [cat, setCat] = useState(CATEGORIES[0].id);
  const [query, setQuery] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [orderNote, setOrderNote] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [optItem, setOptItem] = useState<MenuItem | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string; sub?: string } | null>(null);
  const clientId = useRef(uid() + uid());
  const t = DICT[lang];
  const x = XT[lang];

  useEffect(() => {
    const l = lsGet('ps_lang') as Lang | null;
    if (l && ['it', 'en', 'de'].includes(l)) setLang(l);
    if (!customer) setPin(lsGet('ps_pin') || '');
  }, [customer]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // personale: stato stampante / cliente: stato turno
  const refresh = useCallback(async () => {
    try {
      if (customer) {
        const r = await fetch('/api/shift', { cache: 'no-store' });
        setShiftOpen((await r.json()).open);
      } else {
        const r = await fetch('/api/status', { cache: 'no-store' });
        const s: Status = await r.json();
        setStatus(s);
        if (s.pinRequired && !lsGet('ps_pin')) setNeedPin(true);
      }
    } catch {}
  }, [customer]);
  useEffect(() => {
    refresh();
    const i = setInterval(refresh, customer ? 20000 : 15000);
    return () => clearInterval(i);
  }, [refresh, customer]);

  const changeLang = (l: Lang) => {
    setLang(l);
    lsSet('ps_lang', l);
  };

  // --- carrello ---
  const qtyOf = (itemId: string) => lines.filter((l) => l.itemId === itemId).reduce((s, l) => s + l.qty, 0);
  const qtyOfOpt = (itemId: string, opt: number) =>
    lines.filter((l) => l.itemId === itemId && l.opt === opt).reduce((s, l) => s + l.qty, 0);

  const add = (itemId: string, opt: number | null) =>
    setLines((ls) => {
      const i = ls.findIndex((l) => l.itemId === itemId && l.opt === opt && l.note === '');
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, { uid: uid(), itemId, opt, qty: 1, note: '' }];
    });

  const dec = (itemId: string, opt: number | null) =>
    setLines((ls) => {
      let i = ls.findIndex((l) => l.itemId === itemId && l.opt === opt && l.note === '');
      if (i < 0) i = ls.findIndex((l) => l.itemId === itemId && l.opt === opt);
      if (i < 0) return ls;
      return ls.flatMap((l, k) => (k !== i ? [l] : l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : []));
    });

  const setLineNote = (u: string, note: string) =>
    setLines((ls) => ls.map((l) => (l.uid === u ? { ...l, note } : l)));
  const stepLine = (u: string, d: number) =>
    setLines((ls) => ls.flatMap((l) => (l.uid !== u ? [l] : l.qty + d > 0 ? [{ ...l, qty: l.qty + d }] : [])));

  const count = lines.reduce((s, l) => s + l.qty, 0);
  const total = lines.reduce((s, l) => s + ITEM_MAP[l.itemId].price * l.qty, 0);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ITEMS.filter((i) => i.cat === cat);
    return ITEMS.filter((i) =>
      [i.name.it, i.name.en, i.name.de, i.desc?.it, i.desc?.en, i.desc?.de].some((s) => s?.toLowerCase().includes(q)),
    );
  }, [cat, query]);

  // --- invio ---
  const send = async () => {
    if (!table || !lines.length || sending) return;
    setSending(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(customer ? {} : { 'x-staff-pin': pin }) },
        body: JSON.stringify({
          clientId: clientId.current,
          table,
          k: customer ? code : undefined,
          covers: covers === '' ? undefined : covers,
          note: orderNote,
          lang,
          lines: lines.map((l) => ({ itemId: l.itemId, opt: l.opt, qty: l.qty, note: l.note })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && !customer) {
        lsSet('ps_pin', '');
        setPin('');
        setNeedPin(true);
        setCartOpen(false);
        return;
      }
      if (customer && data.error === 'closed') {
        setShiftOpen(false);
        setCartOpen(false);
        return;
      }
      if (res.status === 429) {
        setToast({ kind: 'warn', text: data.error === 'too_fast' ? x.tooFast : x.tooMany });
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error || 'error');
      if (customer) {
        setToast({ kind: 'ok', text: x.sentCustomer, sub: x.sentCustomerSub });
      } else {
        setToast({
          kind: data.printerOnline === false ? 'warn' : 'ok',
          text: `${t.sent} · ${t.table} ${table} · #${data.number}`,
          sub: data.printerOnline === false ? t.printerOff : t.sentSub,
        });
        setTable(null);
        setCovers('');
      }
      setLines([]);
      setOrderNote('');
      setCartOpen(false);
      setQuery('');
      clientId.current = uid() + uid();
      refresh();
    } catch {
      setToast({ kind: 'err', text: t.error });
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (!toast) return;
    const i = setTimeout(() => setToast(null), toast.kind === 'ok' ? 6000 : 8000);
    return () => clearTimeout(i);
  }, [toast]);

  if (!customer && needPin) {
    return (
      <PinGate
        lang={lang}
        onDone={(p) => {
          lsSet('ps_pin', p);
          setPin(p);
          setNeedPin(false);
        }}
      />
    );
  }

  const dot = !status ? 'gray' : status.printer ? 'green' : status.bridge ? 'amber' : 'red';
  const dotText = !status ? '' : status.printer ? t.ok : status.bridge ? t.noPrinter : t.noBridge;

  const header = (
    <header className="top">
      <div className="brand">
        <span className="logo">PIT STOP 2.0</span>
        {!customer && (
          <>
            <span className={`dot ${dot}`} title={dotText} />
            <span className="dotText">{dotText}</span>
          </>
        )}
      </div>
      <div className="langs" role="group" aria-label="Language">
        {LANGS.map((l) => (
          <button key={l.id} className={lang === l.id ? 'on' : ''} onClick={() => changeLang(l.id)}>
            {l.label}
          </button>
        ))}
      </div>
    </header>
  );

  // cliente con ordinazioni chiuse
  if (customer && shiftOpen === false) {
    return (
      <div className="app">
        {header}
        <main className="closed">
          <div className="tnum">
            {x.yourTable} <b>{fixedTable}</b>
          </div>
          <h1>{x.closedTitle}</h1>
          <p>{x.closedSub}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      {header}

      {toast && (
        <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>
          <strong>{toast.text}</strong>
          {toast.sub && <span>{toast.sub}</span>}
        </div>
      )}

      {table === null ? (
        <main className="tables">
          <h1>{t.chooseTable}</h1>
          <div className="tgrid">
            {Array.from({ length: TABLES }, (_, i) => i + 1).map((n) => (
              <button key={n} onClick={() => setTable(n)}>
                {n}
              </button>
            ))}
          </div>
          <div className="links">
            <a className="histlink" href="/storico">
              {t.history}
            </a>
            <a className="histlink" href="/turno">
              {x.turn} / QR
            </a>
          </div>
        </main>
      ) : (
        <>
          <div className="bar">
            {customer ? (
              <span className="tablechip">
                {t.table} <b>{table}</b>
              </span>
            ) : (
              <button className="tablechip" onClick={() => setTable(null)} title={t.changeTable}>
                {t.table} <b>{table}</b> ⇄
              </button>
            )}
            {!customer && (
              <label className="covers">
                {t.covers}
                <input
                  inputMode="numeric"
                  value={covers}
                  onChange={(e) => {
                    const n = parseInt(e.target.value.replace(/\D/g, ''), 10);
                    setCovers(Number.isFinite(n) ? Math.min(n, 60) : '');
                  }}
                />
              </label>
            )}
            <input
              className="search"
              type="search"
              value={query}
              placeholder={t.search}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {!query && (
            <nav className="cats">
              {CATEGORIES.map((c) => (
                <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>
                  {c.name[lang]}
                </button>
              ))}
            </nav>
          )}

          <main className="menu">
            {shown.length === 0 && <p className="muted">{t.noResults}</p>}
            {shown.map((it) => {
              const q = qtyOf(it.id);
              const desc = it.desc?.[lang];
              return (
                <div className={`item ${q ? 'sel' : ''}`} key={it.id}>
                  <div className="info">
                    <div className="name">{it.name[lang]}</div>
                    {desc && <div className="desc">{desc}</div>}
                    <div className="price">{eur(it.price)}</div>
                  </div>
                  <div className="step">
                    {q > 0 && !it.opts && (
                      <>
                        <button aria-label="−" onClick={() => dec(it.id, null)}>
                          −
                        </button>
                        <span>{q}</span>
                      </>
                    )}
                    {q > 0 && it.opts && <span className="badge">{q}</span>}
                    <button
                      className="plus"
                      aria-label="+"
                      onClick={() => (it.opts ? setOptItem(it) : add(it.id, null))}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
            {customer && <p className="muted allergy">{x.allergy}</p>}
          </main>

          <footer className="cartbar">
            <button className="cartbtn" disabled={!count} onClick={() => setCartOpen(true)}>
              <span className="cnt">{count}</span>
              <span>{t.cart}</span>
              <span className="tot">{eur(total)}</span>
            </button>
          </footer>
        </>
      )}

      {optItem && (
        <Sheet onClose={() => setOptItem(null)} title={optItem.name[lang]} closeLabel={t.close}>
          <div className="opts">
            {optItem.opts!.map((o, idx) => {
              const q = qtyOfOpt(optItem.id, idx);
              return (
                <div className="optrow" key={idx}>
                  <span>{o[lang]}</span>
                  <div className="step">
                    {q > 0 && (
                      <>
                        <button onClick={() => dec(optItem.id, idx)}>−</button>
                        <span>{q}</span>
                      </>
                    )}
                    <button className="plus" onClick={() => add(optItem.id, idx)}>
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <button className="primary" onClick={() => setOptItem(null)}>
            {t.done}
          </button>
        </Sheet>
      )}

      {cartOpen && (
        <Sheet
          onClose={() => setCartOpen(false)}
          title={`${t.cart} · ${t.table} ${table}${covers ? ` · ${covers} ${t.covers.toLowerCase()}` : ''}`}
          closeLabel={t.close}
        >
          {lines.length === 0 && <p className="muted">{t.empty}</p>}
          <div className="cartlines">
            {lines.map((l) => {
              const it = ITEM_MAP[l.itemId];
              return (
                <div className="cline" key={l.uid}>
                  <div className="cl-top">
                    <div className="cl-name">
                      {it.name[lang]}
                      {l.opt !== null && it.opts ? ` – ${it.opts[l.opt][lang]}` : ''}
                    </div>
                    <div className="step">
                      <button onClick={() => stepLine(l.uid, -1)}>−</button>
                      <span>{l.qty}</span>
                      <button className="plus" onClick={() => stepLine(l.uid, 1)}>
                        +
                      </button>
                    </div>
                    <div className="cl-price">{eur(it.price * l.qty)}</div>
                  </div>
                  <input
                    className="note"
                    value={l.note}
                    maxLength={140}
                    placeholder={`${t.lineNote}…`}
                    onChange={(e) => setLineNote(l.uid, e.target.value)}
                  />
                  <div className="chips">
                    {QUICK_NOTES.map((qn, i) => (
                      <button
                        key={i}
                        onClick={() =>
                          setLineNote(l.uid, l.note.includes(qn.it) ? l.note : (l.note ? l.note + ', ' : '') + qn.it)
                        }
                      >
                        {qn[lang]}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {lines.length > 0 && (
            <>
              <textarea
                className="ordernote"
                rows={2}
                maxLength={300}
                value={orderNote}
                placeholder={t.orderNote}
                onChange={(e) => setOrderNote(e.target.value)}
              />
              {customer && <p className="muted allergy">{x.allergy}</p>}
              <div className="sum">
                <span>{t.total}</span>
                <b>{eur(total)}</b>
              </div>
              <div className="actions">
                <button className="ghost" onClick={() => setLines([])}>
                  {t.clear}
                </button>
                <button className="primary" disabled={sending} onClick={send}>
                  {sending ? t.sending : t.send}
                </button>
              </div>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}

function Sheet({
  title,
  closeLabel,
  onClose,
  children,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheethead">
          <h2>{title}</h2>
          <button className="x" onClick={onClose} aria-label={closeLabel}>
            ✕
          </button>
        </div>
        <div className="sheetbody">{children}</div>
      </div>
    </div>
  );
}

function PinGate({ lang, onDone }: { lang: Lang; onDone: (pin: string) => void }) {
  const t = DICT[lang];
  const [v, setV] = useState('');
  return (
    <div className="pin">
      <span className="logo">PIT STOP 2.0</span>
      <h1>{t.pinTitle}</h1>
      <input
        type="password"
        inputMode="numeric"
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && v && onDone(v)}
      />
      <button className="primary" disabled={!v} onClick={() => onDone(v)}>
        {t.pinGo}
      </button>
    </div>
  );
}
