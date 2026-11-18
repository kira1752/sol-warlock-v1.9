'use strict';
// The ORDER of on-chain calls for the entry deposit. It signs nothing itself: every chain call goes through the injected dlmm / send / wallet,
// so the exact sequence (create -> Spot share -> BidAsk share; narrow or extended position) is unit-tested with a fake DLMM.
// Dry run MIXED shape = Spot share first, then BidAsk share (OPEN_SPOT_PCT). A share of 0 is skipped; the shares sum EXACTLY to the planned lamports.
async function openDeposit({ dlmm, plan, actualSol, posKp, wallet, send, BN, StrategyType, lamports = 1e9, slippage, onCreated, log = () => {}, txFee = 0 }) {
  const total = Math.floor(actualSol * lamports);
  const spotLam = Math.floor(total * plan.split), bidLam = total - spotLam;
  const parts = [];
  if (spotLam > 0) parts.push({ type: StrategyType.Spot, name: 'spot', lam: spotLam });
  if (bidLam > 0) parts.push({ type: StrategyType.BidAsk, name: 'bidask', lam: bidLam });
  if (!parts.length) throw new Error('nothing to deposit');
  const paramsFor = part => ({ positionPubKey: posKp.publicKey, totalXAmount: new BN(0), totalYAmount: new BN(part.lam), strategy: { minBinId: plan.minBinId, maxBinId: plan.maxBinId, strategyType: part.type }, user: wallet.publicKey, slippage });
  let deposited = 0, complete = true, created = false;   // created = the position exists on chain
  // [PARITY R4 R-3] Meter the fees burned by FAILED sends (audit §2b/R-3: they used to vanish from the
  // books entirely). bot.js send() attaches the ACTUAL burned fee (RPC meta.fee) to its error as
  // feeBurnedSol; when a sender provides none, the caller's model per-tx fee applies (txFee =
  // CFG.TX_FEE_SOL, the codebase constant that already bundles the priority fee).
  let feesBurned = 0;
  const sendT = async (tx, signers, label) => { try { return await send(tx, signers, label); } catch (e) { feesBurned += (e && e.feeBurnedSol != null ? e.feeBurnedSol : txFee); throw e; } };
  for (const [i, part] of parts.entries()) {
    const params = paramsFor(part);
    try {
      if (i === 0) {
        if (!plan.wide) {
          const tx = await dlmm.initializePositionAndAddLiquidityByStrategy(params);
          await sendT(tx, [wallet, posKp], 'open-' + part.name); created = true;
        } else {
          const tx0 = await dlmm.createExtendedEmptyPosition(plan.minBinId, plan.maxBinId, posKp.publicKey, wallet.publicKey);
          await sendT(tx0, [wallet, posKp], 'open-extended-empty'); created = true;
          await onCreated({ depositedLamports: 0 });                       // the position exists on chain: record it before depositing
          const txs = await dlmm.addLiquidityByStrategyChunkable(params);
          for (const [j, t] of txs.entries()) await sendT(t, [wallet], `add-${part.name} ${j + 1}/${txs.length}`);
        }
        deposited += part.lam;
        if (!plan.wide) await onCreated({ depositedLamports: deposited }); // narrow: created together with the first deposit
        else await onCreated({ depositedLamports: deposited, update: true });
      } else {
        if (!plan.wide) { const tx = await dlmm.addLiquidityByStrategy(params); await sendT(tx, [wallet], 'add-' + part.name); }
        else { const txs = await dlmm.addLiquidityByStrategyChunkable(params); for (const [j, t] of txs.entries()) await sendT(t, [wallet], `add-${part.name} ${j + 1}/${txs.length}`); }
        deposited += part.lam;
      }
    } catch (e) {
      if (!created) { e.feesBurnedSol = feesBurned; throw e; }              // nothing exists on chain yet: the caller aborts; the total burned rides the error so the caller can book it to the open-intent bucket
      log(`  WARN ${part.name} add failed, position holds only ${deposited / lamports} SOL: ${e.message}`);
      complete = false; break;
    }
  }
  return { complete, depositedLamports: deposited, totalLamports: total, feesBurnedSol: feesBurned, parts: parts.map(p => ({ name: p.name, lam: p.lam })) };
}
// [PARITY R4 R-3] Pending burned-fee bucket for a live open INTENT, keyed by pool address (bot.js keeps
// it on the live state as state.openFeePending). Pure functions over a plain object. Fees burned by
// failed open attempts accumulate here; when the open finally succeeds they fold into the position's
// networkFeesSol; when the intent is cancelled they are dumped as ONE bot-level unattributed-cost
// history row that reduces the reported book PnL — visible, never silently lost (audit §2b/R-3).
function bookBurn(pending, pool, sol) {
  if (!pending || !pool || !(sol > 0)) return null;
  const b = pending[pool] || (pending[pool] = { sol: 0, attempts: 0 });
  b.sol += sol; b.attempts += 1; return b;
}
function foldBucket(pending, pool, pos) {
  const b = pending && pending[pool];
  if (!b || !(b.sol > 0) || !pos) return 0;
  pos.networkFeesSol = (pos.networkFeesSol || 0) + b.sol;
  const sol = b.sol; delete pending[pool]; return sol;
}
function dumpBucketRow(pending, pool, { name = null, pxUsd = 0, closedAt = null } = {}) {
  const b = pending && pending[pool];
  if (!b || !(b.sol > 0)) return null;
  delete pending[pool];
  const usd = pxUsd > 0 ? b.sol * pxUsd : 0;
  // pool/mintX stay null ON PURPOSE: a cost row must not trip the pool reopen-cooldown or any
  // per-pool/per-mint history filter; the pool is named in costPool for attribution.
  return { unattributedCost: true, reason: 'open_fees_unattributed', pool: null, costPool: pool, name, mintX: null, closedAt, feesBurnedSol: b.sol, attempts: b.attempts, solUsd: pxUsd || null, usdcIn: 0, usdcOut: 0, pnlUsd: -usd, pnlPct: 0, netPnlUsd: -usd, netPnlPct: 0, pnlCapital: -usd, pnlCapitalPct: 0 };
}
module.exports = { openDeposit, bookBurn, foldBucket, dumpBucketRow };
