import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkMarkdownPiece } from "../src/generate/markdownPiece.js";
import { buildPacket } from "../src/generate/packet.js";
import { buildQuestionPlan, emphasisFromAngle } from "../src/questionBank.js";
import type { Brief, Transcript, TurnInput } from "../src/types.js";
import { formatTimestamp } from "../src/util.js";

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
    consent: { ai_disclosed: true, recording_permission_asked: true, recording_permission_granted: true, refused: false, evidence_turn_indexes: [0, 1] },
  };
  return { brief, transcript };
}

const GOOD = `# “We got our Mondays back”: a wholesaler stops typing orders by hand
*A customer case study with Marisol Teague, founder of Ridgeline Provisions, for Tallyhook.*
Reported by InterLogue from the text transcript of the interview.

Marisol Teague runs Ridgeline Provisions, and the first thing she described was not software. “Ridgeline Provisions is a specialty food wholesaler. We buy from about forty small producers, mostly within a couple of hours of us, and we sell to restaurants and independent grocers,” Teague said. (00:31)

The old Monday came up early. “I'd sit down at six in the morning with maybe sixty orders across texts, emails and voicemails, and I'd be keying them in until lunch. Six hours, most Mondays, just typing.” (01:52) The cost, in Teague's telling, was not only the hours. “I sat down once and figured we were eating around two thousand dollars a month in wrong-order credits and wasted product.” (02:46)

The numbers now are different. “Monday order entry went from about six hours to about forty minutes,” Teague said. (06:37) The line that stuck: “I stood there for a second and thought, we got our Mondays back.” (07:36)

## Pull quotes

> “Six hours, most Mondays, just typing.” (01:52)
> “Monday order entry went from about six hours to about forty minutes.” (06:37)
> “Don't wait for the disaster.” (08:20)
`;

test("a well-formed host piece passes, persists nothing itself, and gets the per-question view appended", () => {
  const { brief, transcript } = loadFixture();
  const r = checkMarkdownPiece(GOOD, brief, transcript);
  assert.equal(r.ok, true, JSON.stringify(r.report.failures, null, 2));
  assert.ok(r.piece);
  assert.equal(r.piece!.writer, "host-writer/v1");
  assert.equal(r.piece!.pull_quotes.length, 3);
  assert.ok(r.piece!.story.paragraphs.length >= 3);
  const md = r.piece!.markdown;
  assert.ok(md.startsWith("# "));
  assert.ok(md.indexOf("## Pull quotes") < md.indexOf("## Per-question answers"));
  assert.ok(md.includes("Citation check: OK"));
  for (const p of r.piece!.story.paragraphs) for (const c of p.citations) assert.equal(transcript.turns[c.turn_index].speaker, "subject");
});

test("an altered quote fails with the closest turn as a hint", () => {
  const { brief, transcript } = loadFixture();
  const bad = GOOD.replace("Six hours, most Mondays, just typing.” (01:52) The cost", "Six hours, most Mondays, just typing and crying.” (01:52) The cost");
  const r = checkMarkdownPiece(bad, brief, transcript);
  assert.equal(r.ok, false);
  const f = r.report.failures.find((x) => x.quote.includes("crying"));
  assert.ok(f, JSON.stringify(r.report.failures));
  assert.ok(f!.hint?.includes("01:52"), f!.hint);
});

test("a quote with no timestamp, a wrong timestamp, and a number outside a quote each fail", () => {
  const { brief, transcript } = loadFixture();
  const noTs = GOOD.replace("just typing.” (01:52)", "just typing.”");
  assert.ok(checkMarkdownPiece(noTs, brief, transcript).report.failures.some((f) => f.reason.includes("no (MM:SS)")));
  const wrongTs = GOOD.replace("just typing.” (01:52)", "just typing.” (06:37)");
  assert.ok(checkMarkdownPiece(wrongTs, brief, transcript).report.failures.some((f) => f.timestamp === "06:37" && f.reason.includes("verbatim")));
  const number = GOOD.replace("The numbers now are different.", "Order entry now takes forty minutes.");
  assert.ok(checkMarkdownPiece(number, brief, transcript).report.failures.some((f) => f.reason.includes("number outside a quote")));
});

test("wrong section order, bullets in the story, and repeated frames fail", () => {
  const { brief, transcript } = loadFixture();
  const swapped = GOOD.replace("## Pull quotes", "## Per-question answers (secondary view)\n\n## Pull quotes");
  assert.ok(checkMarkdownPiece(swapped, brief, transcript).report.failures.some((f) => f.reason.includes("after the pull quotes")));
  const bullets = GOOD.replace("The old Monday came up early.", "- The old Monday came up early.");
  assert.ok(checkMarkdownPiece(bullets, brief, transcript).report.failures.some((f) => f.reason.includes("prose")));
  const asked = GOOD.replace("The old Monday came up early.", "Asked about Mondays, Teague answered. Asked again, Teague went on.");
  assert.ok(checkMarkdownPiece(asked, brief, transcript).report.failures.some((f) => f.reason.includes("Asked")));
});

test("an elided quote resolves only within one turn and in order", () => {
  const { brief, transcript } = loadFixture();
  const ok = GOOD.replace(
    "“I sat down once and figured we were eating around two thousand dollars a month in wrong-order credits and wasted product.” (02:46)",
    "“The mistakes are what actually hurt … we were eating around two thousand dollars a month in wrong-order credits and wasted product.” (02:46)",
  );
  const r = checkMarkdownPiece(ok, brief, transcript);
  assert.equal(r.ok, true, JSON.stringify(r.report.failures, null, 2));
  const backwards = GOOD.replace(
    "“I sat down once and figured we were eating around two thousand dollars a month in wrong-order credits and wasted product.” (02:46)",
    "“we were eating around two thousand dollars a month … The mistakes are what actually hurt.” (02:46)",
  );
  assert.equal(checkMarkdownPiece(backwards, brief, transcript).ok, false);
});

test("the packet carries the contract, candidates with timestamps, and the full transcript", () => {
  const { brief, transcript } = loadFixture();
  const packet = buildPacket(brief, transcript);
  assert.ok(packet.includes("WRITING CONTRACT"));
  assert.ok(packet.includes("## Quote candidates"));
  assert.ok(/\(\d{2}:\d{2}, turn \d+, \w+\)/.test(packet));
  assert.ok(packet.includes("[00:00] turn 0, agent:"));
  assert.ok(packet.includes(`"brief_id": "${brief.brief_id}"`));
});
