# Sol-Warlock v1.9

Automated liquidity-provider bot for **Meteora DLMM** pools on Solana — pool screening, position management, repositioning, reshape + compound, and a layered exit system (take-profit, out-of-range rules, SL+ floor/lock). Runs in a full **paper (simulation)** mode with fidelity corrections, and a **live** mode that executes on-chain.

This is a fork of **Sol-Warlock by sicknature-x**, extended with a paper-trading engine, the SL+ exit system, and the v1.9 paper↔live parity work described below.

## What's new in 1.9 — the parity release

One codebase drives both paper and live; v1.9 makes their *accounting* provably identical, so a strategy measured in paper books the same numbers live for the same execution results.

Verified by differential testing (independent auditor fixtures, bit-for-bit `Object.is` comparisons):

- **8,037 randomized differential cases** across budget, exit decisions (6,141 polls), and close valuation — zero differences after the fixes.
- **Full lifecycle tests** (open → out-of-range → reposition → reshape + compound → close; TP / emergency / SL+ floor / SL+ lock endings) — final PnL identical to the paper book.
- **65 stubbed-transaction fixture assertions** — failed opens, failed closes, failed swaps, reshapes — every burned fee and residual booked exactly.

Bookkeeping gaps closed in 1.9:

- Recorded open fees and refundable-rent composition in live now match the paper definitions exactly.
- **Failed-transaction fees are booked** in live, taken from the actual on-chain fee per signature (with the bot's existing fee-model constant as fallback): failed closes accumulate onto the still-open position; failed opens collect in a per-pool pending bucket that folds into the position on success or lands on an explicit unattributed-cost row if the open is abandoned.
- **Swap-back residuals are attributed** to the closing trade (fee-keep remainder, dust, failed-swap remainder, unswapped token residue), valued at the close price and included in the close valuation.
- **Reshape costs are trued-up** to the actual number of transactions sent and their actual fees, instead of a pre-execution guess.
- Live position polling cadence now matches paper (fast wake while positions are open).

Honest limits: the tested and proven path is **paper mode** plus the accounting code above. Live execution has **not** been mainnet-tested by us yet. Nothing in this build blocks you from running live — whether and when to do so is entirely your own decision and risk. Test in paper mode first.

## Quick start

Requirements: Node.js 18+, a Solana RPC endpoint (Helius recommended).

```bash
npm install
cp .env.example .env   # fill in SOLANA_RPC_URL and/or HELIUS_API_KEY, JUPITER_API_KEY
node bot.js            # PAPER=true and DRY_RUN=true are the safe defaults
```

- Paper books, settings and state are written under `paper/` (created on first run; gitignored).
- Self-check that live and dry-run share the same strategy surface: `node parity-check.js`
- The optional web UI lives in `miniapp/` (`node miniapp/server.js`).

## Safety

- **Never commit your `.env`** — it holds your RPC keys and, for live mode, your wallet private key. It is gitignored by default; keep it that way.
- Live mode requires `DRY_RUN=0` and `LIVE_CONFIRMED=1` in your `.env` — your own deliberate opt-in, nothing else gates it. Use a fresh, small wallet for any live test.
- This software manages real funds in live mode and comes with no warranty. Paper results do not guarantee live results: execution on-chain (fills, slippage, failed transactions) is real even though the bookkeeping now accounts for all of it.

## Credits & license

Original bot: **Sol-Warlock by sicknature-x**. This fork adds the paper engine, SL+ exits, fidelity corrections, and the v1.9 parity hardening. License: ISC (see `package.json`). Historical notes: `CHANGES.md`, `MODIFIKASI-V18.md`.
