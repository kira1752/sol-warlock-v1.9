'use strict';
// Multi-position bookkeeping for live == the dry run (up to MAX_POSITIONS open at once, shared wallet USDC, one SOL pile PER position).
// state.positions is the source of truth; state.position is only the position being worked on inside withPos(). Pure: no IO, no chain.
function list(state) { return Array.isArray(state.positions) ? state.positions : (state.position ? [state.position] : []); }
// Keep state.positions in step with state.position at ANY moment (saveState calls this), so a crash after an open/close never loses or duplicates a position.
function syncPositions(state) {
  const a = state.__active, cur = state.position, l = list(state).slice(), i = a ? l.indexOf(a) : -1;
  if (a && a !== cur) { if (cur) { if (i >= 0) l[i] = cur; else l.push(cur); } else if (i >= 0) l.splice(i, 1); }
  else if (cur && !l.includes(cur)) l.push(cur);
  state.positions = l; return l;
}
async function withPos(state, pos, fn) {
  state.position = pos; state.__active = pos;
  try { return await fn(); } finally { syncPositions(state); state.position = null; state.__active = null; }
}
// What goes to disk: positions + position (=first, for older readers). The working pointer never persists.
function persistView(state) { const l = syncPositions(state); const { __active, ...rest } = state; return { ...rest, position: l[0] || null, positions: l }; }
function duplicate(positions, pool, mint) { return positions.some(p => p.pool === pool || (!!mint && p.mintX === mint)); }
// Same per-open budget rule as the dry run (paper-multi.budget over the paper book's shared cash): a fixed POSITION_USDC
// when set (0 when the cash cannot cover it), otherwise the cash split evenly over the free slots. The live "cash" is the
// wallet USDC balance; an explicit reposition budget (positionBudgetUsdc) bypasses this, exactly like the dry run.
function budget(positions, cash, settings) {
  const slots = Math.max(0, settings.MAX_POSITIONS - positions.length), c = +cash || 0;
  if (!slots) return 0;
  return settings.POSITION_USDC > 0 ? (c >= settings.POSITION_USDC ? settings.POSITION_USDC : 0) : c / slots;
}
// Same pick rules as the paper cycle: skip duplicates (same pool or same token), prefer pools quoted in the capital asset when any exist, never exceed MAX_POSITIONS.
function selectPicks({ picks, positions, max, preferredMint }) {
  const eligible = picks.filter(p => !duplicate(positions, p.address, p.token_x?.address));
  const chosen = eligible.some(p => p.token_y?.address === preferredMint) ? eligible.filter(p => p.token_y?.address === preferredMint) : eligible;
  return { chosen, free: Math.max(0, max - positions.length) };
}
module.exports = { list, syncPositions, withPos, persistView, duplicate, selectPicks, budget };
