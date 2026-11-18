'use strict';
// Swap back for live == the dry run (paper-usdc.exitQuote): the token goes to USDC DIRECTLY, and the position's whole SOL pile
// (quote side + leftover + refunded rent - fees = wallet SOL now minus wallet SOL before the position was opened) goes to USDC.
// Nothing else in the wallet is touched (no fixed SOL reserve): the wallet's own SOL is exactly what it was before the position.
// All chain calls are injected, so the sequence is unit-tested with fakes; this module signs nothing itself.
const SWAP_FEE_KEEP = 0.003;   // SOL that must stay to pay the pile swap itself
const SOL_DUST = 0.0005;   // below this a swap costs more than it returns (a swap of the pile is skipped only under this)
async function swapBack({ pos, pileSol, getToken, swapTokenToUsdc, closeTokenAccounts, getSolBalance, swapSolToUsdc, getUsdcBalance, sleep = async () => {}, log = () => {}, retries = 3, txFee = 0 }) {
  const out = { usdcBefore: await getUsdcBalance(), tokenSwapped: 0, solSwapped: 0, errors: [], feesBurnedSol: 0 };
  // [PARITY R4 R-3] Every failed attempt burned a real tx fee: accumulate it (the ACTUAL fee the
  // sender attaches to its error as feeBurnedSol — bot.js reads RPC meta.fee — else the model per-tx
  // fee txFee = CFG.TX_FEE_SOL) so the caller books it onto the position instead of losing it.
  const attempt = async (name, fn) => { for (let i = 1; i <= retries; i++) { try { return await fn(); } catch (e) { out.errors.push(`${name} #${i}: ${e.message}`); out.feesBurnedSol += (e && e.feeBurnedSol != null ? e.feeBurnedSol : txFee); log(`  ${name} failed (${i}/${retries}): ${e.message}`); await sleep(2000); } } return null; };
  const tok = await getToken();
  let tokenResidueRaw = 0n;
  if (tok && tok.raw > 0n) {
    const r = await attempt('token->USDC', async () => { const x = await swapTokenToUsdc(tok.raw, tok.decimals); if (!x || x.ok === false) throw new Error((x && x.error) || 'swap failed'); return x; });
    if (r) { out.tokenSwapped = Number(tok.raw); await attempt('close token account', () => closeTokenAccounts(tok)); }
    else tokenResidueRaw = tok.raw;   // [PARITY R4 R-2] the swap never landed: the token stays in the wallet and is booked on the close row as a residual asset, never dropped from the books
    await sleep(3000);
  }
  out.tokenResidueRaw = tokenResidueRaw.toString();
  out.tokenResidueUi = tok ? Number(tokenResidueRaw) / 10 ** (tok.decimals ?? 9) : 0;
  const sol = await getSolBalance();
  // pileSol = this position's own SOL (leftover buffer + refunded rent + quote side - fees), exactly book.virtual.sol of the dry run; other positions' SOL is never touched.
  // Fallback (no pileSol): wallet SOL minus the wallet SOL before the position opened. Always capped by what the wallet really holds (keep a little for the swap fee).
  const own = pileSol != null ? pileSol : sol - (pos.walletBefore || 0);
  const pile = Math.max(0, Math.min(own, sol - SWAP_FEE_KEEP));
  out.solPile = pile;
  if (pile > SOL_DUST) {
    const r = await attempt('SOL pile->USDC', async () => { const x = await swapSolToUsdc(BigInt(Math.round(pile * 1e9))); if (!x || x.ok === false) throw new Error((x && x.error) || 'swap failed'); return x; });
    if (r) out.solSwapped = pile;
  }
  await sleep(2000);
  out.usdcAfter = await getUsdcBalance();
  out.usdcOut = out.usdcAfter - out.usdcBefore;
  // [PARITY R4 R-2] This position's SOL that stays in the wallet unswapped: the SWAP_FEE_KEEP
  // remainder, a skipped <= SOL_DUST pile, or the whole pile when its swap failed. The caller books
  // it on the close row as recovered value, so row + wallet residue reconcile exactly (audit R-2).
  out.residueSol = Math.max(0, own - out.solSwapped);
  out.complete = out.errors.length === 0 || (out.tokenSwapped > 0 || !(tok && tok.raw > 0n)) && (out.solSwapped > 0 || pile <= SOL_DUST);
  return out;
}
module.exports = { swapBack, SOL_DUST, SWAP_FEE_KEEP };
