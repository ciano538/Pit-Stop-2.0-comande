#!/usr/bin/env node
/**
 * PIT STOP 2.0 – Print bridge
 *
 * Gira sul computer della pizzeria (sempre acceso). Interroga l'app su Vercel, prende le comande in
 * coda e le stampa. Due modi di collegare la stampante (scegline uno nel file config.env):
 *   - RETE: PRINTER_KITCHEN_HOST=<IP>      (porta 9100, ESC/POS raw)
 *   - USB / stampante installata nel computer: PRINTER_KITCHEN_QUEUE=<nome stampante nel sistema>
 *
 * Avvio:        node --env-file=config.env bridge.mjs
 * Prova locale: node --env-file=config.env bridge.mjs --test   (stampa un ticket senza passare dall'app)
 */
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec, execFile } from 'node:child_process';

const E = process.env;
const TEST = process.argv.includes('--test');
const SERVER_URL = (E.SERVER_URL || '').replace(/\/$/, '');
const TOKEN = E.BRIDGE_TOKEN || '';
const POLL_MS = Number(E.POLL_MS) || 2000;

const kitchen = {
  host: E.PRINTER_KITCHEN_HOST || '',
  port: Number(E.PRINTER_KITCHEN_PORT) || 9100,
  queue: E.PRINTER_KITCHEN_QUEUE || '',
};
// copia cassa: se non indicata, stessa stampante della cucina (due scontrini di fila)
const cassa =
  E.PRINTER_CASSA_HOST || E.PRINTER_CASSA_QUEUE
    ? { host: E.PRINTER_CASSA_HOST || '', port: Number(E.PRINTER_CASSA_PORT) || 9100, queue: E.PRINTER_CASSA_QUEUE || '' }
    : kitchen;

const log = (...a) => console.log(new Date().toLocaleTimeString('it-IT'), ...a);
const describe = (t) => (t.host ? `${t.host}:${t.port}` : `stampante "${t.queue}"`);

if (!kitchen.host && !kitchen.queue) {
  console.error('Manca PRINTER_KITCHEN_HOST (IP) oppure PRINTER_KITCHEN_QUEUE (nome stampante) nel file config.env');
  process.exit(1);
}
if (!TEST && (!SERVER_URL || !TOKEN)) {
  console.error('Mancano SERVER_URL o BRIDGE_TOKEN nel file config.env');
  process.exit(1);
}

function viaNetwork(host, port, buf) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error('timeout: stampante non raggiungibile'));
    }, 10_000);
    sock.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    sock.on('connect', () => sock.write(buf, () => sock.end()));
    sock.on('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function viaSystem(queue, buf) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `pitstop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.bin`);
    fs.writeFileSync(tmp, buf);
    const done = (err, _out, stderr) => {
      fs.rm(tmp, { force: true }, () => {});
      err ? reject(new Error((stderr || err.message).toString().trim())) : resolve();
    };
    if (process.platform === 'win32') {
      // la stampante deve essere CONDIVISA in Windows con questo nome
      exec(`copy /b "${tmp}" "\\\\localhost\\${queue}"`, { windowsHide: true }, done);
    } else {
      execFile('lp', ['-d', queue, '-o', 'raw', tmp], done);
    }
  });
}

const send = (t, buf) => (t.host ? viaNetwork(t.host, t.port, buf) : viaSystem(t.queue, buf));

/** Ticket di prova (code page CP858: à è ì ò ù € in byte) */
function testTicket() {
  const ESC = 0x1b, GS = 0x1d;
  return Buffer.concat([
    Buffer.from([ESC, 0x40, ESC, 0x74, 19, ESC, 0x61, 1, ESC, 0x45, 1, GS, 0x21, 0x11]),
    Buffer.from('PIT STOP 2.0\n'),
    Buffer.from([GS, 0x21, 0x00, ESC, 0x45, 0]),
    Buffer.from('Prova stampante OK\n'),
    Buffer.from([0x85, 0x20, 0x8a, 0x20, 0x8d, 0x20, 0x95, 0x20, 0x97, 0x20, 0xd5, 0x0a, 0x0a]),
    Buffer.from([ESC, 0x64, 3, GS, 0x56, 0x42, 0x00]),
  ]);
}

if (TEST) {
  log(`Prova di stampa su ${describe(kitchen)} …`);
  send(kitchen, testTicket())
    .then(() => log('Inviato. Se è uscito lo scontrino con "à è ì ò ù €" la stampante è a posto.'))
    .catch((e) => {
      log('ERRORE:', e.message);
      process.exit(1);
    });
} else {
  const headers = { Authorization: `Bearer ${TOKEN}` };
  const printed = new Set(); // evita doppioni se l'ack fallisce
  let lastOk = true;

  async function tick() {
    let res;
    try {
      res = await fetch(`${SERVER_URL}/api/bridge/jobs?p=${lastOk ? 'ok' : 'ko'}`, { headers });
    } catch (e) {
      return log('Server non raggiungibile (internet?):', e.message);
    }
    if (res.status === 401) return log('Token non valido: controlla BRIDGE_TOKEN');
    if (!res.ok) return log('Errore server', res.status);

    const { jobs } = await res.json();
    const done = [];
    for (const job of jobs) {
      if (printed.has(job.id)) {
        done.push(job.id);
        continue;
      }
      const target = job.target === 'cassa' ? cassa : kitchen;
      try {
        await send(target, Buffer.from(job.data, 'base64'));
        printed.add(job.id);
        done.push(job.id);
        lastOk = true;
        log('Stampato:', job.label);
        await new Promise((r) => setTimeout(r, 400));
      } catch (e) {
        lastOk = false;
        log(`ERRORE stampa "${job.label}" su ${describe(target)}:`, e.message, '(riprovo)');
        break; // mantiene l'ordine
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

  log(`Bridge avviato → ${SERVER_URL} | cucina: ${describe(kitchen)} | cassa: ${describe(cassa)}`);
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
}
