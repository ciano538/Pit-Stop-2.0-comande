'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

type Card = { table: number; url: string; img: string };

/** QR dei 15 tavoli, da stampare (A4, 6 per foglio) e ritagliare */
export default function QrSheet() {
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState('');
  const [warn, setWarn] = useState(false);

  useEffect(() => {
    (async () => {
      let pin = '';
      try {
        pin = localStorage.getItem('ps_pin') || '';
      } catch {}
      const r = await fetch('/api/qr', { headers: { 'x-staff-pin': pin }, cache: 'no-store' });
      if (r.status === 401) return setError('PIN mancante o errato: apri prima la home e inserisci il PIN.');
      if (!r.ok) return setError('Manca TABLE_SECRET (o BRIDGE_TOKEN) su Vercel.');
      const data = (await r.json()) as { tables: { table: number; code: string }[]; dedicatedSecret: boolean };
      setWarn(!data.dedicatedSecret);
      const out: Card[] = [];
      for (const { table, code } of data.tables) {
        const url = `${window.location.origin}/t/${table}?k=${code}`;
        out.push({ table, url, img: await QRCode.toDataURL(url, { margin: 1, width: 600, errorCorrectionLevel: 'M' }) });
      }
      setCards(out);
    })();
  }, []);

  return (
    <div className="qrpage">
      <div className="noprint qrtop">
        <a href="/turno">← Turno</a>
        <button className="primary" onClick={() => window.print()} disabled={!cards.length}>
          Stampa
        </button>
      </div>
      {error && <p className="noprint">{error}</p>}
      {warn && (
        <p className="noprint muted">
          Consiglio: su Vercel imposta una variabile TABLE_SECRET dedicata prima di stampare i QR definitivi. Se cambi
          BRIDGE_TOKEN dopo la stampa, i QR smettono di funzionare.
        </p>
      )}
      <div className="qrgrid">
        {cards.map((c) => (
          <div className="qrcard" key={c.table}>
            <div className="qrbrand">PIT STOP 2.0</div>
            <div className="qrtable">Tavolo {c.table}</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.img} alt={`QR tavolo ${c.table}`} />
            <div className="qrtext">
              Inquadra per ordinare dal menù
              <br />
              Scan to order from the menu
              <br />
              Zum Bestellen scannen
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
