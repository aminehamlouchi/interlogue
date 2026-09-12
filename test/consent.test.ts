import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { detectConsent, isExplicitRefusal } from "../src/consent.js";
import type { Turn, TurnInput } from "../src/types.js";
import { formatTimestamp } from "../src/util.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "..", "..", "fixtures", "founder-case-study.transcript.json");

function turns(list: Array<[Turn["speaker"], number, string]>): Turn[] {
  return list.map(([speaker, secs, text], index) => ({ index, speaker, time_in_call_secs: secs, timestamp: formatTimestamp(secs), text }));
}
const OPEN = "Hi, this is an AI interviewer from InterLogue calling for Sam. I record these calls so quotes are accurate. Is it okay if I record?";

/** Every grant phrasing the check accepts. Each must count as a yes. */
export const GRANT_PHRASINGS = [
  "Yes.", "Yeah.", "Yep.", "Sure.", "Okay.", "Ok.", "Fine.", "No problem.", "No problem at all.", "No worries.", "Go ahead.", "Of course.",
  "That's fine.", "That is fine.", "Sounds good.", "Cool.", "Alright.", "All right.", "Absolutely.", "You can.", "Sure, man. Go ahead.",
  "Yeah, it's okay if you record.", "Yes, that's fine. Devon said you'd be calling.", "Not a problem.", "No issue.", "No big deal.",
  "Mm-hmm.", "Uh huh, sure.", "I guess so.", "Whatever you need.", "Yeah go for it.", "Fine by me.", "That works.", "Okay, thank you.",
  "Hello?", "Sure thing.", "Please do.", "Yes you may.", "I don't mind.", "No, that's fine.", "No, go ahead.", "Nope, that's fine.",
  // simply answering the first question counts
  "We're a specialty food wholesaler in Louisville.", "So the company started six years ago out of a van.",
];

/** Explicit refusals. Each must block. */
export const REFUSAL_PHRASINGS = [
  "No.", "Nope.", "No thanks.", "No thank you.", "No, don't record.", "Don't record this.", "Please don't record me.", "Do not record.",
  "I'd rather not.", "I would rather not be recorded.", "I'd prefer not.", "I'm not comfortable being recorded.", "Not okay with that.",
  "No recording, please.", "Can we do this off the record?", "Stop.", "I do not consent.", "I don't consent to recording.",
  "You don't have my permission.", "Please stop recording.", "Let's do it without recording.", "Nah, I'd rather you didn't.",
];

test("every grant phrasing counts as a yes", () => {
  for (const g of GRANT_PHRASINGS) {
    assert.equal(isExplicitRefusal(g), false, `should not be a refusal: ${g}`);
    const c = detectConsent(turns([["agent", 0, OPEN], ["subject", 8, g]]));
    assert.equal(c.recording_permission_granted, true, `grant: ${g}`);
    assert.equal(c.refused, false, `not refused: ${g}`);
    assert.deepEqual(c.evidence_turn_indexes, [0, 1], g);
  }
});

test("every explicit refusal blocks, and only those", () => {
  for (const r of REFUSAL_PHRASINGS) {
    assert.equal(isExplicitRefusal(r), true, `should refuse: ${r}`);
    const c = detectConsent(turns([["agent", 0, OPEN], ["subject", 8, r]]));
    assert.equal(c.refused, true, `refused: ${r}`);
    assert.equal(c.recording_permission_granted, false, r);
  }
});

test("a no inside no problem or no worries is a yes, tested specifically", () => {
  for (const g of ["No problem.", "no problem", "No worries!", "No problem, go ahead.", "Not a problem at all.", "No, that's fine.", "no worries man"]) {
    const c = detectConsent(turns([["agent", 0, OPEN], ["subject", 8, g]]));
    assert.equal(c.refused, false, g);
    assert.equal(c.recording_permission_granted, true, g);
  }
});

test("Ahmad's real opening this hour: \"No problem.\" is a grant", () => {
  const c = detectConsent(
    turns([
      ["agent", 1, "Hi, is this Ahmed Khalifa? This is the InterLogue interviewer. I'm calling about your experience with InterLogue, for a piece their team is putting together. Before we get going, two things: I'm an AI, not a person, and I'd like to record this call so anything we quote is accurate to what you actually said. Is it okay with you if I record?"],
      ["subject", 24, "No problem."],
      ["agent", 26, "Great, thank you Ahmed. To start, can you tell me a little about your background in business development and what you do there?"],
      ["subject", 36, "Yeah. I currently work, I worked as a business development with Excel Business Solutions."],
    ]),
  );
  assert.equal(c.ai_disclosed, true);
  assert.equal(c.recording_permission_asked, true);
  assert.equal(c.recording_permission_granted, true);
  assert.equal(c.refused, false);
  assert.deepEqual(c.evidence_turn_indexes, [0, 1]);
});

test("the window is the opening minute or six turns: a late ask still counts, a gatekeeper does not break it", () => {
  const c = detectConsent(
    turns([
      ["agent", 0, "Hi, is this Marisol? This is the InterLogue..."],
      ["subject", 4, "I'll see if this person is available."],
      ["agent", 6, "No problem at all, I'll hold while you check."],
      ["subject", 13, "Hello?"],
      ["agent", 14, "Hello Marisol. As I mentioned, I am an AI interviewer, and I need your permission to record this conversation. Do you consent to being recorded?"],
      ["subject", 30, "Yeah, sure. No problem."],
    ]),
  );
  assert.equal(c.ai_disclosed, true);
  assert.equal(c.recording_permission_asked, true);
  assert.equal(c.recording_permission_granted, true);
  assert.equal(c.refused, false);
  const late = detectConsent(turns([["agent", 0, "Hi there."], ["subject", 5, "Hi."], ["agent", 10, "How are you?"], ["subject", 15, "Good."], ["agent", 20, "Nice day."], ["subject", 25, "Yes."], ["agent", 58, "By the way, I'm an AI and I'm recording this, is that okay?"], ["subject", 62, "Sure."]]));
  assert.equal(late.ai_disclosed, true, "turn at 58s is inside the first minute");
  assert.equal(late.recording_permission_asked, true);
  assert.equal(late.recording_permission_granted, true);
});

test("missing disclosure or ask is a notice, not a refusal; an explicit no is the only block", () => {
  const noAsk = detectConsent(turns([["agent", 0, "Hi Sam, thanks for taking the call. To start, tell me about the company."], ["subject", 6, "We make chairs."]]));
  assert.equal(noAsk.refused, false);
  assert.equal(noAsk.recording_permission_granted, true, "answering the first question counts");
  assert.match(noAsk.notice ?? "", /not found in the opening/);
  const refused = detectConsent(turns([["agent", 0, OPEN], ["subject", 6, "No, please don't record this."]]));
  assert.equal(refused.refused, true);
  assert.equal(refused.notice, undefined);
});

test("the fixture opening still reads as full consent with no notice", () => {
  const raw = JSON.parse(readFileSync(FIXTURE, "utf8")).turns as TurnInput[];
  const c = detectConsent(raw.map((t, index) => ({ index, ...t, timestamp: formatTimestamp(t.time_in_call_secs) })));
  assert.equal(c.ai_disclosed, true);
  assert.equal(c.recording_permission_asked, true);
  assert.equal(c.recording_permission_granted, true);
  assert.equal(c.refused, false);
  assert.equal(c.notice, undefined);
});
