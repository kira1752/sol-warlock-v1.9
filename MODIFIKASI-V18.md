# MODIFIKASI-V18 — Fork Bersih Sol-Warlock v1.8 (Tim Sobis)

Folder ini adalah **persiapan rebase** fork bersih kita ke Sol-Warlock **v1.8**
(upstream `sicknature-x`, commit `6889002`, `package.json` 1.8.0; basis audit:
`~/workspace/sol-warlock-audit/v18/repo`, laporan `~/workspace/sol-warlock-audit/v18/REPORT.md`).

**Status: PERSIAPAN SAJA.** Belum di-deploy ke box mana pun, tidak menjalankan
bot, tanpa wallet/kunci. Bot yang sedang jalan (fork v1.7 di
`~/workspace/lp-bot-laptop/` dan box Simular) tidak disentuh sama sekali.

## Rangkaian commit (git lokal folder ini)

| Commit | Isi |
|---|---|
| `bb19d0d` | fork: salinan persis Sol-Warlock v1.8 (6889002), pra-modifikasi — terverifikasi `diff -r` terhadap clone audit = 0 beda |
| `2aa4de2` | fase 1 di v1.8: potong fee referral + cabut cleanMessage (fork bersih) |
| `858a98f` | anti-PvP tertua-menang (registri N 135), divergensi sadar fork |
| (dokumen ini) | docs: MODIFIKASI-V18 |

## Divergensi kita vs upstream v1.8

### 1. Fee referral dipotong total (sama seperti fork v1.7)
- Berkas fee upstream v1.8 `swap-route-config.js` identik byte-per-byte dengan
  v1.7 (sha256 `7657097b…`), jadi berkas bersih hasil potongan fork lama dipakai
  ulang apa adanya (sha256 `5fd3502a…`): tidak ada akun fee hardcoded, tidak ada
  konstanta bps, tidak ada `platformFeeBps`/`feeAccount` yang disuntikkan ke
  quote/swap Jupiter, tidak ada parameter fee jalur Ultra. Yang dipertahankan
  hanya `swapQuote` + `swapBodyParams` (badan swap selalu objek kosong).
- `bot.js`: panggilan `swapRoute.cleanMessage(...)` di fungsi `log()` (baris 147
  di v1.8) dicabut; log sekarang hanya lewat `env-config.redact` (redaksi rahasia
  tetap berlaku), tampil apa adanya.
- Kompatibilitas terverifikasi: di seluruh pohon v1.8 hanya `bot.js` yang
  me-require modul ini, dan ekspor yang dibuang (`cleanMessage`, `feeCandidates`,
  `swapFeeParams`, `ultraOrderParams`, `ultraOrder`, `ROUTE_FEE_BPS`,
  `SWAP_ROUTE_ACCOUNT`, `ULTRA_ROUTE_ACCOUNT`) tidak punya pemakai lain (grep = 0).

### 2. Anti-PvP tertua-menang (registri N 135) — TERAPAN
- Mekanisme v1.8 identik bentuknya dengan v1.7 (`anti-pvp.js` tidak berubah di
  diff 1.7→1.8 pada komparatornya), jadi padanannya jelas: satu baris komparator
  `cmp` ditukar urutannya — **tertua dulu** (`createdAtMs` naik), lalu likuiditas
  terbesar, lalu mint — persis perubahan fork lama. Nama mode bawaan upstream
  (`KEEP_BIGGEST`) dipertahankan; yang berubah hanya urutan peringkatnya.
- Pilihan sadar fork: urutan penerbit (likuiditas-terbesar-menang) tetap dicatat
  sebagai varian belum teruji.

### 3. Take profit: bawaan v1.8, TIDAK diubah
- `TP_USD_PCT = 13` terkonfirmasi sebagai bawaan v1.8
  (`paper-settings.js` DEFAULTS baris 39; `TP` legacy diturunkan darinya via
  `syncTp`). Tidak diubah, dan tidak ada knob lain yang diubah dari bawaan 1.8.
- Catatan: fork lama (fase 2) sempat menaikkan TP ke 20 ala paket keluar N 127 —
  perubahan itu **tidak** dibawa ke rebase ini (di luar cakupan brief persiapan).

## Hasil verifikasi (grep seluruh pohon, di luar .git)

| Pola | Hasil |
|---|---|
| `ROUTE_FEE_BPS` | **0** |
| kedua akun fee (`H7f8…3qg9`, `55i4…HgCP4`) | **0** |
| program `REFER4…9iF3` | **0** |
| blob base64 `cmVmZXJyYWw` | **0** |
| `cleanMessage` | **0** |
| `ultraOrder` / `swapFeeParams` / `feeCandidates` | **0** |
| `platformFeeBps` / `feeAccount` | 0 di kode — sisa 1 penyebutan tekstual di komentar header berkas bersih kita sendiri (`swap-route-config.js:10`, kalimat "tidak ada … yang disuntikkan…"), bukan kode yang dieksekusi |
| kata `referral` | 0 di kode — sisa 1 penyebutan di `CHANGES.md:24`, teks changelog upstream v1.8 (klaim penerbit bahwa fee "dijelaskan terbuka … tertulis di README"; audit v1.8 menemukan klaim itu tidak terbukti). Dipertahankan apa adanya sebagai bagian salinan persis + catatan sejarah upstream |

- `node --check` lulus untuk ketiga berkas yang disentuh:
  `swap-route-config.js`, `bot.js`, `anti-pvp.js`.
- Salinan awal terverifikasi `diff -r` = 0 beda sebelum commit pertama.

## Butir terbuka

1. Dua penyebutan tekstual di atas (komentar berkas bersih + changelog upstream)
   membuat grep kata secara harfiah bukan nol mutlak, walau mesin fee-nya nol di
   kode. Membersihkannya sampai nol mutlak = keputusan Manager/Indra, tidak
   dilakukan sepihak di persiapan ini.
2. Rebase ini **belum** membawa modifikasi fork lama sesudah fase 1 (paket keluar
   N 127 / TP 20, ukuran sleeve `POSITION_USDC 100` + `MAX_POSITIONS 1`, lantai
   TVL $5.000, identitas UI fork, perbaikan telegram polling, penjaga N6).
   Semuanya perlu brief/keputusan tersendiri sebelum ada deploy.
3. Belum di-deploy, belum `parity-check`, belum diuji jalan — sesuai pagar
   persiapan. Langkah deploy (bila diputuskan) mengikuti pola folder terpisah di
   box seperti `DEPLOY-N6.md` fork lama.

---

## Porting modifikasi pilihan (2026-11-13 malam, keputusan Indra 18:15 WITA)

Konteks: run paper N5 di box Simular **divonis GAGAL** oleh Indra (penurunan
terlalu besar; berkas vonis: `~/workspace/lp-bot-laptop/VONIS-RUN-N5.md`).
Basis v1.8 ini menjadi penggantinya: basis 1.8 + modifikasi pilihan di bawah,
dana paper baru **100 USDC**, jendela 7 hari. Butir terbuka no. 2 di atas dengan
ini tertutup sebagian: yang dibawa hanya daftar di bawah; sisanya (paket keluar
N 127 ala fork lama termasuk TP 20, identitas UI, perbaikan telegram polling,
lantai TVL $5.000 ala fork lama) tetap tidak dibawa.

### Commit porting

| Commit | Isi |
|---|---|
| `9f58b38` | WAJIB-1: `paper-entry-cost.js` `rejection()` menegakkan plafon atas estimasi batas-atas fast() bila `ENFORCE_NONREFUND_ESTIMATE=true` (tanpa flag = perilaku lama persis); kunci + skema + pengecualian forbidden di `paper-settings.js`; 4 titik panggil di `bot.js` (layar saring, 2× paper open, live open) + daftar kunci CFG |
| `9dbbcc0` | WAJIB-2: `reshapeGuard` + `lastReshapeAtMs` di `reshape-core.js`; pagar di pemanggil reshape paper dan live di `bot.js` (kunci bawaan 0 = nonaktif); jalur live kini mencatat `lastReshapeAt` |
| `c23a231` | FIELDS geometri `RANGE_DOWN_PCT`/`RANGE_UP_PCT`/`LOWER_BINS` di `paper-settings.js` (di v1.8 hulu kunci ini belum bisa diatur lewat settings.json); `strategy-v18-settings.json`; `test-n6-guards.js` terporting |

### Yang DIBAWA (nilai di `strategy-v18-settings.json`)

- Penegakan batas biaya buka: `ENFORCE_NONREFUND_ESTIMATE=true`, `MAX_NONREFUND_SOL=0.08`.
- Pagar reshape: `MAX_RESHAPES_PER_POSITION=2`, `MIN_RESHAPE_INTERVAL_MIN=60`.
- Geometri: `RESHAPE_N=12`, `RANGE_UP_PCT=25`, `RANGE_DOWN_PCT=90` (Evil Panda), band bin-step `100–200`.
- Saringan: `MIN_FT=1.5` (%/30 mnt), `MIN_LIQ_USD=15000`, `REOPEN_COOLDOWN_MIN=240`.
- Sleeve: `POSITION_USDC=100`, `MAX_POSITIONS=1`.

### Yang SENGAJA TIDAK dibawa

- Knob reposisi/tutup sisi kanan versi N6 (`OOR_RIGHT_CONFIRM_POLLS=6`,
  `OOR_RIGHT_MAX_REPOSITIONS=1`, `OOR_RIGHT_MIN_PROFIT_PCT=2`): satu penjaga
  per fungsi — yang berlaku rem bawaan v1.8 (`OOR_RIGHT_MIN_BINS=5`,
  `OOR_RIGHT_REPOSITION_MIN_PNL_PCT=-3`, konfirmasi 2 poll, maks reposisi 2,
  profit min 0,5%).
- `TP_USD_PCT=20` ala N6/N127: TP tetap **13** bawaan v1.8.
- Paket keluar lain (SL+, stale close) tetap bawaan v1.8 apa adanya.

### Verifikasi porting

- `node test-n6-guards.js` di basis v1.8: **31/31 lulus**, termasuk kasus FLC
  (biaya 0,2213 SOL) **tertolak pada plafon 0,08** dengan ENFORCE menyala, dan
  regresi tanpa flag utuh.
- Grep ulang sesudah porting (hanya `*.js`): `ROUTE_FEE_BPS` 0, kedua akun fee
  0, program `REFER4…` 0, blob `cmVmZXJyYWw` 0, `cleanMessage` 0.
  `platformFeeBps` 1× = komentar header berkas bersih kita sendiri (bukan kode).
- `node --check` lulus: `bot.js`, `paper-entry-cost.js`, `paper-settings.js`,
  `reshape-core.js`.

## Perbaikan miniapp CPU 100% (2026-11-13, perintah Indra 18:39 WITA)

**Penyebab (terbukti baris kode, `telegram-notify.js` basis v1.8):** rantai tiga
langkah yang semuanya jalan tanpa jeda bila token Telegram tidak terlihat oleh
proses miniapp — persis keadaan box (.env folder baru tanpa token untuk proses
miniapp):

1. `getUpdates()` (baris ±518): `if (!token) return resolve({ ok: false,
   skipped: 'token not set' })` — promise langsung selesai, **tanpa I/O sama
   sekali**.
2. `pollOnce()` mengembalikan hasil non-ok itu tanpa melempar error.
3. `startPolling()` v1.8: `while (polling) { try { await pollOnce(); } catch {
   sleep 2000 } }` — backoff hanya ada di jalur `catch`, sedangkan jalur
   tanpa-token **resolve**, bukan throw. Loop menjadi putaran microtask murni:
   event loop kelaparan, socket HTTP mendengarkan tetapi tidak pernah
   memproses request, CPU 100% terus. Terbukti di box pada dua instans
   (PID 7722 dan 7762: 100% CPU, `curl /health` kode 000).

**Akar perubahannya:** fork lama (basis 1.7) sebenarnya sudah membawa
perbaikan Tim Sobis untuk bug yang sama persis (2026-11-12, tercatat di
komentar kode fork lama mengacu DIAGNOSIS-MINIAPP-2026-11-12.md), tetapi
perbaikan itu tidak masuk daftar modifikasi pilihan yang diporting ke basis
v1.8, dan upstream 1.8 sendiri memang belum memperbaikinya.

**Perbaikan (minimal, searah desain asli — menerapkan ulang perbaikan fork
lama ke basis v1.8):** di `startPolling()`:
- jangan mulai polling sama sekali bila `loadToken()` kosong
  (`return { ok: false, skipped: 'token not set' }`);
- setiap hasil poll non-ok (bukan hanya throw) wajib backoff 2000 ms sebelum
  iterasi berikutnya.

Tidak ada perubahan lain; handler `/health` dan jalur bot tidak disentuh.

**Bukti uji:** lokal di VM (tanpa token, port 8799): `/health` →
`{"ok":true,"paper":true}`, CPU proses **0,00%** selama 10 detik
(sebelumnya 100%). Di box sesudah deploy: lihat catatan deploy di log harian
2026-11-13.
