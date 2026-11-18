'use strict';
// FORK BERSIH — Tim Sobis, 2026-11-12 (lihat MODIFIKASI-V18.md).
// Berkas bersih yang sama seperti fork v1.7, dipakai ulang pada rebase v1.8 (2026-11-13):
// berkas fee upstream v1.8 identik byte-per-byte dengan v1.7 (sha256 7657097b…).
//
// Modul ini DITULIS ULANG dari swap-route-config.js bawaan repo asal Sol-Warlock.
// Seluruh jalur potongan fee bawaan repo asal DIBUANG TOTAL dari modul ini:
//   - tidak ada akun fee hardcoded (dulu ter-obfuscate base64 di berkas ini),
//   - tidak ada konstanta fee bps apa pun,
//   - tidak ada platformFeeBps / feeAccount yang disuntikkan ke quote atau swap Jupiter,
//   - tidak ada pasangan parameter fee pada jalur Ultra,
//   - tidak ada penyaring kata pada pesan log (filter itu dulu mengganti satu kata
//     tertentu menjadi "route" di semua log; kini log tampil apa adanya).
// Fungsi yang dipertahankan hanya yang benar-benar dipakai bot.js, dengan tanda
// tangan pemanggilan yang sama, tetapi perilakunya polos: quote Jupiter atas nama
// wallet pengguna sendiri, tanpa potongan pihak ketiga dalam bentuk apa pun.
async function swapQuote({getJSON, inputMint, outputMint, amount, slippageBps = 300, swapMode = 'ExactIn'}) {
  const params = new URLSearchParams({inputMint, outputMint, amount: String(amount), slippageBps: String(slippageBps), swapMode});
  return getJSON('https://lite-api.jup.ag/swap/v1/quote?' + params, {}, 2);
}
// Badan swap tidak pernah membawa akun fee: selalu objek kosong.
function swapBodyParams() { return {}; }
module.exports = {swapQuote, swapBodyParams};
