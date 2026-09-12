/**
 * The citation check. Runs after generation and before anything persists.
 * A quote that does not resolve to a subject turn at the cited timestamp is
 * a bug, and this is where it fails loudly.
 */
import type { Citation, CitationFailure, CitationReport, CitationResolved, PullQuote, Story, Transcript } from "../types.js";
import { normalizeForMatch } from "../util.js";

const QUOTE_SPAN_RE = /[“"]([^“”"]+)[”"]/g;
const TS_RE = /\((\d{1,2}:\d{2}(?::\d{2})?)\)/g;

function stripTrailingPunct(s: string): string {
  return s.replace(/[,.!?]$/, "").trim();
}

/** Normalize a quoted span or a citation quote for comparison. */
export function normQuote(s: string): string {
  return stripTrailingPunct(normalizeForMatch(s));
}

export function checkCitations(input: { story: Story; pull_quotes: PullQuote[] }, transcript: Transcript): CitationReport {
  const turns = transcript.turns;
  const failures: CitationFailure[] = [];
  const resolved: CitationResolved[] = [];
  let checked = 0;

  const checkOne = (c: Citation, where: string): void => {
    checked++;
    const turn = turns[c.turn_index];
    const fail = (reason: string): void => {
      failures.push({ where, reason, quote: c.quote, turn_index: c.turn_index, timestamp: c.timestamp });
    };
    if (!turn || turn.index !== c.turn_index) return fail("no such turn in the transcript");
    if (turn.speaker !== "subject") return fail("cited turn is not the subject speaking");
    if (!normalizeForMatch(turn.text).includes(normalizeForMatch(c.quote))) {
      return fail("quote is not a verbatim substring of the cited turn");
    }
    if (c.timestamp !== turn.timestamp || c.time_in_call_secs !== turn.time_in_call_secs) {
      return fail(`timestamp does not match the cited turn (turn is at ${turn.timestamp})`);
    }
    resolved.push({ where, quote: c.quote, turn_index: c.turn_index, timestamp: c.timestamp });
  };

  input.pull_quotes.forEach((q, i) => checkOne(q, `pull_quote[${i}]`));

  const allCitations: Citation[] = [...input.pull_quotes];
  input.story.paragraphs.forEach((p, i) => {
    p.citations.forEach((c, j) => checkOne(c, `story.paragraph[${i}].citation[${j}]`));
    allCitations.push(...p.citations);
    const citeNorms = p.citations.map((c) => normQuote(c.quote));
    const citeTs = new Set(p.citations.map((c) => c.timestamp));
    for (const m of p.text.matchAll(QUOTE_SPAN_RE)) {
      checked++;
      const span = normQuote(m[1]);
      if (!citeNorms.includes(span)) {
        failures.push({ where: `story.paragraph[${i}].text`, reason: "quoted span has no citation", quote: m[1] });
      }
    }
    for (const m of p.text.matchAll(TS_RE)) {
      if (!citeTs.has(m[1])) {
        failures.push({ where: `story.paragraph[${i}].text`, reason: "timestamp appears without a matching citation", quote: m[0], timestamp: m[1] });
      }
    }
  });

  // Headline quote: must sit inside a citation that appears in the piece (a pull quote or a
  // story citation), so a reader can find its timestamp. Only the first letter may differ in case.
  const hm = [...input.story.headline.matchAll(QUOTE_SPAN_RE)];
  for (const m of hm) {
    checked++;
    const span = normQuote(m[1]).toLowerCase();
    const ok = allCitations.some((c) => normQuote(c.quote).toLowerCase().includes(span));
    if (!ok) {
      failures.push({ where: "story.headline", reason: "headline quote is not inside any cited quote in the piece", quote: m[1] });
    }
  }

  return { ok: failures.length === 0, checked, resolved, failures };
}
