import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

// Test data stays inside app/ (data/ is gitignored) so no subject record, even a
// fictional one, is written outside the repo. Removed again when the file finishes.
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
mkdirSync(path.join(PACKAGE_ROOT, "data"), { recursive: true });
const TEST_DATA_DIR = mkdtempSync(path.join(PACKAGE_ROOT, "data", "test-store-"));
process.env.INTERLOGUE_DATA_DIR = TEST_DATA_DIR;
after(() => rmSync(TEST_DATA_DIR, { recursive: true, force: true }));

const store = await import("../src/store/fileStore.js");
const { formatTimestamp } = await import("../src/util.js");
type Transcript = import("../src/types.js").Transcript;
type Turn = import("../src/types.js").Turn;

function turn(index: number, speaker: "agent" | "subject", secs: number, text: string): Turn {
  return { index, speaker, time_in_call_secs: secs, timestamp: formatTimestamp(secs), text };
}

const BASE_TURNS: Turn[] = [
  turn(0, "agent", 0, "I am an AI. Is it okay if we record?"),
  turn(1, "subject", 5, "Yes, that's fine."),
  turn(2, "agent", 10, "Tell me about the company."),
];

function transcript(briefId: string, turns: Turn[], transcriptId = "trn_store_1"): Transcript {
  return {
    transcript_id: transcriptId,
    brief_id: briefId,
    source: "text_inline",
    subject_name: "Marisol Teague",
    started_at: "2026-09-11T00:00:00.000Z",
    turns,
    consent: {
      ai_disclosed: true,
      recording_permission_asked: true,
      recording_permission_granted: true,
      evidence_turn_indexes: [0, 1],
    },
  };
}

test("saveTranscript accepts a strict extension of an existing transcript", async () => {
  await store.saveTranscript(transcript("brf_store_ext", BASE_TURNS));
  const longer = [...BASE_TURNS, turn(3, "subject", 15, "We are a wholesaler.")];
  await store.saveTranscript(transcript("brf_store_ext", longer));
  const loaded = await store.loadTranscript("brf_store_ext");
  assert.ok(loaded);
  assert.equal(loaded.turns.length, 4);
  assert.equal(loaded.turns[3].text, "We are a wholesaler.");
});

test("saveTranscript rejects a shorter transcript and names the first missing turn", async () => {
  await store.saveTranscript(transcript("brf_store_short", BASE_TURNS));
  await assert.rejects(
    store.saveTranscript(transcript("brf_store_short", BASE_TURNS.slice(0, 2))),
    (e: unknown) => {
      const msg = (e as Error).message;
      assert.match(msg, /append-only/);
      assert.match(msg, /turn 2 differs/);
      return true;
    },
  );
  const loaded = await store.loadTranscript("brf_store_short");
  assert.equal(loaded?.turns.length, 3, "stored transcript must be untouched");
});

test("saveTranscript rejects an altered turn and names its index", async () => {
  await store.saveTranscript(transcript("brf_store_alt", BASE_TURNS));
  const altered = BASE_TURNS.map((t) => (t.index === 1 ? { ...t, text: "No, I would rather not." } : t));
  await assert.rejects(store.saveTranscript(transcript("brf_store_alt", altered)), (e: unknown) => {
    const msg = (e as Error).message;
    assert.match(msg, /append-only/);
    assert.match(msg, /turn 1 differs/);
    return true;
  });
  const loaded = await store.loadTranscript("brf_store_alt");
  assert.equal(loaded?.turns[1].text, "Yes, that's fine.", "stored transcript must be untouched");
});

test("saveTranscript rejects a changed timestamp on an existing turn", async () => {
  await store.saveTranscript(transcript("brf_store_ts", BASE_TURNS));
  const altered = BASE_TURNS.map((t) => (t.index === 2 ? turn(2, "agent", 11, t.text) : t));
  await assert.rejects(store.saveTranscript(transcript("brf_store_ts", altered)), /turn 2 differs/);
});

test("saveTranscript rejects replacing a transcript with a different transcript_id", async () => {
  await store.saveTranscript(transcript("brf_store_id", BASE_TURNS, "trn_a"));
  await assert.rejects(store.saveTranscript(transcript("brf_store_id", BASE_TURNS, "trn_b")), /append-only/);
});

test("ids with path separators or dot-dot are rejected everywhere", async () => {
  await assert.rejects(store.loadBrief("../etc/passwd"), /Invalid/);
  await assert.rejects(store.loadTranscript("a/b"), /Invalid/);
  await assert.rejects(store.loadApproval("..\\x"), /Invalid/);
  await assert.rejects(store.loadPiece(".hidden"), /Invalid/);
  await assert.rejects(store.listPieces("a..b"), /Invalid/);
  assert.throws(() => store.assertSafeId(""), /Invalid/);
});

test("loadBrief throws a clear error when missing; loadApproval and loadTranscript return null", async () => {
  await assert.rejects(store.loadBrief("brf_store_nope"), /No brief with id/);
  assert.equal(await store.loadApproval("brf_store_nope"), null);
  assert.equal(await store.loadTranscript("brf_store_nope"), null);
});

test("DATA_DIR honours INTERLOGUE_DATA_DIR", () => {
  assert.equal(store.DATA_DIR, path.resolve(process.env.INTERLOGUE_DATA_DIR!));
});
