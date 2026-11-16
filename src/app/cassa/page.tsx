'use client';

import { useCallback, useEffect, useState } from 'react';
import { eur } from '@/lib/i18n';

type T = { table: number; open: boolean; since: number | null; orders: number; customerOrders: number; total: number };

const getPin = () => {
  try {
    return localStorage.getItem('ps_pin') || '';
  } catch {
    return '';
  }
};

/** Cassa: stato e conto di ogni tavolo. Il cameriere apre il tavolo, stampa il conto e lo chiude. */
export default function Cassa() {
  const [tables, setTables] = useState<T[] | null>(null);
  const [msg, setMsg] = useState('');
  const [bad, setBad] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/tables', { headers: { 'x-staff-pin': getPin() }, cache: 'no-store' });
    if (r.status === 401) {
      setBad(true);
      return setTables([]);
    }
    setBad(false);
    setTables((await r.json()).tables);
  }, []);

  useEffect(() => {
    load();
    const i = setInterval(load, 10000);
    return () => clearInterval(i);
  }, [load]);

  const act = async (table: number, action: 'open' | 'close' | 'bill') => {
    if (action === 'close' && !confirm(`Chiudere il tavolo ${table}? I clienti non potranno più ordinare.`)) return;
    const r = await fetch('/api/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-staff-pin': getPin() },
      body: JSON.stringify({ table, action }),
    });
    const text = !r.ok
      ? action === 'bill'
        ? 'Nessuna comanda su questo tavolo'
        : 'Errore'
      : action === 'open'
        ? `Tavolo ${table} aperto`
        : action === 'close'
          ? `Tavolo ${table} chiuso`
          : `Conto del tavolo ${table} in stampa`;
    setMsg(text);
    setTimeout(() => setMsg(''), 3000);
    load();
  };

  const openCount = tables?.filter((t) => t.open).length ?? 0;

  return (
    <div className="app">
      <header className="top">
        <a className="logo" href="/">
          ← PIT STOP 2.0
        </a>
        <span className="dotText">{openCount} tavoli aperti</span>
      </header>
      {msg && (
        <div className="toast ok">
          <strong>{msg}</strong>
        </div>
      )}
      <main className="cassa">
        <h1>Cassa</h1>
        {bad && <p className="muted">PIN mancante o errato: torna alla home e inseriscilo.</p>}
        <div className="cgrid">
          {tables?.map((t) => (
            <div className={`ccard ${t.open ? 'open' : ''}`} key={t.table}>
              <div className="chead">
                <span className="cnum">{t.table}</span>
                <span className="cstate">{t.open ? 'APERTO' : 'libero'}</span>
              </div>
              {t.open || t.orders > 0 ? (
                <div className="ctot">
                  {eur(t.total)}
                  <small>
                    {t.orders} comande{t.customerOrders ? ` (${t.customerOrders} da cliente)` : ''}
                  </small>
                </div>
              ) : (
                <div className="ctot muted">—</div>
              )}
              <div className="cbtns">
                {!t.open ? (
                  <button className="primary small" onClick={() => act(t.table, 'open')}>
                    Apri tavolo
                  </button>
                ) : (
                  <>
                    <button className="ghost small" disabled={!t.orders} onClick={() => act(t.table, 'bill')}>
                      Stampa conto
                    </button>
                    <button className="primary small" onClick={() => act(t.table, 'close')}>
                      Chiudi tavolo
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 18, fontSize: 13 }}>
          Apri il tavolo quando i clienti si siedono: solo allora possono ordinare dal QR. Stampa il conto quando lo
          chiedono, poi chiudi il tavolo dopo il pagamento. Un tavolo chiuso si riapre con un nuovo ordine del cameriere
          o con "Apri tavolo".
        </p>
      </main>
    </div>
  );
}
