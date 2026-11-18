'use strict';
// ============================================================================
// fidelity-main.js — koreksi fidelitas OB-38 DITERAPKAN LANGSUNG ke buku resmi
// bot utama lp-v18-vm (keputusan Indra 2026-11-15 22:50 WITA: koreksi yang
// selama ini diukur varian shadow kini masuk pembukuan resmi; shadow
// dipensiunkan). Port dari fidelity-shadow.js (folder lp-v18-vm-shadow) —
// konstanta + rumus IDENTIK (lihat FIDELITY-MODEL.md di folder shadow):
//   (1) priority fee  — tarif kembaran live bot sendiri
//       (CFG.PRIORITY_MICROLAMPORTS = 50.000 µL/CU, bot.js) x CU_PER_TX x nTx.
//       Paper menghitung 0; live membayar penuh. Konteks pasar
//       (getRecentPrioritizationFees, sampel 60 dtk) dicatat sebagai
//       pembanding di detail, tidak menggantikan tarif.
//   (2) biaya tx gagal — MODEL eksplisit (bukan observasi): nilai harapan
//       FAIL_RATE_MODEL x nTx x (fee dasar + priority per tx). Berlabel MODEL.
//   (3) gap quote->eksekusi — DIUKUR dengan re-quote segar (klien quote kedua,
//       cache dimatikan) atas swap yang persis sama pada momen buka (kaki beli
//       token + kaki USDC->SOL) dan momen tutup (kaki token->USDC + tumpukan
//       SOL->USDC, meniru exitQuote mesin). Selisih BERTANDA: positif = quote
//       mesin lebih optimistis (koreksi mengurangi PnL). Kaki yang gagal
//       di-re-quote dicatat gapUsd: null dan diperlakukan 0 (terlihat di
//       ledger, tidak dikarang).
// AMENDEMEN 2026-11-15 23:41 WITA — ADOPSI STUDI FEE BOT ASLI (keputusan
// Indra "adopsi ke keduanya sekarang juga"; STUDI-FEE-BOT-ASLI-2026-11-15.md
// di folder ini; vonis studi atas model awal di atas: 2 cocok / 3 meleset /
// 3 salah-struktur). Yang berubah dari model awal:
//   (1) Priority fee kini PER KAKI: kaki DLMM tetap tarif kembaran 50.000
//       µL/CU; kaki swap Jupiter memakai tarif pasar dari sampel modul
//       (proksi rezim 'auto' Jupiter di bot asli, yang mengikuti jaringan).
//   (2) CU per KELUARGA tx (bukan 400.000 tetap): DLMM biasa 400.000,
//       chunkable 1.000.000 (batas biaya gagal 1.400.000), swap 300.000,
//       tx polos (close-ata) 200.000 — rezim batas SDK dari studi.
//   (3) Model tx gagal: laju 3% DIPERTAHANKAN berlabel MODEL (tidak bisa
//       divonis dari kode asli); nilai harapan per trade = laju x fee
//       PENUH tx terbesar di trade itu (jangkar studi: chunkable
//       ±0,000075 SOL), bukan lagi laju x rata-rata per tx.
//   Rent: studi memvonis rent TIDAK masuk koreksi fidelitas (buku paper
//   sudah membukukannya dari kutipan SDK) — tidak ditambah di sini.
// AMENDEMEN 2026-11-17 — KOMPONEN (4) SLIPPAGE (perintah langsung Indra
// 2026-11-17 02:57 WITA: "Hitungan slippage masukan jg sesuai kenyataan").
// Analisis kode sebelum merancang (bukti, bukan asumsi):
//   - Price impact ukuran penuh SUDAH di dalam angka buku: mesin memakai
//     outAmount quote Jupiter untuk ukuran persis yang sama (paper-usdc.js
//     exitQuote: out = q.outUi; bot.js initialPaperBins: entryTokenX =
//     buy.outUi; paper-capital.js parseQuote mengambil outAmount apa
//     adanya). Komponen gap (3) membandingkan quote mesin vs re-quote
//     segar — impact ada di KEDUA sisi dan saling meniadakan dalam
//     selisihnya. Menambah "impact" lagi = hitung ganda; TIDAK dilakukan.
//   - Yang BELUM tertangkap gap: geser harga SESUDAH re-quote segar
//     terakhir, yaitu selama jendela pendaratan tx live (bangun tx swap ->
//     broadcast -> inklusi). Paper mengeksekusi seketika pada quote
//     terakhir; live mendarat beberapa detik kemudian pada keadaan pool
//     yang sudah bergerak.
//   - Desain: RE-QUOTE BERJENJANG — kaki swap yang sama di-quote ulang
//     tepat SLIP_DELAY_MS sesudah quote segar pertama (masuk: di
//     measureEntryGap; keluar: di measureExitGap). slippageUsd per kaki =
//     out(quote segar) - out(quote +SLIP_DELAY_MS), BERTANDA (drift
//     menguntungkan mengurangi koreksi, sama seperti gap), dikonversi USD
//     dengan basis yang sama persis dengan kaki gap pasangannya. Jendela
//     gap dan jendela slippage DISJOINT (gap: quote mesin -> quote segar;
//     slippage: quote segar -> +SLIP_DELAY_MS) — tidak ada tumpang tindih.
//   - SLIP_DELAY_MS = 5.000 adalah parameter MODEL berlabel (sekelas
//     FAIL_RATE_MODEL): basis tertulisnya — panggilan quote Jupiter klien
//     modul berlatensi ~1-3 dtk (throttle minGap 1,6 dtk), bangun tx swap
//     satu round-trip API lagi, inklusi Solana 1-3 slot x 0,4 dtk pada
//     tarif prioritas bot; jumlah realistis 3-6 dtk, diambil 5 dtk. Yang
//     DIUKUR per trade adalah drift-nya; yang MODEL hanya panjang
//     jendelanya. Latensi panggilan quote aktual ikut dijurnal supaya
//     basis ini bisa diturunkan ulang dari data.
//   - TIDAK dimodelkan (dinyatakan terbuka): (a) ekor revert — drift
//     merugikan melewati toleransi slippage quote (300 bps) membuat tx
//     live revert lalu dikejar pada harga lebih buruk; model tx gagal (2)
//     hanya menanggung fee-nya, bukan kejar harganya; (b) komposisi
//     deposit DLMM saat mendarat — add memakai id bin tetap dan mekanisme
//     bin eksak (bukan swap), jadi tidak ada slippage swap di kaki DLMM;
//     selisih bin aktif saat mendarat adalah orde kedua dan tidak diukur.
//   - Disiplin sama: kaki yang re-quote jenjangnya gagal dicatat
//     slipUsd: null dan diperlakukan 0 di total (terlihat, tidak
//     dikarang); tambahan latensi tutup dibatasi SLIP_MAX_WAIT_MS.
//   - JAHITAN: komponen berlaku untuk trade yang DITUTUP sesudah modul
//     versi ini dimuat. Trade tertutup sebelumnya TIDAK dihitung ulang —
//     jurnal lama tidak memuat re-quote berjenjang (tidak pernah diambil),
//     jadi delta historisnya TIDAK TERUKUR (bukan nol); lihat laporan
//     penerapan 2026-11-17.
// AMENDEMEN 2026-11-17 (GAPFIX) — ATURAN GAP ASIMETRIS (perintah langsung
// Indra 2026-11-17 18:09 WITA: "Tolong fix. Harus hati-hati, ini berkaitan
// dengan uang asli nanti."). Temuan terverifikasi dari fidelity-ledger.jsonl
// buku berjalan: jumlah exitGapUsd -$56,37, negatif di 13/15 baris — koreksi
// BERTANDA menaikkan PnL resmi jauh di atas basis yang bisa dieksekusi live
// (contoh BAWSAQ: mentah -$0,076 -> resmi +$23,86). Dua penyebab struktural:
//   (1) measureExitGap merekonstruksi hasil kaki mesin sebagai
//       engineOut = token x snap.price - val.tokenSwapCostUsd; karena
//       paper-usdc.js memasang tokenSwapCostUsd = max(0, mark - quote),
//       engineOut identik dengan min(mark, quote). Bila quote mesin di atas
//       mark, premium (quote - mark) SUDAH dibukukan PnL mentah lewat
//       proceeds = quote; gap = engineOut - requote lalu mengkredit premium
//       itu SEKALI LAGI saat requote juga di atas mark. Hitung ganda.
//   (2) Re-quote segar adalah quote KEDUA; menerapkannya bertanda berarti
//       buku memanen quote terbaik dari dua quote. Live mengeksekusi satu
//       quote — yang terbaik dari dua tidak pernah tersedia.
// Perbaikan (hanya di titik penerapan, closeCorrection; pengukuran tetap
// bertanda dan tersimpan di components sebagai diagnostik): komponen gap
// masuk, gap keluar, dan slippage DITERAPKAN sebagai max(0, nilai) — hanya
// boleh menurunkan PnL resmi, tidak pernah menaikkannya. PnL resmi per
// trade = mentah - priority fee - model tx gagal - gap terapan - slippage
// terapan. Buku berjalan di-restate mengikuti pola restatement sebelumnya:
// paper/RESTATEMENT-GAP-KELUAR-2026-11-17.md.
// TITIK SAMBUNG di bot.js (semua dibungkus try/catch; kegagalan modul ini
// TIDAK PERNAH boleh mengganggu bot — PnL mentah dipertahankan):
//   - setOpenContext: fidelityMain.onOpen(pos) — jurnal buka + ukur gap masuk.
//   - paperClose intermediate (kaki reposisi): fidelityMain.noteLegClose —
//     jurnal nTx kaki supaya total tx trade utuh terhitung di tutup final.
//   - paperClose final: const fc = await fidelityMain.closeCorrection(...) —
//     komponen dihitung dari jurnal + re-quote keluar, lalu bot.js
//     mengurangkannya dari rec.pnlUsd/netPnlUsd/usdcOut SEBELUM kas buku
//     dikredit dan baris history disimpan: SATU buku terkoreksi. Baris
//     history menyimpan rawPnlUsd + rec.fidelity{components,nTx} untuk audit.
//   - writeSummary: fidelityMain.summaryBlock() — blok komponen di
//     summary.json (jejak resmi per komponen).
// Keluaran audit modul: paper/fidelity-journal.jsonl (peristiwa mentah),
// paper/fidelity-samples.jsonl (sampel tarif jaringan 60 dtk),
// paper/fidelity-ledger.jsonl (satu baris per trade tertutup: PnL mentah,
// PnL terkoreksi, components{}), paper/fidelity-summary.json (total koreksi
// tertutup + akrual priority posisi terbuka + ekuitas resmi vs hipotetis
// mentah).
// ============================================================================
const fs = require('fs');
const path = require('path');

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// --- Parameter terdokumentasi (identik dengan FIDELITY-MODEL.md shadow;
//     diamendemen adopsi studi fee 2026-11-15 23:41 WITA, lihat blok di atas) ---
const FAIL_RATE_MODEL = 0.03;          // MODEL: laju tx gagal/drop (tengah skenario 1/3/5%; dipertahankan berlabel MODEL)
const BOT_TARIFF_MICROLAMPORTS = 50000; // = CFG.PRIORITY_MICROLAMPORTS bot live (bot.js) — tarif TETAP kaki DLMM
// CU per KELUARGA tx (bot asli tidak pernah memasang batas CU; SDK yang
// memasang — rezim dari studi §2):
const CU_DLMM = 400000;                // kaki DLMM biasa (init/add sempit/remove/claim): bawaan simulasi SDK per studi
const CU_CHUNK = 1000000;              // kaki chunkable (add per bagian, buka lebar, re-add): konstanta SDK 1.000.000/add
const CU_CHUNK_FAIL = 1400000;         // batas MAX_CU SDK — basis fee PENUH satu kegagalan chunkable (jangkar studi ±0,000075 SOL)
const CU_SWAP = 300000;                // kaki swap Jupiter: batas simulasi Jupiter per studi
const CU_POLOS = 200000;               // tx polos bot (close-ata): bot asli tanpa batas CU; bawaan protokol per instruksi (berlabel)
const CU_PER_TX = CU_DLMM;             // kompatibilitas: akrual priority posisi terbuka
const SAMPLE_MS = 60000;               // interval sampel konteks pasar
const SLIP_DELAY_MS = 5000;            // MODEL (berlabel): panjang jendela pendaratan tx live untuk re-quote berjenjang komponen slippage — basis di blok amendemen 2026-11-17
const SLIP_MAX_WAIT_MS = 12000;        // batas keras tambahan latensi tutup akibat pengukuran slippage; lewat ini pengukuran dilewati + tercatat

let S = null; // state modul

function jline(file, obj) {
  try { fs.appendFileSync(file, JSON.stringify(obj) + '\n'); } catch { /* diam: lapisan koreksi tak boleh mengganggu */ }
}
function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const waitMs = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));

function init({ conn, txFeeSol, quoteFresh, dir, log }) {
  if (S) return;
  S = {
    conn, txFeeSol: txFeeSol || 0.000025, quoteFresh, dir, log: log || (() => {}),
    journal: path.join(dir, 'fidelity-journal.jsonl'),
    samplesFile: path.join(dir, 'fidelity-samples.jsonl'),
    ledger: path.join(dir, 'fidelity-ledger.jsonl'),
    summary: path.join(dir, 'fidelity-summary.json'),
    samples: [], // {at(ms), ul}
  };
  const cutoff = Date.now() - 3 * 24 * 3600e3;
  for (const r of readJsonl(S.samplesFile)) if (r.at >= cutoff && r.ul > 0) S.samples.push(r);
  const tick = async () => { await sample(); updateSummary(); };
  sample().then(() => updateSummary()).catch(() => {});
  const iv = setInterval(() => { tick().catch(() => {}); }, SAMPLE_MS);
  if (iv.unref) iv.unref();
  S.log('[FIDELITY-MAIN] aktif: koreksi fidelitas diterapkan langsung ke buku resmi (model adopsi studi fee bot asli 2026-11-15: priority per kaki — DLMM tarif bot live tetap, swap tarif pasar; CU per keluarga tx; model tx gagal 3% atas fee penuh tx terbesar; gap re-quote segar; + slippage re-quote berjenjang +5 dtk, amendemen 2026-11-17; GAPFIX 2026-11-17: gap masuk/keluar + slippage diterapkan ASIMETRIS max(0, terukur) — tidak pernah menaikkan PnL resmi); jejak per komponen di fidelity-ledger.jsonl');
}

async function sample() {
  if (!S) return;
  try {
    const fees = await S.conn.getRecentPrioritizationFees();
    const vals = (fees || []).map(f => +f.prioritizationFee).filter(v => Number.isFinite(v) && v > 0);
    if (!vals.length) return;
    const rec = { at: Date.now(), ul: median(vals) };
    S.samples.push(rec);
    if (S.samples.length > 5000) S.samples = S.samples.slice(-4320);
    jline(S.samplesFile, rec);
  } catch { /* RPC gagal: konteks pasar kosong, tercatat apa adanya */ }
}

// Tarif prioritas PRIMER untuk koreksi: tarif bot live sendiri (parameter
// terdokumentasi). Konteks pasar hanya pembanding tercatat.
function rateFor() {
  return { ul: BOT_TARIFF_MICROLAMPORTS, source: 'bot-live-tariff-param' };
}
function marketRateFor(fromMs, toMs) {
  const inWin = S.samples.filter(s => s.at >= fromMs - SAMPLE_MS && s.at <= toMs + SAMPLE_MS);
  if (!inWin.length) return null;
  return { ul: inWin.reduce((a, s) => a + s.ul, 0) / inWin.length, n: inWin.length };
}
const prioritySolPerTx = ul => CU_PER_TX * ul / 1e15; // CU x µL/CU -> SOL

// --- Peristiwa buka: jurnal + re-quote kaki masuk (async, tak menghalangi) ---
function onOpen(pos) {
  if (!S || !pos || !pos.position) return;
  try {
    jline(S.journal, { type: 'open', at: new Date().toISOString(), position: pos.position, pool: pos.pool, name: pos.name, quoteSymbol: pos.quoteSymbol, openedAt: pos.openedAt });
    measureEntryGap(pos).catch(() => {});
  } catch { /* diam */ }
}

async function measureEntryGap(pos) {
  const unit = pos.quoteSymbol === 'USDC' ? 1 : (+pos.solUsdEntry || 0);
  const base = { type: 'entry-gap', at: new Date().toISOString(), position: pos.position, pool: pos.pool, openedAt: pos.openedAt };
  // Kaki beli token: quoteMint -> mintX sebesar tokenSpendQuote.
  try {
    const deposit = pos.depositQuote ?? pos.depositSol ?? 0;
    const tokenSpend = deposit - (+pos.entryQuoteY || 0);
    if (tokenSpend > 0 && +pos.entryTokenX > 0 && pos.quoteMint && pos.mintX && unit > 0) {
      const raw = BigInt(Math.floor(tokenSpend * 10 ** (pos.quoteDecimals ?? 9)));
      const t0 = Date.now();
      const q = await S.quoteFresh(pos.quoteMint, pos.mintX, raw, pos.quoteDecimals ?? 9, pos.decX ?? 6);
      if (q && q.ok && q.outUi > 0) {
        const gapQuote = (+pos.entryTokenX - q.outUi) * (tokenSpend / +pos.entryTokenX);
        jline(S.journal, { ...base, leg: 'token-purchase', usedOut: +pos.entryTokenX, freshOut: q.outUi, gapUsd: gapQuote * unit });
        // Slippage: re-quote berjenjang kaki yang sama pada +SLIP_DELAY_MS.
        try {
          await waitMs(t0 + SLIP_DELAY_MS - Date.now());
          const q1 = await S.quoteFresh(pos.quoteMint, pos.mintX, raw, pos.quoteDecimals ?? 9, pos.decX ?? 6);
          if (q1 && q1.ok && q1.outUi > 0) {
            const slipQuote = (q.outUi - q1.outUi) * (tokenSpend / +pos.entryTokenX);
            jline(S.journal, { ...base, type: 'entry-slippage', leg: 'token-purchase', freshOut: q.outUi, stagedOut: q1.outUi, slipUsd: slipQuote * unit, delayMs: SLIP_DELAY_MS, quoteLatencyMs: Date.now() - t0 });
          } else jline(S.journal, { ...base, type: 'entry-slippage', leg: 'token-purchase', slipUsd: null, note: 're-quote berjenjang gagal: ' + ((q1 && q1.error) || 'kosong') });
        } catch (e) { jline(S.journal, { ...base, type: 'entry-slippage', leg: 'token-purchase', slipUsd: null, note: String(e.message || e).slice(0, 120) }); }
      } else jline(S.journal, { ...base, leg: 'token-purchase', gapUsd: null, note: 're-quote gagal: ' + ((q && q.error) || 'kosong') });
    }
  } catch (e) { jline(S.journal, { ...base, leg: 'token-purchase', gapUsd: null, note: String(e.message || e).slice(0, 120) }); }
  // Kaki USDC->SOL (buffer gas di pool USDC / pendanaan di pool SOL).
  try {
    const spentUsdc = pos.quoteSymbol === 'USDC' ? (+pos.gasUsdc || 0) : (+pos.usdcIn || 0);
    if (spentUsdc > 0 && +pos.solBought > 0 && +pos.solUsdEntry > 0) {
      const raw = BigInt(Math.ceil(spentUsdc * 1e6));
      const legName = pos.quoteSymbol === 'USDC' ? 'buffer-swap' : 'funding-swap';
      const t0 = Date.now();
      const q = await S.quoteFresh(USDC, SOL, raw, 6, 9);
      if (q && q.ok && q.outUi > 0) {
        jline(S.journal, { ...base, leg: legName, usedOut: +pos.solBought, freshOut: q.outUi, gapUsd: (+pos.solBought - q.outUi) * (+pos.solUsdEntry) });
        // Slippage: re-quote berjenjang kaki yang sama pada +SLIP_DELAY_MS.
        try {
          await waitMs(t0 + SLIP_DELAY_MS - Date.now());
          const q1 = await S.quoteFresh(USDC, SOL, raw, 6, 9);
          if (q1 && q1.ok && q1.outUi > 0) {
            jline(S.journal, { ...base, type: 'entry-slippage', leg: legName, freshOut: q.outUi, stagedOut: q1.outUi, slipUsd: (q.outUi - q1.outUi) * (+pos.solUsdEntry), delayMs: SLIP_DELAY_MS, quoteLatencyMs: Date.now() - t0 });
          } else jline(S.journal, { ...base, type: 'entry-slippage', leg: legName, slipUsd: null, note: 're-quote berjenjang gagal: ' + ((q1 && q1.error) || 'kosong') });
        } catch (e) { jline(S.journal, { ...base, type: 'entry-slippage', leg: legName, slipUsd: null, note: String(e.message || e).slice(0, 120) }); }
      } else jline(S.journal, { ...base, leg: 'usdc-sol-swap', gapUsd: null, note: 're-quote gagal: ' + ((q && q.error) || 'kosong') });
    }
  } catch (e) { jline(S.journal, { ...base, leg: 'usdc-sol-swap', gapUsd: null, note: String(e.message || e).slice(0, 120) }); }
}

// --- Kaki reposisi (tutup intermediate): catat nTx kaki ke jurnal ---
function noteLegClose(rec, pos) {
  if (!S || !rec) return;
  try {
    const nTx = Math.round((+rec.networkFeesSol || 0) / S.txFeeSol);
    jline(S.journal, { type: 'leg-close', at: rec.closedAt, position: pos && pos.position, pool: rec.pool, openedAtOrig: rec.openedAt, nTx });
  } catch { /* diam */ }
}

// --- Tutup final: hitung komponen koreksi (dipanggil paperClose SEBELUM kas
// dikredit; bot.js yang menerapkan pengurangannya ke rec + buku). ---
async function closeCorrection(rec, pos, val, snap) {
  if (!S || !rec) return null;
  const journal = readJsonl(S.journal);
  const openedMs = Date.parse(rec.openedAt), closedMs = Date.parse(rec.closedAt);
  const legs = journal.filter(e => e.type === 'leg-close' && e.pool === rec.pool && e.openedAtOrig === rec.openedAt);
  const nTxTotal = Math.round((+rec.networkFeesSol || 0) / S.txFeeSol) + legs.reduce((a, e) => a + (e.nTx || 0), 0);
  // [F4 2026-11-17] Atribusi gap/slippage masuk PER ID POSISI, bukan per pool+jendela:
  // himpunan id posisi milik trade ini = id dari semua peristiwa leg-close trade ini
  // (openedAtOrig === rec.openedAt; tiap kaki reposisi punya id posisi sendiri dan id
  // kaki pertama ikut tertangkap di sini) + id posisi kaki berjalan (pos.position).
  // Peristiwa entry-gap/entry-slippage trade LAIN di pool yang sama — walau di dalam
  // jendela waktu — tidak lagi ikut terhitung. Fallback pool+jendela hanya bila tidak
  // ada satu pun id posisi tercatat (jurnal sangat lama).
  const posId = pos && pos.position;
  const legIds = new Set(legs.map(e => e.position).filter(Boolean));
  if (posId) legIds.add(posId);
  const inWindow = e => Date.parse(e.at) >= openedMs - 120e3 && Date.parse(e.at) <= closedMs + 120e3;
  const gaps = journal.filter(e => e.type === 'entry-gap' && inWindow(e) && (legIds.size ? legIds.has(e.position) : e.pool === rec.pool));
  const gapKnown = gaps.filter(e => Number.isFinite(e.gapUsd));
  const entryGapUsd = gapKnown.length ? gapKnown.reduce((a, e) => a + e.gapUsd, 0) : null;
  // Slippage masuk: peristiwa entry-slippage (re-quote berjenjang saat buka) milik
  // trade ini — atribusi per id posisi yang sama dengan gap masuk [F4 2026-11-17].
  const slipEvents = journal.filter(e => e.type === 'entry-slippage' && inWindow(e) && (legIds.size ? legIds.has(e.position) : e.pool === rec.pool));
  const slipKnown = slipEvents.filter(e => Number.isFinite(e.slipUsd));
  const entrySlipUsd = slipKnown.length ? slipKnown.reduce((a, e) => a + e.slipUsd, 0) : null;
  // (1) Priority fee — PER KAKI (amendemen adopsi studi fee 23:41 WITA).
  // Komposisi tx per peristiwa mengikuti arsitektur bot asli (studi §1):
  // buka = 2 DLMM + 1 swap pendanaan (swap hanya bila tercatat di jurnal
  // gap masuk); tiap peristiwa tutup (tutup final + tiap kaki reposisi)
  // = 1 remove DLMM + 2 swap + 1 close-ata polos. Kelebihan nTx akrual
  // buku di atas komposisi baku dialokasikan ke kaki CHUNKABLE (reshape /
  // buka lebar memang memakai chunkable di bot asli) — heuristik berlabel.
  const rate = rateFor();
  const market = marketRateFor(openedMs, closedMs);
  const swapRate = market ? { ul: market.ul, source: 'sampel-pasar-modul' }
    : (S.samples.length ? { ul: S.samples[S.samples.length - 1].ul, source: 'sampel-pasar-terakhir' }
      : { ul: BOT_TARIFF_MICROLAMPORTS, source: 'fallback-tarif-dlmm' });
  const nCloseEvents = legs.length + 1;
  const openSwap = gaps.some(e => ['funding-swap', 'buffer-swap', 'usdc-sol-swap'].includes(e.leg)) ? 1 : 0;
  const nSwap = openSwap + 2 * nCloseEvents;
  const nPolos = nCloseEvents;
  const nDlmmBase = 2 + nCloseEvents;
  const nBaku = 3 + 4 * nCloseEvents;
  const nChunk = Math.max(0, nTxTotal - nBaku);
  const prioritySol = (nDlmmBase * CU_DLMM * rate.ul + nChunk * CU_CHUNK * rate.ul
    + nPolos * CU_POLOS * rate.ul + nSwap * CU_SWAP * swapRate.ul) / 1e15;
  const priorityFeeUsd = prioritySol * (+rec.solUsd || 0);
  // (2) Biaya tx gagal — MODEL berlabel: nilai harapan per trade = laju x
  // fee PENUH tx terbesar di trade ini (jangkar studi: satu kegagalan
  // chunkable ±0,000075 SOL), bukan rata-rata per tx.
  const failCandidates = [CU_DLMM * rate.ul, CU_SWAP * swapRate.ul, CU_POLOS * rate.ul];
  if (nChunk > 0) failCandidates.push(CU_CHUNK_FAIL * rate.ul);
  const failFeeSol = Math.max(...failCandidates) / 1e15 + S.txFeeSol;
  const failedTxModelUsd = FAIL_RATE_MODEL * failFeeSol * (+rec.solUsd || 0);
  // (3) Gap keluar — re-quote meniru kaki exitQuote.
  // (4) Slippage — drift selama jendela pendaratan tx (re-quote berjenjang
  //     +SLIP_DELAY_MS): sisi masuk dari jurnal entry-slippage, sisi keluar
  //     diukur measureExitGap bersama gap keluar. null di satu sisi = sisi
  //     itu tidak terukur (diperlakukan 0, tercatat); null di dua sisi =
  //     komponen null.
  let exitGapUsd = null, exitNote = '', exitSlipUsd = null, exitSlipNote = '';
  try { const ex = await measureExitGap(rec, val, snap); exitGapUsd = ex.gapUsd; exitSlipUsd = ex.slipUsd; exitSlipNote = ex.slipNote || ''; }
  catch (e) { exitNote = String(e.message || e).slice(0, 120); }
  const slippageUsd = (entrySlipUsd == null && exitSlipUsd == null) ? null : (entrySlipUsd || 0) + (exitSlipUsd || 0);
  const components = { priorityFeeUsd, failedTxModelUsd, entryGapUsd, exitGapUsd, slippageUsd };
  // [GAPFIX 2026-11-17] Penerapan ASIMETRIS: components di atas adalah nilai
  // TERUKUR bertanda (diagnostik, tidak diubah); yang diterapkan ke PnL
  // resmi adalah componentsApplied — gap masuk, gap keluar, dan slippage
  // di-clamp ke >= 0 sehingga hanya boleh MENURUNKAN PnL resmi, tidak pernah
  // menaikkannya (live mengeksekusi satu quote; keuntungan dari quote kedua
  // tidak bisa dipanen, dan premium (quote - mark) tidak boleh dikredit dua
  // kali). Priority fee + model tx gagal memang selalu >= 0 oleh konstruksi.
  const clampCost = v => (v == null ? 0 : Math.max(0, v));
  const componentsApplied = {
    priorityFeeUsd, failedTxModelUsd,
    entryGapUsd: clampCost(entryGapUsd), exitGapUsd: clampCost(exitGapUsd), slippageUsd: clampCost(slippageUsd),
  };
  const totalUsd = componentsApplied.priorityFeeUsd + componentsApplied.failedTxModelUsd
    + componentsApplied.entryGapUsd + componentsApplied.exitGapUsd + componentsApplied.slippageUsd;
  const correctedPnlUsd = rec.pnlUsd - totalUsd;
  const row = {
    label: 'MAIN', at: new Date().toISOString(), name: rec.name, pool: rec.pool,
    openedAt: rec.openedAt, closedAt: rec.closedAt, reason: rec.reason,
    rawPnlUsd: rec.pnlUsd, correctedPnlUsd, appliedToOfficialBook: true,
    unquotedClose: !!(val && val.unquotedClose), unquotedLegs: (val && val.unquotedLegs) || undefined, // [F3 2026-11-17] tutup fail-closed ditandai juga di ledger
    components, componentsApplied, gapRule: 'asymmetric-clamp-2026-11-17',
    detail: {
      nTx: nTxTotal, legs: legs.length + 1,
      priorityRateMicroLamportsPerCu: rate.ul, priorityRateSource: rate.source,
      marketMedianMicroLamportsPerCu: market ? market.ul : null, marketSamples: market ? market.n : 0,
      cuKeluarga: { dlmm: CU_DLMM, chunk: CU_CHUNK, chunkFailCap: CU_CHUNK_FAIL, swap: CU_SWAP, polos: CU_POLOS }, failRateModel: FAIL_RATE_MODEL,
      komposisiTx: { dlmm: nDlmmBase, chunk: nChunk, swap: nSwap, polos: nPolos, nTxAkrualBuku: nTxTotal },
      swapRateMicroLamportsPerCu: swapRate.ul, swapRateSource: swapRate.source,
      entryGapEvents: gaps.length, entryGapMeasured: gapKnown.length,
      slipDelayMs: SLIP_DELAY_MS, entrySlipEvents: slipEvents.length, entrySlipMeasured: slipKnown.length,
      entrySlipUsd, exitSlipUsd, exitSlipNote: exitSlipNote || undefined,
      exitGapNote: exitNote || undefined, solUsd: rec.solUsd,
    },
  };
  jline(S.ledger, row);
  S.log(`[FIDELITY-MAIN] CLOSE ${rec.name}: PnL mentah ${rec.pnlUsd.toFixed(4)} -> terkoreksi ${correctedPnlUsd.toFixed(4)} USDC (priority ${priorityFeeUsd.toFixed(4)}, model-gagal ${failedTxModelUsd.toFixed(4)}, gap-masuk terapan ${componentsApplied.entryGapUsd.toFixed(4)} (terukur ${entryGapUsd == null ? 'n/a' : entryGapUsd.toFixed(4)}), gap-keluar terapan ${componentsApplied.exitGapUsd.toFixed(4)} (terukur ${exitGapUsd == null ? 'n/a' : exitGapUsd.toFixed(4)}), slippage terapan ${componentsApplied.slippageUsd.toFixed(4)} (terukur ${slippageUsd == null ? 'n/a' : slippageUsd.toFixed(4)})) — diterapkan ke buku resmi [GAPFIX 2026-11-17: gap/slippage terapan = max(0, terukur)]`);
  updateSummary();
  return { components, componentsApplied, totalUsd, nTxTotal };
}

// Gap keluar + slippage keluar. Gap: nilai mesin vs re-quote segar (seperti
// sebelumnya). Slippage: re-quote berjenjang kaki yang sama tepat
// SLIP_DELAY_MS sesudah quote segar pertama kaki itu — drift selama jendela
// pendaratan tx live. Mengembalikan { gapUsd, slipUsd, slipNote }; tiap nilai
// null bila tidak ada kaki yang terukur (diperlakukan 0 di total, tercatat).
async function measureExitGap(rec, val, snap) {
  if (!val || !snap) return { gapUsd: null, slipUsd: null, slipNote: 'val/snap kosong' };
  const t0 = Date.now();
  let gap = 0, measured = 0;
  const staged = []; // {label, fetchQuote, toUsd} — toUsd mengubah selisih out menjadi USD
  if ((rec.capitalAsset || 'USDC') !== 'SOL') {
    // Jalur USDC (exitQuote): token -> USDC, tumpukan SOL -> USDC.
    const token = +val.tokenAmount || 0;
    if (token > 0) {
      const engineOut = token * snap.price - (+val.tokenSwapCostUsd || 0);
      const raw = BigInt(Math.floor(token * 10 ** (rec.decX ?? 6)));
      const fetchQuote = () => S.quoteFresh(rec.mintX, USDC, raw, rec.decX ?? 6, 6);
      const q = await fetchQuote();
      if (q && q.ok && Number.isFinite(q.outUi)) { gap += engineOut - q.outUi; measured++; staged.push({ label: 'token-usdc', firstOut: q.outUi, fetchQuote, toUsd: d => d }); }
    }
    const pile = +val.solPile || 0;
    if (pile * (+snap.pxUsd || 0) >= 30 && !val.solPileEstimated) {
      const engineOut = pile * (+snap.pxUsd) - (+val.solSwapCostUsd || 0);
      const raw = BigInt(Math.floor(pile * 1e9));
      const fetchQuote = () => S.quoteFresh(SOL, USDC, raw, 9, 6);
      const q = await fetchQuote();
      if (q && q.ok && Number.isFinite(q.outUi)) { gap += engineOut - q.outUi; measured++; staged.push({ label: 'sol-usdc', firstOut: q.outUi, fetchQuote, toUsd: d => d }); }
    }
  } else {
    // Jalur modal SOL (exitSolQuote): token -> SOL (+ quote -> SOL bila bukan SOL).
    const px = +snap.pxUsd || 0; if (!(px > 0)) return { gapUsd: null, slipUsd: null, slipNote: 'harga SOL kosong' };
    const token = +val.tokenAmount || 0;
    if (token > 0) {
      const engineOutSol = token * snap.price - (+val.tokenSwapCostUsd || 0) / px;
      const raw = BigInt(Math.floor(token * 10 ** (rec.decX ?? 6)));
      const fetchQuote = () => S.quoteFresh(rec.mintX, SOL, raw, rec.decX ?? 6, 9);
      const q = await fetchQuote();
      if (q && q.ok && Number.isFinite(q.outUi)) { gap += (engineOutSol - q.outUi) * px; measured++; staged.push({ label: 'token-sol', firstOut: q.outUi, fetchQuote, toUsd: d => d * px }); }
    }
    const qa = +val.quoteAmount || 0, qm = rec.quoteMint || SOL;
    if (qa > 0 && qm !== SOL) {
      const engineOutSol = qa / px - (+val.solSwapCostUsd || 0) / px;
      const raw = BigInt(Math.floor(qa * 10 ** (rec.decX ?? 6)));
      const fetchQuote = () => S.quoteFresh(qm, SOL, raw, rec.decX ?? 6, 9);
      const q = await fetchQuote();
      if (q && q.ok && Number.isFinite(q.outUi)) { gap += (engineOutSol - q.outUi) * px; measured++; staged.push({ label: 'quote-sol', firstOut: q.outUi, fetchQuote, toUsd: d => d * px }); }
    }
  }
  // Slippage: tunggu sampai SLIP_DELAY_MS sejak quote segar pertama, lalu
  // quote ulang kaki yang sama persis. Total tambahan latensi tutup dibatasi.
  let slipUsd = null, slipNote = '';
  if (staged.length) {
    try {
      const elapsed = Date.now() - t0;
      if (elapsed > SLIP_MAX_WAIT_MS) { slipNote = 'slippage dilewati: jendela ukur melebihi batas ' + SLIP_MAX_WAIT_MS + 'ms'; }
      else {
        await waitMs(t0 + SLIP_DELAY_MS - Date.now());
        let slip = 0, slipMeasured = 0;
        for (const leg of staged) {
          try {
            const q1 = await leg.fetchQuote();
            if (q1 && q1.ok && Number.isFinite(q1.outUi)) { slip += leg.toUsd(leg.firstOut - q1.outUi); slipMeasured++; }
          } catch { /* kaki ini tidak terukur: tercatat lewat slipMeasured */ }
        }
        if (slipMeasured) slipUsd = slip;
        else slipNote = 're-quote berjenjang semua kaki gagal';
        if (slipMeasured < staged.length) slipNote = 're-quote berjenjang terukur ' + slipMeasured + '/' + staged.length + ' kaki';
      }
    } catch (e) { slipNote = String(e.message || e).slice(0, 120); }
  }
  return { gapUsd: measured ? gap : null, slipUsd, slipNote };
}

// --- Total koreksi tertutup + akrual priority posisi terbuka ---
function totals() {
  const allRows = S ? readJsonl(S.ledger) : [];
  // [F2 2026-11-17] Total fidelitas WAJIB terlingkup pada BUKU BERJALAN saja:
  // ledger tidak dirotasi saat state di-reset, jadi baris milik buku pendahulu di
  // folder paper yang sama ikut terbawa dan menggelembungkan total. Saring baris
  // ledger ke trade yang benar-benar ada di history buku berjalan (kunci
  // openedAt|pool|name dari state.json — history status + semua buku). Baris yang
  // tersaring keluar dihitung sebagai excludedRows dan TIDAK masuk total; bila
  // state/history tidak terbaca sama sekali, fallback ke semua baris (perilaku
  // lama) supaya total tidak menol karena kegagalan baca sesaat.
  let stCache = null;
  if (S) { try { stCache = JSON.parse(fs.readFileSync(path.join(S.dir, 'state.json'), 'utf8')); } catch { /* state belum ada */ } }
  let bookKeys = null;
  if (stCache) {
    const keys = new Set();
    const addHist = h => { if (h && h.openedAt) keys.add(h.openedAt + '|' + (h.pool || '') + '|' + (h.name || '')); };
    (stCache.history || []).forEach(addHist);
    for (const book of Object.values(stCache.books || {})) (book.history || []).forEach(addHist);
    if (keys.size) bookKeys = keys;
  }
  const rows = bookKeys ? allRows.filter(r => bookKeys.has(r.openedAt + '|' + (r.pool || '') + '|' + (r.name || ''))) : allRows;
  const excludedRows = allRows.length - rows.length;
  const tot = { priorityFeeUsd: 0, failedTxModelUsd: 0, entryGapUsd: 0, exitGapUsd: 0, slippageUsd: 0 };
  // [GAPFIX 2026-11-17] Total resmi memakai komponen TERAPAN (componentsApplied,
  // sesudah clamp asimetris) bila baris memilikinya; baris lama tanpa
  // componentsApplied memakai components terukur apa adanya.
  for (const r of rows) { const c = r.componentsApplied || r.components || {}; for (const k of Object.keys(tot)) tot[k] += +c[k] || 0; }
  let openAccrualUsd = 0, openCount = 0;
  if (S && stCache) {
    try {
      const st = stCache;
      const perTx = prioritySolPerTx(rateFor().ul);
      for (const book of Object.values(st.books || {})) {
        const poss = [...(book.position ? [book.position] : []), ...(book.positions || [])];
        for (const p of poss) {
          const nTx = Math.round((+p.networkFeesSol || 0) / S.txFeeSol);
          openAccrualUsd += nTx * perTx * (+p.lastSolUsd || +p.solUsdEntry || 0);
          openCount++;
        }
      }
    } catch { /* state belum ada */ }
  }
  return { rows: rows.length, excludedRows, tot, totalCorrectionsUsd: tot.priorityFeeUsd + tot.failedTxModelUsd + tot.entryGapUsd + tot.exitGapUsd + tot.slippageUsd, openAccrualUsd, openCount };
}

// Blok ringkas untuk disematkan writeSummary bot ke summary.json resmi.
function summaryBlock() {
  if (!S) return undefined;
  try {
    const t = totals();
    return {
      appliedToOfficialBook: true,
      note: 'Angka resmi buku ini SUDAH terkoreksi fidelitas (OB-38 diterapkan langsung, keputusan Indra 2026-11-15 22:50 WITA; model diamendemen adopsi studi fee bot asli 2026-11-15 23:41 WITA dan komponen slippage 2026-11-17): priority fee per kaki (DLMM tarif bot live tetap, swap tarif pasar sampel modul) dengan CU per keluarga tx + model biaya tx gagal 3% atas fee penuh tx terbesar + gap quote vs eksekusi (re-quote segar) + slippage jendela pendaratan (re-quote berjenjang +5 dtk, parameter jendela berlabel MODEL) dikurangkan dari PnL tiap trade tertutup. Sejak amendemen GAPFIX 2026-11-17 komponen gap (masuk/keluar) dan slippage diterapkan ASIMETRIS: nilai terapan = max(0, nilai terukur) — hanya boleh menurunkan PnL resmi, tidak pernah menaikkannya (live mengeksekusi satu quote; kredit gap-keluar bertanda terbukti menggelembungkan buku, lihat paper/RESTATEMENT-GAP-KELUAR-2026-11-17.md). Nilai terukur bertanda tersimpan di components, nilai terapan di componentsApplied. Rincian per trade: fidelity-ledger.jsonl; PnL mentah tersimpan di rawPnlUsd tiap baris history.',
      closedTrades: t.rows, excludedLedgerRows: t.excludedRows || 0,
      componentsClosed: t.tot,
      totalCorrectionsUsd: t.totalCorrectionsUsd,
      openPositions: t.openCount, openAccrualPriorityUsd: t.openAccrualUsd,
      model: { cuKeluarga: { dlmm: CU_DLMM, chunk: CU_CHUNK, chunkFailCap: CU_CHUNK_FAIL, swap: CU_SWAP, polos: CU_POLOS }, failRateModel: FAIL_RATE_MODEL, botTariffMicroLamports: BOT_TARIFF_MICROLAMPORTS, swapTariff: 'pasar (sampel getRecentPrioritizationFees modul; proksi rezim auto Jupiter)', sampleMs: SAMPLE_MS, slipDelayMs: SLIP_DELAY_MS, slipDelayBasis: 'MODEL: jendela pendaratan tx live (quote+bangun tx+inklusi 1-3 slot); drift di dalam jendela DIUKUR per trade via re-quote berjenjang' },
    };
  } catch { return undefined; }
}

// fidelity-summary.json: ekuitas resmi (sudah terkoreksi) vs hipotetis mentah.
function updateSummary() {
  if (!S) return;
  try {
    let officialEquityUsd = null;
    // [F1 2026-11-17] officialEquityUsd = EKUITAS sebenarnya (kas + nilai resmi posisi
    // terbuka) dari stats.equityUsd — sebelumnya membaca stats.virtualUsdc (KAS) lalu
    // menamainya ekuitas, kurang sebesar nilai posisi terbuka. hypotheticalRawEquityUsd
    // di bawah kini dibangun di atas basis ekuitas yang sama.
    try { const s = JSON.parse(fs.readFileSync(path.join(S.dir, 'summary.json'), 'utf8')); officialEquityUsd = s && s.stats ? +s.stats.equityUsd : null; } catch { /* ringkasan bot belum ada */ }
    const t = totals();
    const out = {
      label: 'MAIN — koreksi fidelitas OB-38 diterapkan LANGSUNG ke buku resmi (keputusan Indra 2026-11-15 22:50 WITA; model diamendemen adopsi studi fee bot asli 2026-11-15 23:41 WITA: priority per kaki + CU per keluarga; komponen slippage re-quote berjenjang ditambah 2026-11-17 atas perintah Indra); ekuitas resmi di bawah SUDAH terkoreksi, kolom mentah hanya hipotetis pembanding',
      at: new Date().toISOString(),
      officialEquityUsd,
      hypotheticalRawEquityUsd: officialEquityUsd == null ? null : officialEquityUsd + t.totalCorrectionsUsd + t.openAccrualUsd,
      closedTrades: t.rows, excludedLedgerRows: t.excludedRows || 0,
      componentsClosed: t.tot,
      totalCorrectionsUsd: t.totalCorrectionsUsd,
      openPositions: t.openCount, openAccrualPriorityUsd: t.openAccrualUsd,
      model: { cuKeluarga: { dlmm: CU_DLMM, chunk: CU_CHUNK, chunkFailCap: CU_CHUNK_FAIL, swap: CU_SWAP, polos: CU_POLOS }, failRateModel: FAIL_RATE_MODEL, botTariffMicroLamports: BOT_TARIFF_MICROLAMPORTS, swapTariff: 'pasar (sampel getRecentPrioritizationFees modul; proksi rezim auto Jupiter)', sampleMs: SAMPLE_MS, slipDelayMs: SLIP_DELAY_MS },
    };
    fs.writeFileSync(S.summary, JSON.stringify(out, null, 2));
  } catch { /* diam */ }
}

module.exports = { init, onOpen, noteLegClose, closeCorrection, summaryBlock, updateSummary };
