/**
 * Sentence splitting with character offsets, and a deterministic
 * quotability score. Every sentence and every run of sentences is a
 * verbatim substring of its turn, which is what makes citation possible.
 */
import type { Turn } from "../types.js";
import { tokenize } from "../util.js";

export interface Sentence {
  text: string;
  turn_index: number;
  timestamp: string;
  time_in_call_secs: number;
  /** Character offsets into the original turn text. */
  start: number;
  end: number;
  words: number;
  score: number;
}

/** A contiguous run of sentences from one turn, rendered as one verbatim span. */
export interface Span {
  text: string;
  turn_index: number;
  timestamp: string;
  time_in_call_secs: number;
  start: number;
  end: number;
  words: number;
  score: number;
  sentence_count: number;
}

const ABBREV_RE = /\b(Mr|Ms|Mrs|Dr|St|vs|e\.g|i\.e|etc)\.$/i;

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export function splitSentences(turn: Turn): Omit<Sentence, "score">[] {
  const text = turn.text;
  const out: Omit<Sentence, "score">[] = [];
  const re = /[.!?]+(?=\s|$)/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    const chunk = text.slice(start, end);
    if (ABBREV_RE.test(chunk.trim())) continue;
    push(start, end);
    start = end;
  }
  if (start < text.length && text.slice(start).trim()) push(start, text.length);
  return out;

  function push(from: number, to: number): void {
    const raw = text.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    const s = from + lead;
    const e = to - trail;
    if (e <= s) return;
    const t = text.slice(s, e);
    out.push({
      text: t,
      turn_index: turn.index,
      timestamp: turn.timestamp,
      time_in_call_secs: turn.time_in_call_secs,
      start: s,
      end: e,
      words: countWords(t),
    });
  }
}

const NUMBER_RE =
  /\b(\d[\d,.]*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|percent|dollars?|hours?|minutes?|weeks?|months?|years?|half|double|twice)\b/gi;
const FILLER_RE = /^(yeah|yes|sure|honestly|right|okay|ok|no|great|thanks|absolutely|of course)[.,!?]?$/i;
const FIRST_PERSON_RE = /\b(I|we|I'd|we'd|I've|we've|I'm|we're|my|our)\b/;
const WEAK_START_RE = /^(And|So|But|Also|Yeah|Honestly)\b/;

export function scoreQuotability(s: Omit<Sentence, "score">, angleTokens: string[]): number {
  const text = s.text.trim();
  if (FILLER_RE.test(text)) return 0;
  if (s.words < 5) return 0.05;

  let score = 0;
  // Length curve: whole thoughts, not fragments and not paragraphs.
  if (s.words <= 8) score += 0.5;
  else if (s.words <= 11) score += 0.7;
  else if (s.words <= 30) score += 1.0;
  else if (s.words <= 45) score += 0.6;
  else score += 0.2;

  // Angle overlap: how many distinct angle tokens this sentence carries.
  const toks = new Set(tokenize(text));
  let hits = 0;
  for (const a of new Set(angleTokens)) if (toks.has(a)) hits++;
  score += Math.min(1.5, 0.5 * hits);

  // Concrete numbers and units.
  const nums = text.match(NUMBER_RE);
  score += Math.min(1.0, 0.35 * (nums ? nums.length : 0));

  if (FIRST_PERSON_RE.test(text)) score += 0.2;
  if (WEAK_START_RE.test(text)) score -= 0.15;
  return Math.max(0, score);
}

export function scoreSentences(turn: Turn, angleTokens: string[]): Sentence[] {
  return splitSentences(turn).map((s) => ({ ...s, score: scoreQuotability(s, angleTokens) }));
}

/** A run that opens on a dangling pronoun reads as if it were cut mid-thought. */
const DANGLING_START_RE = /^(They|They're|It|It's|That|That's|This|He|She|Those|These|Them)\b/;

function runScore(run: Sentence[], opensTurn: boolean, openingBonus: number): number {
  const max = Math.max(...run.map((s) => s.score));
  const sum = run.reduce((a, s) => a + s.score, 0);
  let score = max + 0.3 * (sum - max) - 0.05 * (run.length - 1);
  if (opensTurn) score += openingBonus;
  if (DANGLING_START_RE.test(run[0].text)) score -= 0.4;
  return score;
}

/**
 * All contiguous runs of 1..maxSentences sentences within maxWords, scored.
 * Text is the verbatim substring from the first sentence start to the last
 * sentence end, so internal spacing is exactly the transcript's.
 */
export function candidateSpans(
  turn: Turn,
  sentences: Sentence[],
  maxSentences = 3,
  maxWords = 45,
  openingBonus = 0.3,
): Span[] {
  const spans: Span[] = [];
  const firstReal = sentences.findIndex((s) => s.score > 0.05);
  for (let i = 0; i < sentences.length; i++) {
    for (let n = 1; n <= maxSentences && i + n <= sentences.length; n++) {
      const run = sentences.slice(i, i + n);
      const words = run.reduce((a, s) => a + s.words, 0);
      if (words > maxWords) break;
      if (run.some((s) => s.score === 0)) continue;
      const first = run[0];
      const last = run[run.length - 1];
      spans.push({
        text: turn.text.slice(first.start, last.end),
        turn_index: turn.index,
        timestamp: turn.timestamp,
        time_in_call_secs: turn.time_in_call_secs,
        start: first.start,
        end: last.end,
        words,
        score: runScore(run, i === firstReal, openingBonus),
        sentence_count: n,
      });
    }
  }
  return spans;
}

function overlaps(a: Span, b: Span): boolean {
  return a.turn_index === b.turn_index && a.start < b.end && b.start < a.end;
}

/** Greedy pick of the k best non-overlapping spans, returned in transcript order. */
export function pickSpans(spans: Span[], k: number, opts: { minWords?: number } = {}): Span[] {
  const minWords = opts.minWords ?? 5;
  const sorted = spans
    .filter((s) => s.words >= minWords)
    .slice()
    .sort((a, b) => b.score - a.score || a.turn_index - b.turn_index || a.start - b.start);
  const chosen: Span[] = [];
  for (const s of sorted) {
    if (chosen.length >= k) break;
    if (chosen.some((c) => overlaps(c, s))) continue;
    chosen.push(s);
  }
  return chosen.sort((a, b) => a.turn_index - b.turn_index || a.start - b.start);
}
