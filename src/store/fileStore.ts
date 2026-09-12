/**
 * File-backed store for briefs, approvals, transcripts and pieces.
 *
 * Everything lives under DATA_DIR: process.env.INTERLOGUE_DATA_DIR if set,
 * else <package root>/data. Subject records (names, phone numbers,
 * transcripts) never leave this directory, and nothing here logs file
 * contents.
 *
 * Transcripts are append-only. transcripts/<brief_id>.json is rewritten only
 * when the stored turns are a strict prefix of the new turns; anything else
 * is refused with the first differing turn index. A transcript is never
 * overwritten with fewer turns.
 *
 * Ids are restricted to a safe character set so no id can escape DATA_DIR.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Approval, Brief, CallRecord, Piece, Transcript, Turn } from "../types.js";

// This file compiles to dist/src/store/fileStore.js: the package root is three levels up.
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = path.resolve(HERE, "..", "..", "..");

export const DATA_DIR: string = process.env.INTERLOGUE_DATA_DIR
  ? path.resolve(process.env.INTERLOGUE_DATA_DIR)
  : path.join(PACKAGE_ROOT, "data");

type Kind = "briefs" | "approvals" | "transcripts" | "pieces" | "calls";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/** Reject anything that could act as a path: separators, "..", leading dots, odd characters. */
export function assertSafeId(id: unknown, what = "id"): asserts id is string {
  if (typeof id !== "string" || !SAFE_ID.test(id) || id.includes("..")) {
    throw new Error(
      `Invalid ${what}: expected letters, digits, ".", "_" or "-" only, with no path separators and no "..".`,
    );
  }
}

async function kindDir(kind: Kind): Promise<string> {
  const d = path.join(DATA_DIR, kind);
  await fs.mkdir(d, { recursive: true });
  return d;
}

function fileFor(kind: Kind, id: string): string {
  assertSafeId(id);
  const file = path.join(DATA_DIR, kind, `${id}.json`);
  const rel = path.relative(DATA_DIR, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Refusing to touch a path outside the data directory.");
  }
  return file;
}

async function writeJson(kind: Kind, id: string, value: unknown): Promise<void> {
  await kindDir(kind);
  const file = fileFor(kind, id);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

async function readJson<T>(kind: Kind, id: string): Promise<T | null> {
  const file = fileFor(kind, id);
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

export async function saveBrief(brief: Brief): Promise<void> {
  assertSafeId(brief.brief_id, "brief_id");
  await writeJson("briefs", brief.brief_id, brief);
}

/** Throws a clear Error if the brief does not exist. */
export async function loadBrief(briefId: string): Promise<Brief> {
  const brief = await readJson<Brief>("briefs", briefId);
  if (!brief) {
    throw new Error(`No brief with id "${briefId}". Run the brief tool first.`);
  }
  return brief;
}

// ---------------------------------------------------------------------------
// Approvals (one per brief)
// ---------------------------------------------------------------------------

export async function saveApproval(approval: Approval): Promise<void> {
  assertSafeId(approval.brief_id, "brief_id");
  await writeJson("approvals", approval.brief_id, approval);
}

export async function loadApproval(briefId: string): Promise<Approval | null> {
  return readJson<Approval>("approvals", briefId);
}

// ---------------------------------------------------------------------------
// Transcripts (one per brief, append-only)
// ---------------------------------------------------------------------------

function sameTurn(a: Turn, b: Turn): boolean {
  return (
    a.index === b.index &&
    a.speaker === b.speaker &&
    a.time_in_call_secs === b.time_in_call_secs &&
    a.text === b.text
  );
}

/**
 * Index of the first turn where `next` stops being a strict extension of
 * `existing`, or null if it is one. A shorter `next` differs at index
 * next.length (the first stored turn it would drop).
 */
export function firstDifferingTurn(existing: Turn[], next: Turn[]): number | null {
  if (next.length < existing.length) return next.length;
  for (let i = 0; i < existing.length; i++) {
    if (!sameTurn(existing[i], next[i])) return i;
  }
  return null;
}

export async function saveTranscript(transcript: Transcript): Promise<void> {
  assertSafeId(transcript.brief_id, "brief_id");
  assertSafeId(transcript.transcript_id, "transcript_id");
  const existing = await loadTranscript(transcript.brief_id);
  if (existing) {
    if (existing.transcript_id !== transcript.transcript_id) {
      throw new Error(
        `Transcript for brief ${transcript.brief_id} is append-only: a transcript ${existing.transcript_id} already exists and cannot be replaced by ${transcript.transcript_id}.`,
      );
    }
    const diff = firstDifferingTurn(existing.turns, transcript.turns);
    if (diff !== null) {
      throw new Error(
        `Transcript for brief ${transcript.brief_id} is append-only: turn ${diff} differs from the stored transcript ` +
          `(stored ${existing.turns.length} turns, new ${transcript.turns.length}). ` +
          `Only a write whose turns extend the stored turns is accepted; a transcript is never shortened or edited.`,
      );
    }
  }
  await writeJson("transcripts", transcript.brief_id, transcript);
}

export async function loadTranscript(briefId: string): Promise<Transcript | null> {
  return readJson<Transcript>("transcripts", briefId);
}

// ---------------------------------------------------------------------------
// Pieces (many per brief)
// ---------------------------------------------------------------------------

export async function savePiece(piece: Piece): Promise<void> {
  assertSafeId(piece.piece_id, "piece_id");
  assertSafeId(piece.brief_id, "brief_id");
  await writeJson("pieces", piece.piece_id, piece);
}

/** Throws a clear Error if the piece does not exist. */
export async function loadPiece(pieceId: string): Promise<Piece> {
  const piece = await readJson<Piece>("pieces", pieceId);
  if (!piece) {
    throw new Error(`No piece with id "${pieceId}". Run generate_piece first.`);
  }
  return piece;
}

export interface PieceSummary {
  piece_id: string;
  transcript_id: string;
  generated_at: string;
}

/**
 * Pieces for a brief. Piece ids are minted by the generator, so rather than
 * relying on a prefix this scans the pieces directory and matches brief_id.
 */
export async function listPieces(briefId: string): Promise<PieceSummary[]> {
  assertSafeId(briefId, "brief_id");
  const d = await kindDir("pieces");
  const names = await fs.readdir(d);
  const out: PieceSummary[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    if (!SAFE_ID.test(id)) continue;
    const piece = await readJson<Piece>("pieces", id);
    if (piece && piece.brief_id === briefId) {
      out.push({ piece_id: piece.piece_id, transcript_id: piece.transcript_id, generated_at: piece.generated_at });
    }
  }
  out.sort((a, b) => a.generated_at.localeCompare(b.generated_at) || a.piece_id.localeCompare(b.piece_id));
  return out;
}

// ---------------------------------------------------------------------------
// Call records (one per brief, phone path)
// ---------------------------------------------------------------------------

export async function saveCall(record: CallRecord): Promise<void> {
  assertSafeId(record.brief_id, "brief_id");
  await writeJson("calls", record.brief_id, record);
}

export async function loadCall(briefId: string): Promise<CallRecord | null> {
  return readJson<CallRecord>("calls", briefId);
}
