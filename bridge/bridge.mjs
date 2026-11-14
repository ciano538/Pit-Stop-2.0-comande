#!/usr/bin/env node
/**
 * PIT STOP 2.0 – Print bridge
 *
 * Gira su un PC / mini-PC / Raspberry Pi SEMPRE ACCESO nella stessa rete WiFi/LAN della stampante.
 * Interroga l'app su Vercel, prende le comande in coda e le invia alla stampante Epson
 * (porta TCP 9100, ESC/POS raw). Nessuna porta da aprire sul router: è il bridge che chiama Vercel.
 *
 * Avvio:  node --env-file=bridge/.env bridge/bridge.mjs     (Node 20.6+)
 */
import net from 'node:net';

const SERVER_URL = (process.env.SERVER_URL || '').replace(/\/$/, '');
const TOKEN = process.env.BRIDGE_TOKEN || '';
const KITCHEN_HOST = process.env.PRINTER_KITCHEN_HOST || '';
const KITCHEN_PORT = Number(process.env.PRINTER_KITCHEN_PORT) || 9100;
// copia cassa: se non indicato, stessa stampante della cucina (stampa due scontrini di fila)
const CASSA_HOST = process.env.PRINTER_CASSA_HOST || KITCHEN_HOST;
const CASSA_PORT = Number(process.env.PRINTER_CASSA_PORT) || KITCHEN_PORT;
const POLL_MS = Number(process.env.POLL_MS) || 2000;

if (!SERVER_URL || !TOKEN || !KITCHEN_HOST) {
  console.error('Mancano SERVER_URL, BRIDGE_TOKEN o PRINTER_KITCHEN_HOST (vedi bridge/.env.example)');
  process.exit(1);
}

const log = (...a) => console.log(new Date().toLocaleTimeString('it-IT'), ...a);
const headers = { Authorization: `Bearer ${TOKEN}` };
const printed = new Set(); // evita doppioni se l'ack fallisce
let lastOk = true;

function sendToPrinter(host, port, buf) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error('timeout stampante'));
    }, 10_000);
    sock.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    sock.on('connect', () => {
      sock.write(buf, () => sock.end());
    });
    sock.on('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function tick() {
  let res;
  try {
    res = await fetch(`${SERVER_URL}/api/bridge/jobs?p=${lastOk ? 'ok' : 'ko'}`, { headers });
  } catch (e) {
    log('Server non raggiungibile:', e.message);
    return;
  }
  if (res.status === 401) return log('Token non valido (BRIDGE_TOKEN)');
  if (!res.ok) return log('Errore server', res.status);

  const { jobs } = await res.json();
  const done = [];
  for (const job of jobs) {
    if (printed.has(job.id)) {
      done.push(job.id);
      continue;
    }
    const [host, port] = job.target === 'cassa' ? [CASSA_HOST, CASSA_PORT] : [KITCHEN_HOST, KITCHEN_PORT];
    try {
      await sendToPrinter(host, port, Buffer.from(job.data, 'base64'));
      printed.add(job.id);
      done.push(job.id);
      lastOk = true;
      log('Stampato:', job.label);
      await new Promise((r) => setTimeout(r, 400)); // lascia finire il taglio
    } catch (e) {
      lastOk = false;
      log(`ERRORE stampa "${job.label}" su ${host}:${port} →`, e.message, '(riprovo)');
      break; // mantiene l'ordine: riprova al giro successivo
    }
  }
  if (printed.size > 500) [...printed].slice(0, 250).forEach((x) => printed.delete(x));
  if (done.length) {
    try {
      await fetch(`${SERVER_URL}/api/bridge/ack`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ ids: done }),
      });
    } catch (e) {
      log('Ack fallito (sarà ritentato):', e.message);
    }
  }
}

log(`Bridge avviato → ${SERVER_URL} | cucina ${KITCHEN_HOST}:${KITCHEN_PORT} | cassa ${CASSA_HOST}:${CASSA_PORT}`);
(async function loop() {
  for (;;) {
    try {
      await tick();
    } catch (e) {
      log('Errore imprevisto:', e.message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
})();
