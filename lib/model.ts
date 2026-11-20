// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// radar-2 scores every pre-token protocol on five multipliers, not the house pair alone. Growth
// and maturity are the house model's; breadth, launch and confidence are the radar's own read of
// the same snapshot, added because a launch is worth more when it can reach more chains, when it
// is young and already growing, and worth less when the snapshot cannot even say how it moved
// in the last seven days. No protocol name is ever special-cased: the same function scores
// every row, and every multiplier comes from the protocol's own record.
//
//   base        = tvl_usd x BASE_MULTIPLE
//   growth      = clamp(change_7d, -60, 120) per cent
//   growthMult  = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity    = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   breadth     = min(1 + 0.03 x (chains - 1), 1.08)       (one chain: 1.00)
//   launch      = 1.05 when age_days <= 180 and growth > 0, else 1.00
//   confidence  = 0.97 when change_7d is missing, else 1.00
//   implied     = max(1, round(base x growthMult x maturity x breadth x launch x confidence))
//
// Rounding happens in two stages, and the dashboard repeats both: first every multiplier is
// rounded to four decimals (the values the board stores and the drawer shows), then the product
// is rounded to a whole dollar. A row recomputed on the page lands on the board's dollar
// exactly, so the page and the board agree to the dollar. The board covers every slug in the
// snapshot's watchlist (the floor, never a ceiling) and may add pre-token protocols below the
// watchlist floor: the early rows the radar exists to find. A protocol is pre-token when its
// index entry records no token (no market cap, no CoinGecko id, no symbol); the snapshot's
// live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board. Every farm step is generated from the protocol's own record (category,
// chains, TVL, age), never from a hand-written list of names.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_cap: number;
  launch_window_days: number;
  launch_multiplier: number;
  confidence_missing_multiplier: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_cap: 1.08,
  launch_window_days: 180,
  launch_multiplier: 1.05,
  confidence_missing_multiplier: 0.97,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    launch_multiplier: number;
    confidence_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the board's own farm plan attached. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  launch_multiplier: number;
  confidence_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Four decimals, the first rounding stage: every multiplier the board stores is cut here. */
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** One protocol's whole score: every multiplier, each already cut to four decimals. */
export interface ScoreBreakdown {
  slug: string; // which protocol this breakdown scores
  name: string; // its display name on the board
  base_value_usd: number;
  growth_pct: number;
  growth_multiplier: number; // after the four-decimal cut
  maturity_multiplier: number; // after the four-decimal cut
  breadth_multiplier: number; // after the four-decimal cut
  launch_multiplier: number; // after the four-decimal cut
  confidence_multiplier: number; // after the four-decimal cut
  age_days: number | null; // days since listing, null when unlisted
  implied_value_usd: number; // the board's dollar for this row
}

/** The five multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; launchMult: number; confidenceMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = round4(1 + (growthPct / 100) * model.growth_weight);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = round4(model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range);
  const chainsBeyondFirst = Math.max(0, protocol.chains.length - 1);
  const breadthMult = round4(Math.min(1 + model.breadth_per_chain * chainsBeyondFirst, model.breadth_cap));
  const launchMult = age !== null && age <= model.launch_window_days && growthPct > 0 ? model.launch_multiplier : 1;
  const confidenceMult = protocol.change_7d === null ? model.confidence_missing_multiplier : 1;
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult * launchMult * confidenceMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, launchMult, confidenceMult, age };
}

/** One protocol's score, broken down multiplier by multiplier, in plain words. */
export function explainScore(protocol: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): { breakdown: ScoreBreakdown; text: string } {
  const v = impliedValue(protocol, asOf, model);
  const breakdown: ScoreBreakdown = {
    slug: protocol.slug,
    name: protocol.name,
    base_value_usd: protocol.tvl_usd * model.base_multiple,
    growth_pct: v.growthPct,
    growth_multiplier: v.growthMult,
    maturity_multiplier: v.maturityMult,
    breadth_multiplier: v.breadthMult,
    launch_multiplier: v.launchMult,
    confidence_multiplier: v.confidenceMult,
    age_days: v.age,
    implied_value_usd: v.implied,
  };
  const notes: string[] = [];
  notes.push(`${protocol.name} starts at $${Math.round(breakdown.base_value_usd).toLocaleString('en-US')} of base value from $${protocol.tvl_usd.toLocaleString('en-US')} of TVL.`);
  notes.push(`Growth ${v.growthPct}% over seven days gives a x${v.growthMult} multiplier.`);
  notes.push(v.age === null ? 'Its listing date is unknown, so maturity is scored at a year of age.' : `Listed ${v.age} days ago, maturity scores x${v.maturityMult}.`);
  if (v.breadthMult > 1) notes.push(`It runs on ${protocol.chains.length} chains, so breadth adds x${v.breadthMult}.`);
  if (v.launchMult > 1) notes.push(`It is young and growing, so the launch window adds x${v.launchMult}.`);
  if (v.confidenceMult < 1) notes.push('Its seven-day move is missing, so confidence takes a x0.97 haircut.');
  notes.push(`Implied value: $${v.implied.toLocaleString('en-US')}.`);
  return { breakdown, text: notes.join(' ') };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, breadthMult, launchMult, confidenceMult, age } = impliedValue(p, snapshot.as_of, model);
    return { p, implied, growthPct, growthMult, maturityMult, breadthMult, launchMult, confidenceMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      breadth_multiplier: s.breadthMult,
      launch_multiplier: s.launchMult,
      confidence_multiplier: s.confidenceMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Lend $${capital} of USDC on ${name} (${chain}) and leave the deposit earning while the position stays open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'))
    return `Add $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the LP position open.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC onto ${chain} through ${name}, then use the bridged funds inside its app.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} worth of the chain's staking asset through ${name} and keep the staking receipt.`;
  if (c.includes('perpetual') || c.includes('derivative'))
    return `Post $${capital} of USDC as margin on ${name} and open a single small hedged trade.`;
  if (c.includes('prediction'))
    return `Fund your ${name} account with $${capital} and take one position in an active market.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with what it costs and how long it takes. The plan
 * is derived from the protocol's own record (category, chains, TVL, age), never from a hand-written
 * list of names. Every step stays inside the gate's 20..600 characters.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  const steps = [
    `Set up a fresh wallet that holds only the funds you plan to farm with, and store its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.`,
    `${actionFor(p, capital, chain)} Cost: $${capital} of capital and about $${gas} of gas. Time: 15 minutes to set up.`,
    `Do one qualifying action each week, such as a deposit, a borrow, a swap or a vote. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so your activity is counted in more than one snapshot. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `Before withdrawing, open the protocol's own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.`,
    `Record the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.`,
  ];
  for (const s of steps) {
    if (s.length < 20 || s.length > 600) throw new Error(`farm step out of bounds (${s.length} chars): ${s}`);
  }
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the board's own farm plan attached. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    launch_multiplier: row.model.launch_multiplier,
    confidence_multiplier: row.model.confidence_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The p-th percentile of sorted values, rounded to a whole dollar; 0 when there is nothing. */
function percentileOf(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const at = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(at);
  const upper = Math.ceil(at);
  const exact = sortedValues[lower]! + (sortedValues[upper]! - sortedValues[lower]!) * (at - lower);
  return Math.round(exact);
}

/** The board in numbers: size, median and top implied value, and how many rows each new signal moved. */
export interface BoardScoreSummary {
  rows: number;
  median_implied_value_usd: number;
  top_implied_value_usd: number;
  bottom_implied_value_usd: number;
  p25_implied_value_usd: number;
  p75_implied_value_usd: number;
  total_implied_value_usd: number;
  breadth_bonus_rows: number;
  launch_bonus_rows: number;
  confidence_haircut_rows: number;
}

export function summarizeBoard(board: BoardRow[]): BoardScoreSummary {
  const values = board.map((r) => r.implied_value_usd).sort((a, b) => a - b);
  const n = values.length;
  const median = n === 0 ? 0 : n % 2 === 1 ? values[(n - 1) / 2]! : Math.round((values[n / 2 - 1]! + values[n / 2]!) / 2);
  const summary: BoardScoreSummary = {
    rows: n,
    median_implied_value_usd: median,
    top_implied_value_usd: n === 0 ? 0 : values[n - 1]!,
    bottom_implied_value_usd: n === 0 ? 0 : values[0]!,
    p25_implied_value_usd: percentileOf(values, 25),
    p75_implied_value_usd: percentileOf(values, 75),
    total_implied_value_usd: values.reduce((sum, v) => sum + v, 0),
    breadth_bonus_rows: board.filter((r) => r.model.breadth_multiplier > 1).length,
    launch_bonus_rows: board.filter((r) => r.model.launch_multiplier > 1).length,
    confidence_haircut_rows: board.filter((r) => r.model.confidence_multiplier < 1).length,
  };
  return summary;
}

/** One category's share of the board: how many rows, and its strongest and middle row. */
export interface CategorySlice {
  category: string;
  rows: number;
  top_implied_value_usd: number;
  median_implied_value_usd: number;
}

export function categorySummary(board: BoardRow[]): CategorySlice[] {
  const byCategory = new Map<string, number[]>();
  for (const row of board) {
    const key = row.category ?? 'Other';
    const values = byCategory.get(key) ?? [];
    values.push(row.implied_value_usd);
    byCategory.set(key, values);
  }
  const slices = [...byCategory.entries()].map(([category, values]) => {
    const sorted = values.sort((a, b) => a - b);
    const mid = sorted.length;
    const median = mid % 2 === 1 ? sorted[(mid - 1) / 2]! : Math.round((sorted[mid / 2 - 1]! + sorted[mid / 2]!) / 2);
    return { category, rows: sorted.length, top_implied_value_usd: sorted[sorted.length - 1]!, median_implied_value_usd: median };
  });
  slices.sort((a, b) => b.top_implied_value_usd - a.top_implied_value_usd || b.rows - a.rows);
  return slices;
}

/** One chain's share of the board: how many ranked rows run on it, and its strongest row. */
export interface ChainSlice {
  chain: string;
  rows: number;
  top_implied_value_usd: number;
}

export function chainSummary(board: BoardRow[]): ChainSlice[] {
  const byChain = new Map<string, { rows: number; top: number }>();
  for (const row of board) {
    for (const chain of row.chains) {
      const seen = byChain.get(chain) ?? { rows: 0, top: 0 };
      seen.rows += 1;
      if (row.implied_value_usd > seen.top) seen.top = row.implied_value_usd;
      byChain.set(chain, seen);
    }
  }
  const slices = [...byChain.entries()].map(([chain, seen]) => ({ chain, rows: seen.rows, top_implied_value_usd: seen.top }));
  slices.sort((a, b) => b.rows - a.rows || b.top_implied_value_usd - a.top_implied_value_usd);
  return slices;
}

/** How one board moved against an older one: rank changes, arrivals and departures, by slug. */
export interface BoardMovement {
  slug: string; // which protocol moved
  name: string; // its display name
  previous_rank: number | null;
  rank: number | null;
  rank_delta: number | null;
}

export function diffBoards(previous: BoardRow[], next: BoardRow[]): BoardMovement[] {
  const before = new Map(previous.map((r) => [r.slug, r]));
  const after = new Map(next.map((r) => [r.slug, r]));
  const slugs = new Set([...before.keys(), ...after.keys()]);
  const moves: BoardMovement[] = [];
  for (const slug of slugs) {
    const oldRow = before.get(slug);
    const newRow = after.get(slug);
    const movement: BoardMovement = {
      slug,
      name: (newRow ?? oldRow)!.name,
      previous_rank: oldRow === undefined ? null : oldRow.rank,
      rank: newRow === undefined ? null : newRow.rank,
      rank_delta: oldRow === undefined || newRow === undefined ? null : oldRow.rank - newRow.rank,
    };
    moves.push(movement);
  }
  moves.sort((a, b) => {
    const aMoved = a.rank_delta === null ? 0 : Math.abs(a.rank_delta);
    const bMoved = b.rank_delta === null ? 0 : Math.abs(b.rank_delta);
    return bMoved - aMoved || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  });
  return moves;
}

/** A breakdown as plain text, one line per multiplier, for logs and run reports. */
export function formatBreakdown(breakdown: ScoreBreakdown): string {
  const lines = [
    `${breakdown.name} (${breakdown.slug}): base $${breakdown.base_value_usd.toLocaleString('en-US')}`,
    `  growth ${breakdown.growth_pct}% -> x${breakdown.growth_multiplier}`,
    `  maturity (${breakdown.age_days === null ? 'age unknown' : `${breakdown.age_days}d`}) -> x${breakdown.maturity_multiplier}`,
    `  breadth -> x${breakdown.breadth_multiplier}, launch -> x${breakdown.launch_multiplier}, confidence -> x${breakdown.confidence_multiplier}`,
    `  implied $${breakdown.implied_value_usd.toLocaleString('en-US')}`,
  ];
  return lines.join('\n');
}

/** One signal's footprint on the board: how many rows it moved, and its strongest row. */
export interface SignalFootprint {
  signal: string;
  rows: number;
  top_slug: string | null;
  top_name: string | null;
  top_multiplier: number | null;
}

export function signalCounts(board: BoardRow[]): SignalFootprint[] {
  const pick = (test: (r: BoardRow) => boolean, key: (r: BoardRow) => number, signal: string): SignalFootprint => {
    const moved = board.filter(test);
    const top = moved[0] ?? null;
    const footprint: SignalFootprint = {
      signal,
      rows: moved.length,
      top_slug: top === null ? null : top.slug,
      top_name: top === null ? null : top.name,
      top_multiplier: top === null ? null : key(top),
    };
    return footprint;
  };
  const footprints: SignalFootprint[] = [
    pick((r) => r.model.breadth_multiplier > 1, (r) => r.model.breadth_multiplier, 'breadth'),
    pick((r) => r.model.launch_multiplier > 1, (r) => r.model.launch_multiplier, 'launch'),
    pick((r) => r.model.confidence_multiplier < 1, (r) => r.model.confidence_multiplier, 'confidence'),
  ];
  return footprints;
}

/** The board's value bands: how many rows sit in each implied-value bracket. */
export interface ValueBand {
  band: string;
  rows: number;
}

export function valueBands(board: BoardRow[]): ValueBand[] {
  const bands: ValueBand[] = [
    { band: 'over $100M', rows: 0 },
    { band: '$10M-$100M', rows: 0 },
    { band: '$1M-$10M', rows: 0 },
    { band: 'under $1M', rows: 0 },
  ];
  for (const row of board) {
    const v = row.implied_value_usd;
    if (v >= 100_000_000) bands[0]!.rows += 1;
    else if (v >= 10_000_000) bands[1]!.rows += 1;
    else if (v >= 1_000_000) bands[2]!.rows += 1;
    else bands[3]!.rows += 1;
  }
  return bands;
}

/** The snapshot in numbers: what went in, before the model scores it. */
export interface SnapshotStats {
  as_of: string; // the snapshot's date, carried through to the board
  protocols: number;
  watchlist: number;
  pre_token: number;
  rankable: number;
  live_token: number;
  chains: number;
}

export function snapshotStats(snapshot: Snapshot): SnapshotStats {
  const chains = new Set<string>();
  for (const p of snapshot.protocols) for (const c of p.chains) chains.add(c);
  const stats: SnapshotStats = {
    as_of: snapshot.as_of, // the snapshot's date, carried through to the board
    protocols: snapshot.protocols.length,
    watchlist: snapshot.watchlist.length,
    pre_token: snapshot.protocols.filter(isPreToken).length,
    rankable: snapshot.protocols.filter(isRankable).length,
    live_token: snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX').length,
    chains: chains.size,
  };
  return stats;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
