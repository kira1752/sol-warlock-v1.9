'use strict';
// Uji pagar N6 di basis v1.8 (porting 2026-11-13): WAJIB-1 penegakan plafon biaya atas estimasi batas-atas
// + WAJIB-2 pagar reshape di pemanggil + validasi setelan run gabungan v1.8.
// Semua lokal, tanpa jaringan/RPC/kunci.
// Jalankan: node test-n6-guards.js
const entryCost = require('./paper-entry-cost');
const reshapeCore = require('./reshape-core');
const paperSettings = require('./paper-settings');
const run = require('./strategy-v18-settings.json');

let pass = 0;
function ok(name, cond, extra) {
  if (!cond) { console.error('GAGAL: ' + name + (extra ? ' | ' + extra : '')); process.exitCode = 1; return; }
  pass++; console.log('LULUS: ' + name);
}

// ---------- WAJIB-1: kasus FLC ----------
// FLC (test N5 berjalan): siklus buka-tutup darurat membakar 0,2213 SOL
// non-refundable pada harga datar dalam 39 detik = 3,10x biaya satu bin array
// (0,07143744 SOL). Bentuk objek di bawah sama dengan keluaran entryCost.fast()
// pada jalur skip(): skipCheck=true + angka batas-atas.
const flcCost = {
  known: true, estimated: true, skipCheck: true, skipReason: 'MAX_NONREFUND_SOL dilewati',
  newBinArrays: 3, binArrayRentSol: 0.21431232, bitmapRentSol: 0.00691268,
  nonrefRentSol: 0.221225, openTxFeeSol: 0.000075, nonrefTotalSol: 0.2213,
  refundableRentSol: 0.05740608,
};

ok('FLC tanpa flag pada plafon 0,08: lolos (plafon mati lama, regresi utuh)', entryCost.rejection(flcCost, 0.08) === null);
ok('FLC tanpa flag pada plafon lama 0,05: lolos (regresi utuh)', entryCost.rejection(flcCost, 0.05) === null);
const rejN6 = entryCost.rejection(flcCost, 0.08, { enforceEstimate: true });
ok('FLC + ENFORCE pada plafon 0,08: TERTOLAK', typeof rejN6 === 'string' && rejN6.includes('0.221300') && rejN6.includes('0.080000'), String(rejN6));
ok('FLC + ENFORCE pada plafon 0,05: TERTOLAK', typeof entryCost.rejection(flcCost, 0.05, { enforceEstimate: true }) === 'string');
ok('plafon 0 = nonaktif walau ENFORCE menyala', entryCost.rejection(flcCost, 0, { enforceEstimate: true }) === null);
ok('placeholder saring (skipCheck, known:false) + ENFORCE: lolos di layar; open menghitung ulang berangka',
  entryCost.rejection({ skipCheck: true, known: false }, 0.08, { enforceEstimate: true }) === null);

// fast() integrasi dengan SDK stub: bitmap kosong -> semua array dalam rentang dihitung baru.
const sdkStub = { MAX_BIN_ARRAY_SIZE: 70, BIN_ARRAY_FEE: 0.07143744, BIN_ARRAY_BITMAP_FEE: 0.01180416, POSITION_FEE: 0.05740608, POSITION_BIN_DATA_SIZE: 112 };
const fastCost = entryCost.fast({ lbPair: { binArrayBitmap: [] } }, 0, 150, { sdk: sdkStub });
ok('fast() bitmap kosong: 3 array baru, batas atas 0,21438732 SOL',
  fastCost.newBinArrays === 3 && Math.abs(fastCost.nonrefTotalSol - 0.21438732) < 1e-9, JSON.stringify(fastCost));
ok('fast() mahal + ENFORCE 0,08: TERTOLAK', typeof entryCost.rejection(fastCost, 0.08, { enforceEstimate: true }) === 'string');
ok('fast() mahal tanpa flag: lolos (regresi)', entryCost.rejection(fastCost, 0.08) === null);

// Bitmap sudah terisi untuk indeks array rentang -> 0 array baru -> hanya fee tx.
const bitmapAda = []; bitmapAda[8] = '3'; // bit 512 & 513 terisi
const cheapCost = entryCost.fast({ lbPair: { binArrayBitmap: bitmapAda } }, 0, 10, { sdk: sdkStub });
ok('fast() array sudah ada: 0 array baru, total 0,000075 SOL',
  cheapCost.newBinArrays === 0 && Math.abs(cheapCost.nonrefTotalSol - 0.000075) < 1e-12, JSON.stringify(cheapCost));
ok('fast() murah + ENFORCE 0,08: lolos', entryCost.rejection(cheapCost, 0.08, { enforceEstimate: true }) === null);

// Jalur biaya pasti (estimate(), tanpa skipCheck): perilaku lama tidak berubah oleh opts.
const exactCost = { known: true, newBinArrays: 3, nonrefRentSol: 0.221225, openTxFeeSol: 0.000075, nonrefTotalSol: 0.2213, refundableRentSol: 0.05740608 };
ok('biaya pasti 0,2213 pada 0,05: tertolak (lama)', typeof entryCost.rejection(exactCost, 0.05) === 'string');
ok('biaya pasti 0,2213 pada 0,08: tertolak (lama)', typeof entryCost.rejection(exactCost, 0.08) === 'string');
ok('biaya pasti 0,04 pada 0,05: lolos (lama)', entryCost.rejection({ ...exactCost, nonrefTotalSol: 0.04 }, 0.05) === null);

// ---------- WAJIB-2: pagar reshape ----------
const nowMs = Date.parse('2026-11-13T02:00:00.000Z');
ok('pagar maks: reshapes=2, maks=2 -> tertahan', reshapeCore.reshapeGuard({ reshapes: 2, maxPerPosition: 2, nowMs }).blocked === true);
ok('pagar maks: reshapes=1, maks=2 -> jalan', reshapeCore.reshapeGuard({ reshapes: 1, maxPerPosition: 2, nowMs }).blocked === false);
ok('pagar jeda: reshape terakhir 30 mnt lalu, jeda 60 -> tertahan',
  reshapeCore.reshapeGuard({ reshapes: 0, lastAtMs: nowMs - 30 * 60000, minIntervalMin: 60, nowMs }).blocked === true);
ok('pagar jeda: terakhir 61 mnt lalu -> jalan',
  reshapeCore.reshapeGuard({ reshapes: 0, lastAtMs: nowMs - 61 * 60000, minIntervalMin: 60, nowMs }).blocked === false);
ok('pagar jeda: belum pernah reshape (lastAtMs null) -> jalan',
  reshapeCore.reshapeGuard({ reshapes: 0, lastAtMs: null, minIntervalMin: 60, nowMs }).blocked === false);
ok('REGRESI: kunci 0/0 -> tidak pernah tertahan walau reshapes=99 baru saja',
  reshapeCore.reshapeGuard({ reshapes: 99, lastAtMs: nowMs, maxPerPosition: 0, minIntervalMin: 0, nowMs }).blocked === false);
ok('lastReshapeAtMs: hanya pool yang sama, ambil yang terbaru',
  reshapeCore.lastReshapeAtMs([
    { pool: 'A', at: '2026-11-13T01:00:00.000Z' },
    { pool: 'B', at: '2026-11-13T01:59:00.000Z' },
    { pool: 'A', at: '2026-11-13T01:30:00.000Z' },
  ], 'A') === Date.parse('2026-11-13T01:30:00.000Z'));
ok('lastReshapeAtMs: tanpa riwayat -> null', reshapeCore.lastReshapeAtMs([], 'X') === null);

// ---------- Validator basis v1.8 atas setelan run gabungan ----------
const vRun = paperSettings.validatePatch(run.values);
ok('validator v1.8: seluruh values run gabungan valid', vRun.ok === true, vRun.ok ? '' : JSON.stringify(vRun.rejected));
ok('validator: tiga kunci pagar diterima sendiri-sendiri',
  paperSettings.validatePatch({ ENFORCE_NONREFUND_ESTIMATE: true, MAX_RESHAPES_PER_POSITION: 2, MIN_RESHAPE_INTERVAL_MIN: 60 }).ok === true);
ok('nilai pagar di setelan run persis: ENFORCE=true, MAKS_RESHAPE=2, JEDA=60, plafon=0,08',
  run.values.ENFORCE_NONREFUND_ESTIMATE === true && run.values.MAX_RESHAPES_PER_POSITION === 2 &&
  run.values.MIN_RESHAPE_INTERVAL_MIN === 60 && run.values.MAX_NONREFUND_SOL === 0.08);
ok('bawaan basis v1.8: pagar nonaktif (ENFORCE=false, maks=0, jeda=0) -> perilaku bawaan utuh',
  paperSettings.DEFAULTS.ENFORCE_NONREFUND_ESTIMATE === false &&
  paperSettings.DEFAULTS.MAX_RESHAPES_PER_POSITION === 0 &&
  paperSettings.DEFAULTS.MIN_RESHAPE_INTERVAL_MIN === 0);

// ---------- Pilihan porting run gabungan ----------
ok('porting: RESHAPE_N=12, RANGE_UP=25, RANGE_DOWN=90, band bin-step 100-200',
  run.values.RESHAPE_N === 12 && run.values.RANGE_UP_PCT === 25 && run.values.RANGE_DOWN_PCT === 90 &&
  run.values.MIN_BIN_STEP === 100 && run.values.MAX_BIN_STEP === 200);
ok('porting: cooldown 240, MIN_FT=1.5, MIN_LIQ_USD=15000',
  run.values.REOPEN_COOLDOWN_MIN === 240 && run.values.MIN_FT === 1.5 && run.values.MIN_LIQ_USD === 15000);
ok('porting: sleeve POSITION_USDC=100, MAX_POSITIONS=1',
  run.values.POSITION_USDC === 100 && run.values.MAX_POSITIONS === 1);
ok('TP tetap 13 bawaan v1.8', run.values.TP_USD_PCT === 13 && paperSettings.DEFAULTS.TP_USD_PCT === 13);
ok('knob sisi kanan N6 SENGAJA tidak dibawa (bawaan v1.8 yang berlaku)',
  run.values.OOR_RIGHT_CONFIRM_POLLS === undefined && run.values.OOR_RIGHT_MAX_REPOSITIONS === undefined &&
  run.values.OOR_RIGHT_MIN_PROFIT_PCT === undefined &&
  paperSettings.DEFAULTS.OOR_RIGHT_MIN_BINS === 5 && paperSettings.DEFAULTS.OOR_RIGHT_REPOSITION_MIN_PNL_PCT === -3);

console.log(`\n${pass} uji lulus${process.exitCode ? ' (ADA KEGAGALAN — lihat di atas)' : ''}.`);
