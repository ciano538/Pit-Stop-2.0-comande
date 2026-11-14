'use client';

import { useCallback, useEffect, useState } from 'react';
import { eur } from '@/lib/i18n';
import type { Order } from '@/lib/types';

const pin = () => {
  try {
    return localStorage.getItem('ps_pin') || '';
  } catch {
    return '';
  }
};

export default function Storico() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const r = await fetch('/api/orders', { headers: { 'x-staff-pin': pin() }, cache: 'no-store' });
    if (r.status === 401) {
      setMsg('PIN mancante o errato: torna alla home e inseriscilo.');
      setOrders([]);
      return;
    }
    setOrders((await r.json()).orders);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const post = async (url: string, ok: string) => {
    const r = await fetch(url, { method: 'POST', headers: { 'x-staff-pin': pin() } });
    setMsg(r.ok ? ok : 'Errore');
    setTimeout(() => setMsg(''), 3500);
  };

  return (
    <div className="app hist">
      <header className="top">
        <a className="logo" href="/">
          ← PIT STOP 2.0
        </a>
        <button className="ghost small" onClick={() => post('/api/test-print', 'Test di stampa in coda')}>
          Test stampa
        </button>
      </header>
      {msg && (
        <div className="toast ok">
          <strong>{msg}</strong>
        </div>
      )}
      <main className="menu">
        <h1>Ultime comande</h1>
        {orders === null && <p className="muted">…</p>}
        {orders?.length === 0 && !msg && <p className="muted">Nessuna comanda</p>}
        {orders?.map((o) => (
          <div className="item hrow" key={o.id}>
            <div className="info">
              <div className="name">
                Tavolo {o.table} · #{o.number}{' '}
                <span className="muted">
                  {new Date(o.createdAt).toLocaleTimeString('it-IT', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Europe/Rome',
                  })}
                </span>
              </div>
              <div className="desc">
                {o.lines.map((l) => `${l.qty}× ${l.name}${l.opt ? ` (${l.opt})` : ''}`).join(' · ')}
              </div>
              <div className="price">{eur(o.total)}</div>
            </div>
            <button className="ghost small" onClick={() => post(`/api/orders/${o.id}/reprint`, 'Ristampa in coda')}>
              Ristampa
            </button>
          </div>
        ))}
      </main>
    </div>
  );
}
