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

const ELLIPSIS_RE = /\s*(?:\u2026|\.\.\.)\s*/;

export interface Resolution {
  ok: boolean;
  reason?: string;
  elided: boolean;
}

/**
 * The one rule for whether a quote resolves in a turn. A plain quote must be a
 * verbatim substring (whitespace and quote marks normalized, one trailing
 * punctuation mark ignored). A quote with a single ellipsis resolves when each
 * fragment is verbatim, at least three words long, and they appear in order.
 */
export function quoteResolvesInTurn(quote: string, turnText: string): Resolution {
  const hay = normalizeForMatch(turnText);
  const q = normQuote(quote);
  if (!q) return { ok: false, reason: "empty quote", elided: false };
  const parts = q.split(ELLIPSIS_RE);
  if (parts.length === 1) {
    return hay.includes(q) ? { ok: true, elided: false } : { ok: false, reason: "quote is not a verbatim substring of the cited turn", elided: false };
  }
  if (parts.length > 2) return { ok: false, reason: "a quote may contain at most one ellipsis", elided: true };
  const [a, b] = parts.map((x) => stripTrailingPunct(x.trim()));
  if (a.split(" ").length < 3 || b.split(" ").length < 3) {
    return { ok: false, reason: "each fragment around an ellipsis must be at least three words", elided: true };
  }
  const ia = hay.indexOf(a);
  if (ia < 0) return { ok: false, reason: "the fragment before the ellipsis is not verbatim in the cited turn", elided: true };
  const ib = hay.indexOf(b, ia + a.length);
  if (ib < 0) return { ok: false, reason: "the fragment after the ellipsis is not verbatim later in the same turn", elided: true };
  return { ok: true, elided: true };
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
    const res = quoteResolvesInTurn(c.quote, turn.text);
    if (!res.ok) return fail(res.reason ?? "quote does not resolve in the cited turn");
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
    const citeNorms = p.citations.map((c) => normQuote(c.quote).replace(ELLIPSIS_RE, " \u2026 "));
    const citeTs = new Set(p.citations.map((c) => c.timestamp));
    for (const m of p.text.matchAll(QUOTE_SPAN_RE)) {
      checked++;
      const span = normQuote(m[1]).replace(ELLIPSIS_RE, " \u2026 ");
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
