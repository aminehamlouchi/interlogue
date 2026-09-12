import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { detectConsent } from "../src/consent.js";
import type { Turn, TurnInput } from "../src/types.js";
import { formatTimestamp } from "../src/util.js";

// dist/test/consent.test.js -> package root is two levels up.
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function toTurns(inputs: TurnInput[]): Turn[] {
  return inputs.map((t, index) => ({
    index,
    speaker: t.speaker,
    time_in_call_secs: t.time_in_call_secs,
    timestamp: formatTimestamp(t.time_in_call_secs),
    text: t.text,
  }));
}

test("fixture opening: AI disclosed, recording asked, permission granted", () => {
  const fixture = JSON.parse(
    readFileSync(path.join(PACKAGE_ROOT, "fixtures", "founder-case-study.transcript.json"), "utf8"),
  ) as { turns: TurnInput[] };
  const turns = toTurns(fixture.turns.slice(0, 4));
  const c = detectConsent(turns);
  assert.equal(c.ai_disclosed, true);
  assert.equal(c.recording_permission_asked, true);
  assert.equal(c.recording_permission_granted, true);
  assert.deepEqual(c.evidence_turn_indexes, [0, 1]);
});

test("an opening that never mentions AI is not disclosed", () => {
  const turns = toTurns([
    { speaker: "agent", time_in_call_secs: 0, text: "Hi, this is Sam calling from Tallyhook. Is it okay if I record this call?" },
    { speaker: "subject", time_in_call_secs: 4, text: "Sure, go ahead." },
    { speaker: "agent", time_in_call_secs: 8, text: "Tell me about Ridgeline." },
  ]);
  const c = detectConsent(turns);
  assert.equal(c.ai_disclosed, false);
  assert.equal(c.recording_permission_asked, true);
  assert.equal(c.recording_permission_granted, true);
  assert.deepEqual(c.evidence_turn_indexes, [0, 1]);
});

test("disclosure phrasing variants are recognised", () => {
  for (const text of [
    "I'm an automated interviewer working with Tallyhook. May I record?",
    "This is a virtual assistant, not a person. Okay to record?",
    "Quick note before we start: I am an artificial intelligence. Do you mind if we record?",
  ]) {
    const c = detectConsent(toTurns([{ speaker: "agent", time_in_call_secs: 0, text }]));
    assert.equal(c.ai_disclosed, true, text);
    assert.equal(c.recording_permission_asked, true, text);
  }
});

test("a decline is not a grant, and only the first subject reply after the ask counts", () => {
  const turns = toTurns([
    { speaker: "agent", time_in_call_secs: 0, text: "I am an AI. Is it okay if we record?" },
    { speaker: "subject", time_in_call_secs: 3, text: "No, I would rather not." },
    { speaker: "agent", time_in_call_secs: 6, text: "Understood." },
    { speaker: "subject", time_in_call_secs: 9, text: "Yes, go ahead with the questions." },
  ]);
  const c = detectConsent(turns);
  assert.equal(c.ai_disclosed, true);
  assert.equal(c.recording_permission_asked, true);
  assert.equal(c.recording_permission_granted, false);
  assert.deepEqual(c.evidence_turn_indexes, [0]);
});

test("only the first two agent turns count as the top of the call", () => {
  const turns = toTurns([
    { speaker: "agent", time_in_call_secs: 0, text: "Hi, thanks for taking the call." },
    { speaker: "subject", time_in_call_secs: 3, text: "Sure." },
    { speaker: "agent", time_in_call_secs: 6, text: "Tell me about the company." },
    { speaker: "subject", time_in_call_secs: 9, text: "We sell cheese." },
    { speaker: "agent", time_in_call_secs: 60, text: "By the way, I am an AI. Okay if we record?" },
    { speaker: "subject", time_in_call_secs: 63, text: "Fine." },
  ]);
  const c = detectConsent(turns);
  assert.equal(c.ai_disclosed, false);
  assert.equal(c.recording_permission_asked, false);
  assert.equal(c.recording_permission_granted, false);
});
