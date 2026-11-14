# Pit Stop 2.0 – Comande dal tavolo

Web app (Next.js) per prendere le comande dal tavolo (1–15) in **italiano / inglese / tedesco** e stamparle sulla **Epson** via WiFi, con **copia per la cassa**. Menù e prezzi presi da `Pit_Stop_2_0_Menu_Impaginazione_v26.pdf`.

## Come funziona (e perché serve il "bridge")

Vercel è su Internet, la stampante è nella rete WiFi del locale: Vercel **non può** raggiungere `192.168.x.x`. Quindi:

```
Tablet/telefono ──▶ App su Vercel ──(coda su Upstash Redis)──▶ Bridge in sala ──TCP 9100──▶ Epson
   (camerieri)        crea i ticket                            (PC/Raspberry acceso,
                      ESC/POS cucina + cassa                    stessa WiFi della stampante)
```

Il bridge (`bridge/bridge.mjs`, un solo file, nessuna dipendenza) **chiama Vercel ogni 2 secondi** e stampa ciò che trova: non serve aprire porte sul router. Se la stampante è spenta o il bridge è giù, le comande restano in coda e escono appena torna tutto online (l'app mostra un pallino verde / giallo / rosso).

Ogni comanda produce **2 ticket**:
- **Cucina/Bar**: tavolo grande, righe in doppia altezza, note, **senza prezzi**, piatti separati in CUCINA e BAR.
- **Copia cassa**: stessi piatti con prezzi e **totale** (documento non fiscale).

I ticket sono sempre in **italiano**, qualunque sia la lingua scelta dal cameriere.

## 1. Pubblicare su Vercel

1. Carica la cartella su GitHub (o `npx vercel` dalla cartella).
2. Vercel → *Add New Project* → importa il repo (framework: Next.js, nessuna impostazione da cambiare).
3. Progetto → **Storage / Marketplace → Upstash Redis → Create** e collegalo al progetto (aggiunge da solo le variabili `KV_REST_API_*`).
4. Progetto → *Settings → Environment Variables*:
   | Variabile | Valore |
   |---|---|
   | `BRIDGE_TOKEN` | stringa lunga e casuale (la stessa andrà nel bridge) |
   | `STAFF_PIN` | PIN dei camerieri (consigliato: senza, chiunque abbia il link può mandare comande) |
   | `PRINT_COLS` | `48` per carta 80 mm (default), `32` per 58 mm |
5. *Redeploy*. Sui tablet: apri il link → "Aggiungi a schermata Home".

## 2. Stampante Epson

- Assegna alla stampante un **IP fisso** (riserva l'indirizzo nel router). Per leggerlo: tieni premuto FEED all'accensione → stampa il self-test con la configurazione di rete.
- Deve accettare stampa **raw sulla porta 9100** (default su tutte le Epson TM con interfaccia di rete / modulo WiFi). Il modello "TM-T80" non ha WiFi di serie: serve l'interfaccia di rete/WiFi opzionale (es. UB-E04 / UB-R04) o un modello TM-…-iii/m-series con rete.
- Il codice usa ESC/POS standard con code page CP858 (accenti, ü ö ä ß, €). Il pulsante **Storico → Test stampa** stampa un ticket con tutti i caratteri speciali su cucina e cassa.

## 3. Bridge di stampa (in sala)

Un PC/mini-PC/Raspberry **sempre acceso** nella stessa WiFi/LAN, con **Node 20.6+**:

```bash
cd bridge
cp .env.example .env      # compila SERVER_URL, BRIDGE_TOKEN, PRINTER_KITCHEN_HOST
node --env-file=.env bridge.mjs
```

- Copia cassa sulla **stessa stampante**: lascia vuoto `PRINTER_CASSA_HOST` (esce un secondo scontrino subito dopo il primo).
- Copia cassa su **una seconda stampante**: metti il suo IP in `PRINTER_CASSA_HOST`.
- Avvio automatico: con `pm2` (`pm2 start bridge.mjs --name pitstop-bridge && pm2 save && pm2 startup`) o come servizio systemd / Utilità di pianificazione di Windows.

## Uso

1. Scegli il **tavolo** (1–15) → eventualmente i **coperti**.
2. Categorie in alto o **ricerca** (cerca in IT/EN/DE, anche negli ingredienti).
3. **+** aggiunge il piatto; per acqua, bibite, succhi, caffè macchiato si apre la scelta (gusto / naturale-frizzante / caldo-freddo).
4. **Comanda** in basso → note per riga (con note rapide: "Ben cotta", "Senza cipolla", …) e nota generale → **Invia**.
5. **Storico** (link sotto i tavoli): ultime 50 comande con **Ristampa** e **Test stampa**.

Un doppio tap o un invio ripetuto per rete lenta non genera due comande (chiave anti-duplicato).

## Modificare il menù

Tutto è in `src/lib/menu.ts` (una riga per piatto: prezzo, nome IT/EN/DE, descrizione IT/EN/DE, eventuali opzioni). Salva, push → Vercel pubblica.

## Sviluppo locale

```bash
npm install
BRIDGE_TOKEN=test STAFF_PIN=1234 npm run dev
```
Senza Redis usa la memoria del processo (solo per prove locali; su Vercel serve Upstash).

## Da verificare sul menù

- **Caffè americano** compare due volte nel PDF con prezzi diversi (€ 1,50 e € 1,40): ho inserito entrambe le righe, la seconda marcata "(2° prezzo menù)" – tieni quella giusta.
- "Spezie piccola/media" e alcune bevande non hanno traduzioni nel PDF: EN/DE usano il nome italiano.
- Il PDF non indica coperto né servizio: l'app non li aggiunge al totale.

## Ordinazione dei clienti dal QR (novità)

- **Turno** (`/turno`, con PIN): il cameriere **apre le ordinazioni 10 minuti prima del servizio** e le chiude a fine turno (si chiudono da sole dopo 14 ore).
- **QR dei tavoli** (`/turno/qr`): stampa i 15 QR (6 per foglio A4). Ogni QR apre `/t/N?k=codice`: il cliente vede il menù (IT/EN/DE, prezzi, totale), con il suo tavolo già fissato e senza PIN.
- A turno chiuso il cliente vede "Ordinazioni non attive". Il codice nel QR è diverso per ogni tavolo e non si può indovinare.
- Anti-spam: 1 invio ogni 15 s per tavolo, max 8 invii ogni 10 minuti per tavolo, max 25 per rete, max 30 righe e 20 pezzi per piatto.
- Sullo scontrino della comanda cliente compare **COMANDA DA CLIENTE**.
- **Variabile nuova su Vercel:** `TABLE_SECRET` (stringa lunga e casuale, diversa da `BRIDGE_TOKEN`). Non cambiarla dopo aver stampato i QR.
- Lo **Storico** mostra solo le comande del giorno corrente (pulsante per vedere anche i giorni precedenti).
