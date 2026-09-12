import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { detectGenre } from "../src/generate/briefRules.js";
import { THRESHOLDS, gradeInterview, headlineSaysBrief, tooThinLines } from "../src/generate/grade.js";
import { checkMarkdownPiece } from "../src/generate/markdownPiece.js";
import { buildPacket } from "../src/generate/packet.js";
import { buildQuestionPlan, emphasisFromAngle } from "../src/questionBank.js";
import type { Brief, Transcript, TurnInput } from "../src/types.js";
import { formatTimestamp } from "../src/util.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const FIXTURES = path.join(ROOT, "fixtures");
const DATA = process.env.INTERLOGUE_REAL_DATA_DIR ?? path.join(ROOT, "data");

function fixtureCase(): { brief: Brief; transcript: Transcript } {
  const b = JSON.parse(readFileSync(path.join(FIXTURES, "founder-case-study.brief.json"), "utf8"));
  const t = JSON.parse(readFileSync(path.join(FIXTURES, "founder-case-study.transcript.json"), "utf8"));
  const core = {
    subject: { name: b.subject_name, phone: b.subject_phone, role: b.subject_role, company: b.subject_company },
    client: { company: b.client_company, product: b.client_product },
    topic: b.topic,
  };
  const emphasis = emphasisFromAngle(b.angle);
  const brief: Brief = { brief_id: "brf_fixture", created_at: new Date().toISOString(), genre: "customer_case_study", ...core, angle: b.angle, content_needed: b.content_needed, emphasis, question_plan: buildQuestionPlan(core, emphasis) };
  const turns = (t.turns as TurnInput[]).map((x, index) => ({ index, speaker: x.speaker, time_in_call_secs: x.time_in_call_secs, timestamp: formatTimestamp(x.time_in_call_secs), text: x.text }));
  const transcript: Transcript = { transcript_id: "trn_fixture", brief_id: "brf_fixture", source: "text_fixture", subject_name: b.subject_name, started_at: new Date().toISOString(), turns, consent: { ai_disclosed: true, recording_permission_asked: true, recording_permission_granted: true, evidence_turn_indexes: [0, 1] } };
  return { brief, transcript };
}

/** Real transcripts live under data/ (gitignored). Tests on them run where they exist and are skipped elsewhere. */
function realCase(briefId: string): { brief: Brief; transcript: Transcript } | null {
  const bf = path.join(DATA, "briefs", `${briefId}.json`);
  const tf = path.join(DATA, "transcripts", `${briefId}.json`);
  if (!existsSync(bf) || !existsSync(tf)) return null;
  return { brief: JSON.parse(readFileSync(bf, "utf8")), transcript: JSON.parse(readFileSync(tf, "utf8")) };
}

const REAL = {
  rehearsal: "brf_mty2aywq1f8af3", // Sep 12 2026, 4m17s, passes
  thin: "brf_mtye54g0a3f249", // Sep 12 2026, 2m29s of non-answers, fails
  oneSentence: "brf_mty0vwa962566f", // Sep 12 2026, 30s test call, fails
};

test("the ten-minute fixture passes the thin gate by a wide margin", () => {
  const { brief, transcript } = fixtureCase();
  const g = gradeInterview(brief, transcript);
  assert.equal(g.thin, false, g.reasons.join("; "));
  assert.ok(g.substantive_words > 5 * THRESHOLDS.substantive_words);
  assert.equal(g.beats_answered.length, g.beats_planned.length);
});

test("the real rehearsal transcript passes the thin gate", { skip: !realCase(REAL.rehearsal) && "real transcript not on this machine" }, () => {
  const { brief, transcript } = realCase(REAL.rehearsal)!;
  const g = gradeInterview(brief, transcript);
  assert.equal(g.thin, false, g.reasons.join("; "));
  assert.ok(g.substantive_words >= THRESHOLDS.substantive_words);
  assert.ok(g.beats_answered.length >= THRESHOLDS.beats_answered);
  assert.ok(g.quote_candidates >= THRESHOLDS.quote_candidates);
});

test("the real two-and-a-half-minute interview of non-answers fails every threshold", { skip: !realCase(REAL.thin) && "real transcript not on this machine" }, () => {
  const { brief, transcript } = realCase(REAL.thin)!;
  const g = gradeInterview(brief, transcript);
  assert.equal(g.thin, true);
  assert.equal(g.reasons.length, 3, g.reasons.join("; "));
  assert.ok(g.beats_unanswered.length >= 4);
  const lines = tooThinLines(brief, transcript, g);
  assert.ok(lines[0].startsWith("INTERVIEW TOO THIN"));
  assert.ok(lines.some((l) => l.includes("unanswered:")));
  assert.ok(lines.some((l) => l.includes("allow_thin: true")));
});

test("the real one-sentence test call fails the thin gate", { skip: !realCase(REAL.oneSentence) && "real transcript not on this machine" }, () => {
  const { brief, transcript } = realCase(REAL.oneSentence)!;
  assert.equal(gradeInterview(brief, transcript).thin, true);
});

test("with the override, the packet carries the addendum and the checker requires a brief-interview headline", { skip: !realCase(REAL.thin) && "real transcript not on this machine" }, () => {
  const { brief, transcript } = realCase(REAL.thin)!;
  const g = gradeInterview(brief, transcript);
  const packet = buildPacket(brief, transcript, { thin: g });
  assert.ok(packet.includes("## Thin interview notice"));
  assert.ok(packet.includes("CONTRACT ADDENDUM FOR A THIN INTERVIEW"));
  const subj = transcript.turns.find((t) => t.speaker === "subject" && t.text.split(" ").length >= 8)!;
  const quote = subj.text.replace(/[.!?]$/, "");
  const piece = (headline: string) => `# ${headline}\n\nA line of framing. “${quote}” (${subj.timestamp})\n\nSecond paragraph. “${quote}” (${subj.timestamp})\n\nThird paragraph. “${quote}” (${subj.timestamp})\n\n## Pull quotes\n\n> “${quote}” (${subj.timestamp})\n> “${quote}” (${subj.timestamp})\n> “${quote}” (${subj.timestamp})\n`;
  const bad = checkMarkdownPiece(piece("On the record"), brief, transcript);
  assert.ok(bad.report.failures.some((f) => f.where === "headline" && f.reason.includes("graded thin")), JSON.stringify(bad.report.failures));
  const good = checkMarkdownPiece(piece("On the record: a brief interview"), brief, transcript);
  assert.ok(!good.report.failures.some((f) => f.where === "headline" && f.reason.includes("graded thin")), JSON.stringify(good.report.failures));
});

test("headlineSaysBrief accepts the documented forms and rejects a plain headline", () => {
  assert.equal(headlineSaysBrief("“It works”: a brief interview"), true);
  assert.equal(headlineSaysBrief("Notes from a short call with Due Gooder"), true);
  assert.equal(headlineSaysBrief("“It works”: Due Gooder on scheduling"), false);
});

test("a brief whose subject company is the client or the product becomes a founder story, using the morning brief's values", () => {
  const stored = existsSync(path.join(DATA, "briefs", "brf_mtye54g0a3f249.json")) ? JSON.parse(readFileSync(path.join(DATA, "briefs", "brf_mtye54g0a3f249.json"), "utf8")) : null;
  const morning = stored
    ? { subject_company: stored.subject.company, client_company: stored.client.company, client_product: stored.client.product }
    : { subject_company: "Due Gooder", client_company: "Due Gooder", client_product: "Due Gooder" };
  assert.equal(detectGenre(morning), "founder_story");
  assert.equal(detectGenre({ subject_company: "Ridgeline Provisions", client_company: "Tallyhook", client_product: "Tallyhook" }), "customer_case_study");
  assert.equal(detectGenre({ subject_company: "Due Gooder, Inc.", client_company: "due gooder", client_product: "Planner" }), "founder_story");
  assert.equal(detectGenre({ subject_company: "InterLogue", client_company: "Acme", client_product: "InterLogue" }), "founder_story");
});
