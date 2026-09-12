import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkCitations, generatePiece } from "../src/generate/index.js";
import { buildQuestionPlan, emphasisFromAngle } from "../src/questionBank.js";
import type { Brief, Transcript, TurnInput } from "../src/types.js";
import { formatTimestamp, normalizeForMatch } from "../src/util.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, "..", "..", "fixtures");

function loadFixture(): { brief: Brief; transcript: Transcript } {
  const b = JSON.parse(readFileSync(path.join(FIXTURES, "founder-case-study.brief.json"), "utf8"));
  const t = JSON.parse(readFileSync(path.join(FIXTURES, "founder-case-study.transcript.json"), "utf8"));
  const core = {
    subject: { name: b.subject_name, phone: b.subject_phone, role: b.subject_role, company: b.subject_company },
    client: { company: b.client_company, product: b.client_product },
    topic: b.topic,
  };
  const emphasis = emphasisFromAngle(b.angle);
  const brief: Brief = {
    brief_id: "brf_test",
    created_at: new Date().toISOString(),
    genre: "customer_case_study",
    ...core,
    angle: b.angle,
    content_needed: b.content_needed,
    emphasis,
    question_plan: buildQuestionPlan(core, emphasis),
  };
  const turns = (t.turns as TurnInput[]).map((x, index) => ({
    index,
    speaker: x.speaker,
    time_in_call_secs: x.time_in_call_secs,
    timestamp: formatTimestamp(x.time_in_call_secs),
    text: x.text,
  }));
  const transcript: Transcript = {
    transcript_id: "trn_test",
    brief_id: "brf_test",
    source: "text_fixture",
    subject_name: b.subject_name,
    started_at: new Date().toISOString(),
    turns,
    consent: { ai_disclosed: true, recording_permission_asked: true, recording_permission_granted: true, evidence_turn_indexes: [0, 1] },
  };
  return { brief, transcript };
}

test("fixture piece passes the citation check and carries 5 to 7 pull quotes", () => {
  const { brief, transcript } = loadFixture();
  const piece = generatePiece(brief, transcript);
  assert.equal(piece.citation_check.ok, true, JSON.stringify(piece.citation_check.failures, null, 2));
  assert.ok(piece.pull_quotes.length >= 5 && piece.pull_quotes.length <= 7, `got ${piece.pull_quotes.length}`);
  assert.ok(piece.story.paragraphs.length >= 5, "story should have an arc of paragraphs");
});

test("markdown leads with the story, then pull quotes, then per-question answers", () => {
  const { brief, transcript } = loadFixture();
  const piece = generatePiece(brief, transcript);
  assert.ok(piece.markdown.startsWith("# "));
  const pq = piece.markdown.indexOf("## Pull quotes");
  const qa = piece.markdown.indexOf("## Per-question answers");
  assert.ok(pq > 0 && qa > pq, "sections out of order");
  const storyPart = piece.markdown.slice(0, pq);
  assert.ok(!/^\s*[-*] /m.test(storyPart), "story must not be bulleted");
  assert.ok(!/^Q:/m.test(storyPart), "story must not be a Q&A list");
});

test("every pull quote is a verbatim substring of its cited subject turn", () => {
  const { brief, transcript } = loadFixture();
  const piece = generatePiece(brief, transcript);
  for (const q of piece.pull_quotes) {
    const turn = transcript.turns[q.turn_index];
    assert.equal(turn.speaker, "subject");
    assert.equal(turn.timestamp, q.timestamp);
    assert.ok(normalizeForMatch(turn.text).includes(normalizeForMatch(q.quote)), q.quote);
  }
});

test("tamper: altering one character of a pull quote fails the check loudly", () => {
  const { brief, transcript } = loadFixture();
  const piece = generatePiece(brief, transcript);
  const q = piece.pull_quotes[0];
  const tampered = { ...q, quote: q.quote.slice(0, 3) + "x" + q.quote.slice(4) };
  const report = checkCitations({ story: piece.story, pull_quotes: [tampered, ...piece.pull_quotes.slice(1)] }, transcript);
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => f.where.startsWith("pull_quote")), JSON.stringify(report.failures));
});

test("tamper: a quoted span in the story with no citation fails the check", () => {
  const { brief, transcript } = loadFixture();
  const piece = generatePiece(brief, transcript);
  const p0 = piece.story.paragraphs[0];
  const story = {
    ...piece.story,
    paragraphs: [{ ...p0, text: p0.text + " \u201Cmade up words here\u201D" }, ...piece.story.paragraphs.slice(1)],
  };
  const report = checkCitations({ story, pull_quotes: piece.pull_quotes }, transcript);
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => f.reason.includes("no citation")), JSON.stringify(report.failures));
});

test("tamper: a wrong timestamp on a story citation fails the check", () => {
  const { brief, transcript } = loadFixture();
  const piece = generatePiece(brief, transcript);
  const p0 = piece.story.paragraphs[0];
  const c0 = { ...p0.citations[0], timestamp: "99:59", time_in_call_secs: 5999 };
  const story = { ...piece.story, paragraphs: [{ ...p0, citations: [c0, ...p0.citations.slice(1)] }, ...piece.story.paragraphs.slice(1)] };
  const report = checkCitations({ story, pull_quotes: piece.pull_quotes }, transcript);
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => f.reason.includes("timestamp")), JSON.stringify(report.failures));
});

test("the angle changes emphasis but not the words", () => {
  const { brief, transcript } = loadFixture();
  const other = "why a founder trusted a new vendor with pricing";
  const emphasis = emphasisFromAngle(other);
  const brief2: Brief = { ...brief, angle: other, emphasis, question_plan: buildQuestionPlan(brief, emphasis) };
  const a = generatePiece(brief, transcript);
  const b = generatePiece(brief2, transcript);
  assert.equal(a.citation_check.ok, true);
  assert.equal(b.citation_check.ok, true);
  assert.notEqual(a.story.headline, b.story.headline, "different angles should surface different headline quotes");
  for (const piece of [a, b]) {
    for (const p of piece.story.paragraphs) {
      for (const c of p.citations) {
        assert.ok(normalizeForMatch(transcript.turns[c.turn_index].text).includes(normalizeForMatch(c.quote)));
      }
    }
  }
});
