// A working token-radar-01 entry (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores every
// pre-token protocol with the radar-2 model in lib/model.ts, writes the ranked board to
// /output/board.json, and copies this repository's dashboard/ and screenshots/ to /output. The
// dashboard's data is written beside the page as /output/data.js, exactly as the kit's starter lays
// it out: the dossier's text covers dashboard/ only, so the data stays out of the 65,536-byte text cap
// and the judge reads the page's whole source. Last, it writes /output/dossier.json, the summary the
// judge reads, with the vendored make.fun library.
//
// The board is built twice and the two builds must come out byte for byte identical
// (buildDeterministically); what is written is then read back and checked against the board in
// memory (verifyWrittenBoard), so a run that prints a summary has proved its own output. The
// board's farm plans are generated from each protocol's own record (category, chains, TVL, age) by
// lib/model.ts, never from a hand-written list of names, and the dashboard shows board.json's own
// farm_steps verbatim, so the page and the board agree word for word.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_VERSION, boardIssue, buildRadar, categorySummary, chainSummary, dataScript, explainScore, parseSnapshot, signalCounts, snapshotStats, summarizeBoard, valueBands } from './lib/model.ts';
import type { BoardRow, RadarData, Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** The board the model scores, built twice: the two builds must agree byte for byte. */
function buildDeterministically(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const first = buildRadar(snapshot);
  const second = buildRadar(snapshot);
  const firstBoard = JSON.stringify(first.board);
  const secondBoard = JSON.stringify(second.board);
  if (firstBoard !== secondBoard) {
    throw new Error('token radar: the model is not deterministic: two builds of the same snapshot disagree on the board');
  }
  if (dataScript(first.radar) !== dataScript(second.radar)) {
    throw new Error('token radar: the model is not deterministic: two builds of the same snapshot disagree on the dashboard data');
  }
  return first;
}

/** The written board, read back from disk and checked against the board in memory. */
function verifyWrittenBoard(outDir: string, board: BoardRow[], snapshot: Snapshot): void {
  const written = readFileSync(join(outDir, 'board.json'), 'utf8');
  let parsed: unknown;
  try { // the written board must parse back
    parsed = JSON.parse(written);
  } catch (e) {
    throw new Error(`token radar: the written board.json does not parse back as JSON: ${(e as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('token radar: the written board.json is not a JSON object');
  }
  const doc = parsed as { board_size?: unknown; rows?: unknown; model_version?: unknown };
  if (doc.board_size !== board.length) {
    throw new Error(`token radar: the written board carries ${String(doc.board_size)} rows, the build scored ${board.length}`);
  }
  if (doc.model_version !== MODEL_VERSION) {
    throw new Error(`token radar: the written board is stamped ${String(doc.model_version)}, the model is ${MODEL_VERSION}`);
  }
  if (!Array.isArray(doc.rows) || doc.rows.length !== board.length) {
    throw new Error('token radar: the written board has no rows array of the built length');
  }
  for (let i = 0; i < board.length; i++) {
    const want = board[i]!;
    const got = doc.rows[i] as { rank?: unknown; slug?: unknown; implied_value_usd?: unknown };
    if (got.rank !== want.rank || got.slug !== want.slug || got.implied_value_usd !== want.implied_value_usd) {
      throw new Error(`token radar: the written board's row ${i + 1} (${String(got.slug)}) does not match the build`);
    }
  }
  const rereadIssue = boardIssue(doc.rows as BoardRow[], snapshot);
  if (rereadIssue !== null) {
    throw new Error(`token radar: the written board fails the gate on re-read: ${rereadIssue}`);
  }
  const dataText = readFileSync(join(outDir, 'data.js'), 'utf8');
  if (!dataText.startsWith('window.RADAR=')) {
    throw new Error('token radar: the written data.js does not start with window.RADAR=');
  }
  // data.js ends in a semicolon, which is script, not JSON: strip it before parsing.
  const dataJson = JSON.parse(dataText.slice('window.RADAR='.length).replace(/;\s*$/, '')) as { board_size?: unknown; rows?: unknown[] };
  if (dataJson.board_size !== board.length || !Array.isArray(dataJson.rows) || dataJson.rows.length !== board.length) {
    throw new Error('token radar: the written data.js does not carry the built board');
  }
  for (const dashboardFile of ['index.html', 'app.js', 'app.css']) {
    if (!existsSync(join(outDir, 'dashboard', dashboardFile))) {
      throw new Error(`token radar: the written dashboard is missing ${dashboardFile}`);
    }
  }
  const dossierText = readFileSync(join(outDir, 'dossier.json'), 'utf8');
  const dossier = JSON.parse(dossierText) as { schema?: unknown; images?: unknown[] };
  if (dossier.schema !== 'makefun/dossier/v1') {
    throw new Error('token radar: the written dossier.json is not a makefun/dossier/v1 dossier');
  }
  if (!Array.isArray(dossier.images) || dossier.images.length < 3) {
    throw new Error(`token radar: the written dossier names ${Array.isArray(dossier.images) ? dossier.images.length : 0} screenshots, expected at least 3`);
  }
}

/** One run's numbers, printed after every output is written and verified. */
function printRunSummary(snapshot: Snapshot, board: BoardRow[], outDir: string, shots: number): void {
  const stats = snapshotStats(snapshot);
  const summary = summarizeBoard(board);
  const money = (n: number): string => `$${n.toLocaleString('en-US')}`;
  const topCategories = categorySummary(board)
    .slice(0, 3)
    .map((c) => `${c.category} (${c.rows} rows, top ${money(c.top_implied_value_usd)})`)
    .join('; ');
  const topChains = chainSummary(board)
    .slice(0, 3)
    .map((c) => `${c.chain} (${c.rows} rows)`)
    .join('; ');
  const signals = signalCounts(board)
    .map((s) => `${s.signal}: ${s.rows} rows${s.top_name === null ? '' : `, top ${s.top_name} x${s.top_multiplier}`}`)
    .join('; ');
  const bands = valueBands(board)
    .map((b) => `${b.band}: ${b.rows}`)
    .join('; ');
  process.stdout.write(
    `token radar: ${stats.protocols} protocols, ${stats.watchlist} on the watchlist, ${board.length} rows scored (${summary.breadth_bonus_rows} breadth, ${summary.launch_bonus_rows} launch, ${summary.confidence_haircut_rows} confidence haircut)\n` +
      `token radar: snapshot ${stats.as_of}, ${stats.pre_token} pre-token, ${stats.rankable} rankable, ${stats.live_token} live-token set aside, ${stats.chains} chains seen\n` +
      `token radar: median implied ${money(summary.median_implied_value_usd)}, top implied ${money(summary.top_implied_value_usd)}, total implied ${money(summary.total_implied_value_usd)}\n` +
      `token radar: p25 ${money(summary.p25_implied_value_usd)}, p75 ${money(summary.p75_implied_value_usd)}, bottom ${money(summary.bottom_implied_value_usd)}\n` +
      `token radar: top categories: ${topCategories}\n` +
      `token radar: most-covered chains: ${topChains}\n` +
      `token radar: signals: ${signals}\n` +
      `token radar: value bands: ${bands}\n` +
      `token radar: determinism passed (two builds byte-identical), written board verified by re-read\n` +
      `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (3 files), ${join(outDir, 'screenshots')} (${shots} images) and ${join(outDir, 'dossier.json')}\n`,
  );
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));

/** --explain <slug> prints one protocol's whole score and stops: no board is written. */
const explainSlug = arg('explain', '');
if (explainSlug !== '') {
  const protocol = snapshot.protocols.find((p) => p.slug === explainSlug);
  if (protocol === undefined) {
    process.stderr.write(`token radar: no protocol ${explainSlug} in the snapshot\n`);
    process.exit(2);
  }
  const { text } = explainScore(protocol, snapshot.as_of);
  process.stdout.write(`${text}\n`);
  process.exit(0);
}

const { board, radar } = buildDeterministically(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const boardPath = join(out, 'board.json');
writeFileSync(
  boardPath,
  `${JSON.stringify(
    {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      model: MODEL_VERSION,
      model_version: MODEL_VERSION,
      watchlist_size: snapshot.watchlist.length,
      board_size: board.length,
      rows: board,
    },
    null,
    2,
  )}\n`,
);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

verifyWrittenBoard(out, board, snapshot);
printRunSummary(snapshot, board, out, shots.length);
