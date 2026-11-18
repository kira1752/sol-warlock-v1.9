'use strict';
// Reshape + compound for live == paperReshape (dry run). Same trigger (price down N bins from lastReshapeActiveBin ?? entryActiveBin),
// same guard (leftover SOL must cover the tx fees), same range (reshape-core.tokenReshapeRange: [active+1 .. origMaxBinId]),
// same steps on the SAME position, in the dry run's order: claim fees -> compound claimed quote fees to the left (COMPOUND_SPOT_PCT)
// -> remove ONLY token-side bins (> active) -> re-add token-only (RESHAPE_SHAPE). Like paperReshape, the compound runs BEFORE the
// token-inventory and range checks, so it stands even when the reshape then skips/aborts.
// Every chain call is injected (dlmm / send / wallet balances), so the sequence is unit-tested with fakes; this module signs nothing.
const core = require('./reshape-core');
const strategy = require('./paper-strategy');   // shared geometry, same module the dry run uses (compound lower-extension width)
function trigger({ pos, activeBinId, settings, stop }) {
  if (stop || settings.RESHAPE_ENABLED === false) return { due: false };
  const n = settings.RESHAPE_N ?? 5, anchor = pos.lastReshapeActiveBin ?? pos.entryActiveBin, down = anchor - activeBinId;
  return { due: down >= n, down, n, anchor };
}
// [PARITY R4 R-5] The booked reshape txCost is the ACTUAL total fee burned, not the reshapeTxCount x
// txFee guess: every tx actually sent (claim / compound / remove / re-add, retries included) is metered
// below and priced from the same fee source as R-3 — the actual burned fee bot.js send() attaches to a
// failed send's error (RPC meta.fee), else the model per-tx fee txFee (= CFG.TX_FEE_SOL, which already
// bundles the priority fee). A reshape that dies mid-way still burned real fees: the total rides the
// thrown error (feesBurnedSol) so the caller can book it onto the still-open position (R-3).
async function reshape(args) {
  const meter = { txs: 0, cost: 0 };
  try { return await reshapeMetered({ ...args, meter }); }
  catch (e) { e.feesBurnedSol = meter.cost; e.txsSent = meter.txs; throw e; }
}
async function reshapeMetered({ pos, positionKey, slippage, dlmm, positionData, activeBinId, settings, txFee, StrategyType, BN, wallet, send, getTokenRaw, getSolBalance, sleep = async () => {}, log = () => {}, retries = 3, maxBins = 1400, maxResize = 91, meter }) {
  const compoundOn = settings.COMPOUND_ENABLED !== false;
  const sendC = async (tx, signers, label) => { try { const sig = await send(tx, signers, label); meter.txs++; meter.cost += txFee; return sig; } catch (e) { meter.txs++; meter.cost += (e && e.feeBurnedSol != null ? e.feeBurnedSol : txFee); throw e; } };
  const d = positionData, decX = pos.decX;
  const qDec = 10 ** (pos.quoteDecimals ?? 9), feeXui = Number(d.feeX.toString()) / 10 ** decX, feeYui = Number(d.feeY.toString()) / qDec;   // quote decimals: 9 SOL pool, 6 USDC pool
  const txsGuess = core.reshapeTxCount({ compoundedSol: compoundOn && feeYui > 0 }), txCostGuess = txsGuess * txFee;
  const pile = pos.leftoverSol != null ? pos.leftoverSol : Math.max(0, (await getSolBalance()) - (pos.walletBefore || 0));   // = the dry run's book.virtual.sol: THIS position's own SOL
  if (pile + 1e-12 < txCostGuess) return { skipped: 'leftover SOL buffer cannot cover reshape tx fees', leftoverSol: pile, txCostGuess, txs: 0, txCost: 0 };
  const range = core.tokenReshapeRange(pos.origMaxBinId, activeBinId);
  const tokenBins = (d.positionBinData || []).filter(b => b.binId > activeBinId && Number(b.positionXAmount) > 0).sort((a, b) => a.binId - b.binId);
  const tokenOnChain = tokenBins.reduce((s, b) => s + Number(b.positionXAmount), 0) / 10 ** decX;
  // [PARITY L-7] The token-inventory and range checks run AFTER the claim + compound below, in the dry run's order
  // (paperReshape reaches them only after compoundFeesToLeft). The values come from this pre-claim snapshot, which
  // the claim and the left-side compound never change (they touch fees and left bins only).
  const run = async (name, fn) => { let last; for (let i = 1; i <= retries; i++) { try { return await fn(); } catch (e) { last = e; log(`  reshape ${name} failed (${i}/${retries}): ${e.message}`); await sleep(2000); } } throw last; };
  const tokenBefore = await getTokenRaw();
  const owner = wallet.publicKey, position = positionKey || pos.position;
  // 1) claim all fees (token fees feeX and quote fees feeY land in the wallet)
  const claimTxs = await run('claim', async () => { const t = await dlmm.claimSwapFee({ owner, position }); return Array.isArray(t) ? t : [t]; });
  for (const [i, tx] of claimTxs.entries()) await run('claim send', () => sendC(tx, [wallet], `reshape-claim ${i + 1}/${claimTxs.length}`));
  // 2) [PARITY L-7] Compound the claimed quote fees to the LEFT bins (add only), COMPOUND_SPOT_PCT split like the
  // dry run — FIRST, before the token-inventory/range checks and before the token re-add, exactly like paperReshape
  // (compoundFeesToLeft runs there before those checks), so the compound stands even when the reshape then
  // skips/aborts. The claimed fees are already in the wallet from step 1, so nothing is compounded before it is
  // actually held. [PARITY L-11] The gate is feeYui > 0, the dry run's reshape-level gate (paperReshape: feeY > 0).
  // No bins below active inside the position (active == minBinId): like the dry run's compoundFeesToLeft, the
  // position is extended lower first (geometry n bins down, capped by MAX_BINS room and MAX_RESIZE) and the
  // compound runs over the extended range; pos.minBinId moves only when the adds actually landed.
  let compounded = 0; const errors = [];
  if (compoundOn && feeYui > 0) {
    let cMin = pos.minBinId, extendAdd = 0;
    try {
      if (activeBinId <= cMin) {
        const n = strategy.geometry(pos.binStep, settings, maxBins).n, wantMin = activeBinId - n;
        if (wantMin < pos.minBinId) {
          const room = maxBins - (pos.maxBinId - pos.minBinId + 1);
          extendAdd = Math.min(pos.minBinId - wantMin, room, maxResize);
          if (extendAdd > 0) cMin = pos.minBinId - extendAdd;
        }
      }
      if (activeBinId > cMin) {
        const w = (settings.COMPOUND_SPOT_PCT ?? 50) / 100, totalLam = Math.floor(feeYui * qDec), spotLam = Math.floor(totalLam * w), bidLam = totalLam - spotLam;
        if (extendAdd > 0) log(`  extend LOWER +${extendAdd} bins to ${cMin} so quote fees can be added on the left`);
        for (const [type, lam, nm] of [[StrategyType.Spot, spotLam, 'spot'], [StrategyType.BidAsk, bidLam, 'bidask']]) {
          if (!(lam > 0)) continue;
          const txs = await run('compound add ' + nm, async () => { const t = await dlmm.addLiquidityByStrategyChunkable({ positionPubKey: position, totalXAmount: new BN(0), totalYAmount: new BN(lam), strategy: { minBinId: cMin, maxBinId: activeBinId - 1, strategyType: type }, user: owner, slippage }); return Array.isArray(t) ? t : [t]; });
          for (const [i, tx] of txs.entries()) await run('compound send', () => sendC(tx, [wallet], `reshape-compound-${nm} ${i + 1}/${txs.length}`));
        }
        compounded = feeYui; if (extendAdd > 0) pos.minBinId = cMin;
      } else log('  cannot compound quote fees to the left: no bins below active and cannot extend');
    } catch (e) { errors.push('compound: ' + e.message); log('  ERROR compound failed, fees stay in the wallet pile: ' + e.message); }
  }
  // The dry run's checks, after the compound. (In the dry run the token-side withdrawal at this point is
  // bookkeeping it restores on the no-room path; here nothing has been withdrawn yet, so a skip leaves the token
  // side untouched — the same end state.) A skip return carries `compounded`, which the caller books onto the
  // position like the dry run's in-place feesCompoundedQuote mutation.
  if (!(tokenOnChain + (compoundOn ? feeXui : 0) > 0)) return { skipped: 'no token-side inventory or token fees to reshape', compounded, txs: meter.txs, txCost: meter.cost, ...range };
  if (!range.ok) return { skipped: 'no room on the right within original position edge', compounded, txs: meter.txs, txCost: meter.cost, ...range };   // checked BEFORE withdrawing: nothing is taken out
  // 3) withdraw ONLY the token-side bins (> active); the quote side is never withdrawn
  if (tokenBins.length) {
    const rm = await run('remove token bins', () => dlmm.removeLiquidity({ user: owner, position, fromBinId: tokenBins[0].binId, toBinId: tokenBins[tokenBins.length - 1].binId, bps: new BN(10000), shouldClaimAndClose: false }));
    for (const [i, tx] of rm.entries()) await run('remove send', () => sendC(tx, [wallet], `reshape-remove ${i + 1}/${rm.length}`));
  }
  await sleep(2000);
  const amountRaw = (await getTokenRaw()) - tokenBefore;       // withdrawn X + claimed feeX (feeX only when compound is on, like the dry run)
  const feeXRaw = BigInt(Math.floor(feeXui * 10 ** decX));
  const readdRaw = compoundOn ? amountRaw : amountRaw - (feeXRaw < amountRaw ? feeXRaw : amountRaw);
  const shape = settings.RESHAPE_SHAPE === 'SPOT' ? StrategyType.Spot : StrategyType.BidAsk;
  let tokenAdded = false;
  pos.reshapePending = readdRaw > 0n ? { amountRaw: readdRaw.toString(), rightMin: range.rightMin, rightMax: range.rightMax, shape: settings.RESHAPE_SHAPE || 'BIDASK' } : null;   // persisted by the caller: a crash/failure after the withdrawal can resume
  if (readdRaw > 0n) {
    try { await readd({ dlmm, pos, owner, position, StrategyType, BN, wallet, send: sendC, run, plan: pos.reshapePending, slippage }); tokenAdded = true; pos.reshapePending = null; }
    catch (e) { errors.push('token re-add: ' + e.message); log('  ERROR reshape token re-add failed; tokens stay in the wallet, retried next poll: ' + e.message); }
  }
  // [PARITY R4 R-5] txCost/txs = the metered ACTUAL total (see reshape wrapper); the guess is kept alongside for the record.
  return { ok: tokenAdded || readdRaw === 0n, tokenAdded, compounded, errors, range, amountX: Number(readdRaw) / 10 ** decX, feeXAdded: compoundOn ? feeXui : 0, txs: meter.txs, txCost: meter.cost, txsGuess, txCostGuess, tokenBins: tokenBins.length };
}
async function readd({ dlmm, owner, position, StrategyType, BN, wallet, send, run, plan, slippage }) {
  const type = plan.shape === 'SPOT' ? StrategyType.Spot : StrategyType.BidAsk;
  const txs = await run('token add', async () => { const t = await dlmm.addLiquidityByStrategyChunkable({ positionPubKey: position, totalXAmount: new BN(plan.amountRaw), totalYAmount: new BN(0), strategy: { minBinId: plan.rightMin, maxBinId: plan.rightMax, strategyType: type }, user: owner, slippage }); return Array.isArray(t) ? t : [t]; });
  for (const [i, tx] of txs.entries()) await run('token add send', () => send(tx, [wallet], `reshape-add-token ${i + 1}/${txs.length}`));
}
// Resume a re-add that was interrupted after the withdrawal (position keeps reshapePending until it succeeds).
async function resumePending(args) {
  const { pos } = args; if (!pos.reshapePending) return { resumed: false };
  // [PARITY R4 R-5] the resumed re-add's txs are metered like the main reshape, so the caller books their actual cost too
  const meter = { txs: 0, cost: 0 }, txFee = args.txFee || 0;
  const sendC = async (tx, signers, label) => { try { const sig = await args.send(tx, signers, label); meter.txs++; meter.cost += txFee; return sig; } catch (e) { meter.txs++; meter.cost += (e && e.feeBurnedSol != null ? e.feeBurnedSol : txFee); throw e; } };
  const run = async (name, fn) => { let last; for (let i = 1; i <= 3; i++) { try { return await fn(); } catch (e) { last = e; await (args.sleep || (async () => {}))(2000); } } throw last; };
  await readd({ ...args, send: sendC, owner: args.wallet.publicKey, position: args.positionKey || pos.position, run, plan: pos.reshapePending });
  pos.reshapePending = null; return { resumed: true, txs: meter.txs, txCost: meter.cost };
}
module.exports = { trigger, reshape, resumePending };
