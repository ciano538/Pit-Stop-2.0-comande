'use client';

import { useCallback, useEffect, useState } from 'react';

const getPin = () => {
  try {
    return localStorage.getItem('ps_pin') || '';
  } catch {
    return '';
  }
};

/** Area personale: apre/chiude le ordinazioni dei clienti, link ai QR e allo storico */
export default function Turno() {
  const [open, setOpen] = useState<boolean | null>(null);
  const [msg, setMsg] = useState('');
  const [pin, setPin] = useState('');
  const [bad, setBad] = useState(false);
  const [st, setSt] = useState<{ bridge: boolean; printer: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      setOpen((await (await fetch('/api/shift', { cache: 'no-store' })).json()).open);
      setSt(await (await fetch('/api/status', { cache: 'no-store' })).json());
    } catch {}
  }, []);

  useEffect(() => {
    setPin(getPin());
    load();
    const i = setInterval(load, 15000);
    return () => clearInterval(i);
  }, [load]);

  const toggle = async (next: boolean) => {
    const r = await fetch('/api/shift', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-staff-pin': pin },
      body: JSON.stringify({ open: next }),
    });
    if (r.status === 401) {
      setBad(true);
      setMsg('PIN errato');
      return;
    }
    setBad(false);
    setMsg(next ? 'Ordinazioni aperte: i clienti possono ordinare dal QR.' : 'Ordinazioni chiuse.');
    load();
  };

  const savePin = (v: string) => {
    setPin(v);
    try {
      localStorage.setItem('ps_pin', v);
    } catch {}
  };

  return (
    <div className="app">
      <header className="top">
        <a className="logo" href="/">
          ← PIT STOP 2.0
        </a>
        {st && (
          <span className="dotText">
            <span className={`dot ${st.printer ? 'green' : st.bridge ? 'amber' : 'red'}`} />{' '}
            {st.printer ? 'Stampante OK' : st.bridge ? 'Stampante non raggiungibile' : 'Bridge offline'}
          </span>
        )}
      </header>
      <main className="turno">
        <h1>Turno</h1>
        <div className={`state ${open ? 'on' : 'off'}`}>
          {open === null ? '…' : open ? 'Ordinazioni APERTE' : 'Ordinazioni CHIUSE'}
        </div>

        {(bad || !pin) && (
          <label className="pinbox">
            PIN del personale
            <input type="password" inputMode="numeric" value={pin} onChange={(e) => savePin(e.target.value)} />
          </label>
        )}

        <div className="actions">
          <button className="primary" disabled={open === true} onClick={() => toggle(true)}>
            Apri ordinazioni
          </button>
          <button className="ghost" disabled={open === false} onClick={() => toggle(false)}>
            Chiudi
          </button>
        </div>
        {msg && <p className="muted">{msg}</p>}
        <p className="muted">
          Aprile 10 minuti prima del servizio. Si chiudono da sole dopo 14 ore se ti dimentichi.
        </p>

        <div className="links big">
          <a href="/turno/qr">Stampa i QR dei tavoli</a>
          <a href="/cassa">Cassa: conti e tavoli</a>
          <a href="/storico">Storico comande di oggi</a>
          <a href="/">Prendi una comanda (camerieri)</a>
        </div>
      </main>
    </div>
  );
}
