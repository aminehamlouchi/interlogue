/**
 * Host-written pieces. The host Claude writes the story and the pull quotes in
 * markdown; this module is the fact-checker. It parses the sections, validates
 * the order, resolves every quoted span against the subject turn at the cited
 * timestamp, enforces the parts of the writing contract that can be enforced
 * mechanically, and only on a clean pass assembles a Piece for persistence.
 */
import type {
  Beat,
  Brief,
  Citation,
  CitationFailure,
  CitationReport,
  CitationResolved,
  Piece,
  PullQuote,
  QABlock,
  StoryParagraph,
  Transcript,
  Turn,
} from "../types.js";
import { newId, normalizeForMatch, nowIso, overlap, tokenize } from "../util.js";
import { normQuote, quoteResolvesInTurn } from "./citations.js";
import { renderFooter, renderQASection } from "./render.js";
import { segmentTranscript } from "./segment.js";
import { gradeInterview, headlineSaysBrief } from "./grade.js";

export const HOST_WRITER = "host-writer/v1";

const QUOTE_SPAN_RE = /[“"]([^“”"]+)[”"]/g;
const TS_MARK_RE = /\((\d{1,2}:\d{2}(?::\d{2})?)\)/g;
const NUMBER_OUTSIDE_RE =
  /\b(\d+(?:[.,]\d+)?|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|percent|dollars?)\b/gi;
const PQ_SECTION_RE = /^##\s+Pull quotes\s*$/i;
const QA_SECTION_RE = /^##\s+Per-question answers/i;

export interface MarkdownCheck {
  ok: boolean;
  report: CitationReport;
  piece?: Piece;
  notes: string[];
}

interface ParsedSpan {
  raw: string;
  start: number;
  end: number;
}

function findSpans(text: string): ParsedSpan[] {
  const out: ParsedSpan[] = [];
  for (const m of text.matchAll(QUOTE_SPAN_RE)) out.push({ raw: m[1], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  return out;
}

function closestTurnHint(span: string, turns: Turn[]): string | undefined {
  const st = tokenize(span);
  let best: Turn | null = null;
  let bestScore = 0;
  for (const t of turns) {
    if (t.speaker !== "subject") continue;
    const score = overlap(st, tokenize(t.text));
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (!best || bestScore < 0.3) return undefined;
  const preview = best.text.length > 140 ? `${best.text.slice(0, 140)}…` : best.text;
  return `closest subject turn is at ${best.timestamp} (turn ${best.index}): "${preview}"`;
}

/** Resolve one quoted span cited to a timestamp. Returns a citation or a failure. */
function resolveSpan(
  raw: string,
  timestamp: string,
  transcript: Transcript,
  where: string,
): { citation?: Citation; failure?: CitationFailure } {
  const candidates = transcript.turns.filter((t) => t.timestamp === timestamp);
  if (candidates.length === 0) {
    return {
      failure: { where, reason: `no transcript turn at ${timestamp}`, quote: raw, timestamp, hint: closestTurnHint(raw, transcript.turns) },
    };
  }
  const subjectTurns = candidates.filter((t) => t.speaker === "subject");
  if (subjectTurns.length === 0) {
    return { failure: { where, reason: `the turn at ${timestamp} is the agent speaking, not the subject`, quote: raw, timestamp, hint: closestTurnHint(raw, transcript.turns) } };
  }
  let lastReason = "quote does not resolve in the cited turn";
  for (const t of subjectTurns) {
    const res = quoteResolvesInTurn(raw, t.text);
    if (res.ok) {
      return {
        citation: {
          quote: raw.trim(),
          turn_index: t.index,
          timestamp: t.timestamp,
          time_in_call_secs: t.time_in_call_secs,
          speaker: "subject",
          ...(res.elided ? { elided: true } : {}),
        },
      };
    }
    lastReason = res.reason ?? lastReason;
  }
  return { failure: { where, reason: lastReason, quote: raw, timestamp, turn_index: subjectTurns[0].index, hint: closestTurnHint(raw, transcript.turns) } };
}

/**
 * Walk a paragraph: every quoted span must be followed by a (MM:SS) marker before
 * the next span; every marker must belong to a span.
 */
function checkParagraph(
  text: string,
  where: string,
  transcript: Transcript,
  failures: CitationFailure[],
  resolved: CitationResolved[],
): { citations: Citation[]; checked: number } {
  const spans = findSpans(text);
  const marks = [...text.matchAll(TS_MARK_RE)].map((m) => ({ ts: m[1], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  const usedMarks = new Set<number>();
  const citations: Citation[] = [];
  let checked = 0;
  spans.forEach((span, i) => {
    checked++;
    const limit = i + 1 < spans.length ? spans[i + 1].start : text.length;
    const mark = marks.find((m) => m.start >= span.end && m.start < limit && !usedMarks.has(m.start));
    if (!mark) {
      failures.push({ where: `${where} span ${i + 1}`, reason: "quoted span has no (MM:SS) timestamp after it", quote: span.raw, hint: closestTurnHint(span.raw, transcript.turns) });
      return;
    }
    usedMarks.add(mark.start);
    const r = resolveSpan(span.raw, mark.ts, transcript, `${where} span ${i + 1}`);
    if (r.failure) failures.push(r.failure);
    if (r.citation) {
      citations.push(r.citation);
      resolved.push({ where: `${where} span ${i + 1}`, quote: r.citation.quote, turn_index: r.citation.turn_index, timestamp: r.citation.timestamp });
    }
  });
  for (const m of marks) {
    if (!usedMarks.has(m.start)) {
      checked++;
      failures.push({ where, reason: "timestamp marker with no quoted span before it", quote: `(${m.ts})`, timestamp: m.ts });
    }
  }
  return { citations, checked };
}

function proseOutsideQuotes(text: string): string {
  return text.replace(QUOTE_SPAN_RE, " ").replace(TS_MARK_RE, " ");
}

export function checkMarkdownPiece(markdown: string, brief: Brief, transcript: Transcript): MarkdownCheck {
  const failures: CitationFailure[] = [];
  const resolved: CitationResolved[] = [];
  const notes: string[] = [];
  let checked = 0;
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");

  // ---- sections and order
  const h1Idx = lines.findIndex((l) => /^#\s+\S/.test(l));
  const pqIdx = lines.findIndex((l) => PQ_SECTION_RE.test(l));
  const qaIdx = lines.findIndex((l) => QA_SECTION_RE.test(l));
  if (h1Idx < 0) failures.push({ where: "structure", reason: "the piece must open with an H1 headline (a line starting with '# ')", quote: "" });
  if (h1Idx > 0 && lines.slice(0, h1Idx).some((l) => l.trim() !== "")) {
    failures.push({ where: "structure", reason: "nothing may come before the headline", quote: lines.slice(0, h1Idx).find((l) => l.trim() !== "") ?? "" });
  }
  if (pqIdx < 0) failures.push({ where: "structure", reason: "missing '## Pull quotes' section after the story", quote: "" });
  if (h1Idx >= 0 && pqIdx >= 0 && pqIdx < h1Idx) failures.push({ where: "structure", reason: "pull quotes must come after the story", quote: "" });
  if (qaIdx >= 0 && pqIdx >= 0 && qaIdx < pqIdx) failures.push({ where: "structure", reason: "per-question answers must come after the pull quotes", quote: "" });
  const storyEnd = pqIdx >= 0 ? pqIdx : lines.length;
  for (let i = h1Idx + 1; i < storyEnd; i++) {
    if (/^##\s/.test(lines[i])) failures.push({ where: "structure", reason: "unexpected section heading inside the story; the story is prose", quote: lines[i] });
  }
  if (failures.length > 0) {
    return { ok: false, report: { ok: false, checked: failures.length, resolved, failures }, notes };
  }

  // ---- headline, dek, byline, paragraphs
  const headline = lines[h1Idx].replace(/^#\s+/, "").trim();
  const storyLines = lines.slice(h1Idx + 1, storyEnd);
  let dek = "";
  let byline = "";
  const blocks: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) blocks.push(current.join(" ").trim());
    current = [];
  };
  for (const l of storyLines) {
    if (l.trim() === "") {
      flush();
      continue;
    }
    current.push(l.trim());
  }
  flush();
  const paragraphsText: string[] = [];
  for (const b of blocks) {
    if (!dek && paragraphsText.length === 0 && /^(\*[^*].*\*|_[^_].*_)$/.test(b)) {
      dek = b.replace(/^[*_]|[*_]$/g, "");
      continue;
    }
    if (!byline && paragraphsText.length === 0 && /^(Reported by|By )/i.test(b)) {
      byline = b;
      continue;
    }
    paragraphsText.push(b);
  }
  if (paragraphsText.length < 3) {
    failures.push({ where: "story", reason: "the story needs at least three prose paragraphs (lede, arc, kicker)", quote: "" });
  }

  const paragraphs: StoryParagraph[] = [];
  const allCitations: Citation[] = [];
  paragraphsText.forEach((text, i) => {
    const where = `story.paragraph[${i + 1}]`;
    if (/^\s*([-*+]|\d+[.)])\s/.test(text) || /^\s*>/.test(text)) {
      failures.push({ where, reason: "the story must be prose, not a list or block quote", quote: text.slice(0, 80) });
    }
    if (/^\s*(Q|A|Question|Answer)\s*:/i.test(text)) failures.push({ where, reason: "the story must not be a Q and A", quote: text.slice(0, 80) });
    const r = checkParagraph(text, where, transcript, failures, resolved);
    checked += r.checked;
    allCitations.push(...r.citations);
    paragraphs.push({ text, citations: r.citations });
  });

  // ---- numbers outside quotes in headline, dek and story prose
  const proseTargets: Array<[string, string]> = [["headline", headline], ...(dek ? [["dek", dek] as [string, string]] : [])];
  paragraphsText.forEach((t, i) => proseTargets.push([`story.paragraph[${i + 1}]`, t]));
  for (const [where, text] of proseTargets) {
    const outside = proseOutsideQuotes(text);
    for (const m of outside.matchAll(NUMBER_OUTSIDE_RE)) {
      checked++;
      failures.push({ where, reason: "a number outside a quote is an uncited claim; put it inside a verbatim quote or drop it", quote: m[0] });
    }
  }

  // ---- repeated frames
  const storyText = paragraphsText.join("\n");
  const askedCount = (storyText.match(/(^|[.!?]\s+)Asked\b/gm) ?? []).length;
  if (askedCount > 1) failures.push({ where: "story", reason: `more than one sentence starts with "Asked" (${askedCount}); vary the frames`, quote: "Asked" });
  const saidColon = (storyText.match(/\bsaid:/g) ?? []).length;
  if (saidColon > 1) failures.push({ where: "story", reason: `"said:" appears ${saidColon} times; at most once per piece`, quote: "said:" });

  // ---- pull quotes
  const pqLines = lines.slice(pqIdx + 1, qaIdx >= 0 ? qaIdx : lines.length).filter((l) => l.trim() !== "");
  const pull_quotes: PullQuote[] = [];
  const qa: QABlock[] = segmentTranscript(transcript, brief);
  const beatOfTurn = (turnIndex: number): Beat | "other" => {
    const b = qa.find((x) => x.answer_turn_indexes.includes(turnIndex));
    return b && b.beat !== "consent" ? b.beat : "other";
  };
  pqLines.forEach((line, i) => {
    const where = `pull_quote[${i + 1}]`;
    if (/^---\s*$/.test(line) || /^Citation check:/i.test(line)) return; // a resubmitted piece may carry the footer
    const body = line.replace(/^\s*(>|[-*+])\s*/, "");
    const spans = findSpans(body);
    const marks = [...body.matchAll(TS_MARK_RE)];
    checked++;
    if (spans.length !== 1 || marks.length !== 1) {
      failures.push({ where, reason: "each pull quote line is one quoted span followed by one (MM:SS)", quote: line.slice(0, 100) });
      return;
    }
    const r = resolveSpan(spans[0].raw, marks[0][1], transcript, where);
    if (r.failure) failures.push(r.failure);
    if (r.citation) {
      pull_quotes.push({ ...r.citation, beat: beatOfTurn(r.citation.turn_index) });
      resolved.push({ where, quote: r.citation.quote, turn_index: r.citation.turn_index, timestamp: r.citation.timestamp });
    }
  });
  if (pull_quotes.length < 3 && !failures.some((f) => f.where.startsWith("pull_quote"))) {
    failures.push({ where: "pull_quotes", reason: `at least three pull quotes are required (found ${pull_quotes.length})`, quote: "" });
  }

  // ---- headline quote must live inside a cited quote somewhere in the piece
  const hq = findSpans(headline);
  for (const span of hq) {
    checked++;
    const needle = normQuote(span.raw).toLowerCase();
    const ok = [...allCitations, ...pull_quotes].some((c) => normQuote(c.quote).toLowerCase().includes(needle));
    if (!ok) failures.push({ where: "headline", reason: "the headline quote must also appear inside a cited quote in the story or the pull quotes", quote: span.raw, hint: closestTurnHint(span.raw, transcript.turns) });
  }

  // A piece from a thin interview must say so in the headline.
  const grade = gradeInterview(brief, transcript);
  if (grade.thin && !headlineSaysBrief(headline)) {
    checked++;
    failures.push({
      where: "headline",
      reason: `this interview graded thin (${grade.reasons.join("; ")}); the headline must say the interview was brief, e.g. end with ": a brief interview"`,
      quote: headline,
    });
  }

  if (qaIdx >= 0) notes.push("A per-question section was submitted; it was replaced by the verbatim view generated from the transcript.");

  const report: CitationReport = { ok: failures.length === 0, checked, resolved, failures };
  if (!report.ok) return { ok: false, report, notes };

  // ---- assemble the published piece: the host's story and pull quotes, then the verbatim per-question view
  const hostPart = lines
    .slice(0, qaIdx >= 0 ? qaIdx : lines.length)
    .join("\n")
    .replace(/\n---\s*\nCitation check:.*$/s, "")
    .trimEnd();
  const suffix = newId("pc").split("_")[1];
  const piece: Piece = {
    piece_id: `${brief.brief_id}_pc_${suffix}`,
    brief_id: brief.brief_id,
    transcript_id: transcript.transcript_id,
    generated_at: nowIso(),
    genre: brief.genre,
    writer: HOST_WRITER,
    story: { headline, dek, byline, paragraphs },
    pull_quotes,
    qa,
    citation_check: report,
    markdown: `${hostPart}\n\n${renderQASection(qa, brief.subject.name)}\n${renderFooter(report)}`,
  };
  return { ok: true, report, piece, notes };
}
