/**
 * The deterministic reporter: the only writer in this build.
 *
 * It never invents a claim. Every factual sentence in the story is a
 * verbatim quote from the subject, attributed and timestamped. The
 * connective sentences state only what was asked, who the subject is
 * according to the brief, or facts that are mechanically true of the
 * interview (for example, which answer was the longest).
 *
 * The angle (via brief.emphasis) decides which beat supplies the headline
 * quote and how many quotes each beat carries. It never changes the words.
 *
 * Trade-off, stated plainly: this reads like a quote-led trade report, not
 * magazine prose. An LLM writer can be added later behind the same
 * citation gate by implementing the Writer interface.
 */
import {
  BEAT_ORDER,
  type Beat,
  type Brief,
  type Citation,
  type PullQuote,
  type QABlock,
  type Story,
  type StoryParagraph,
  type Turn,
  type Writer,
  type WriterInput,
  type WriterOutput,
} from "../types.js";
import { lastName, normalizeForMatch, tokenize } from "../util.js";
import { candidateSpans, pickSpans, scoreSentences, type Sentence, type Span } from "./rank.js";

const LQ = "\u201C";
const RQ = "\u201D";

interface BlockMaterial {
  block: QABlock;
  label: string;
  turns: Turn[];
  sentences: Sentence[];
  spans: Span[];
}

interface BeatMaterial {
  beat: Beat;
  blocks: BlockMaterial[];
}

function genericLabel(beat: Beat, brief: Brief): string {
  const product = brief.client.product;
  switch (beat) {
    case "context":
      return `what ${brief.subject.company} does`;
    case "problem":
      return `how things worked before ${product}`;
    case "search":
      return "what set off the search";
    case "decision":
      return `why they chose ${product}`;
    case "implementation":
      return `the first weeks with ${product}`;
    case "results":
      return "what has changed";
    case "reflection":
      return "what they would tell another founder";
  }
}

function labelFor(block: QABlock, brief: Brief): string {
  const planned = block.planned_question_id
    ? brief.question_plan.find((q) => q.id === block.planned_question_id)
    : undefined;
  return planned ? planned.label : genericLabel(block.beat as Beat, brief);
}

function toCitation(span: Span): Citation {
  return {
    quote: span.text,
    turn_index: span.turn_index,
    timestamp: span.timestamp,
    time_in_call_secs: span.time_in_call_secs,
    speaker: "subject",
  };
}

/** For attribution-after frames: a final period becomes a comma inside the quote marks. */
function quoteBeforeAttribution(text: string): string {
  return text.endsWith(".") ? `${text.slice(0, -1)},` : text;
}

function ts(span: Span): string {
  return `(${span.timestamp})`;
}

/** "Asked what the old way cost" but "Asked about the first weeks". */
function askedPhrase(label: string): string {
  return /^(what|why|how|where|when|whether|who)\b/i.test(label) ? `asked ${label}` : `asked about ${label}`;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Rotating reporter frames. Each states only what was asked. */
function frame(i: number, label: string, last: string, span: Span): string {
  const q = span.text;
  const multi = span.sentence_count > 1;
  const asked = askedPhrase(label);
  const Asked = asked[0].toUpperCase() + asked.slice(1);
  const which = ((i % 4) + 4) % 4;
  if (which === 1) {
    return multi
      ? `On ${label}, ${last} said: ${LQ}${q}${RQ} ${ts(span)}`
      : `On ${label}: ${LQ}${quoteBeforeAttribution(q)}${RQ} ${last} said. ${ts(span)}`;
  }
  if (which === 2 && wordCount(label) <= 5) {
    return `${last} put ${label} this way: ${LQ}${q}${RQ} ${ts(span)}`;
  }
  if (which === 3 && !multi) {
    return `${LQ}${quoteBeforeAttribution(q)}${RQ} ${last} said, when ${asked}. ${ts(span)}`;
  }
  return `${Asked}, ${last} said: ${LQ}${q}${RQ} ${ts(span)}`;
}

function overlapsAny(span: Span, chosen: Span[]): boolean {
  return chosen.some((c) => c.turn_index === span.turn_index && c.start < span.end && span.start < c.end);
}

function byTranscriptOrder(a: Span, b: Span): number {
  return a.turn_index - b.turn_index || a.start - b.start;
}

function capitalizeFirst(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

interface HeadlineCandidate {
  text: string;
  score: number;
  /** The whole sentence the clause came from, so the headline can be cited visibly. */
  sentence: Sentence;
}

/**
 * Headline quote: a short whole sentence from the top beat, or a
 * comma-delimited clause of a longer one. Always a verbatim substring.
 */
function pickHeadlineQuote(beat: BeatMaterial, angleTokens: string[]): HeadlineCandidate | null {
  const angle = new Set(angleTokens);
  const candidates: HeadlineCandidate[] = [];
  const consider = (text: string, parent: Sentence) => {
    const parentScore = parent.score;
    const t = text.trim().replace(/[,.!?]$/, "").trim();
    const words = t.split(/\s+/).filter(Boolean).length;
    if (words < 3 || words > 9) return;
    const toks = new Set(tokenize(t));
    let hits = 0;
    for (const a of angle) if (toks.has(a)) hits++;
    const numbers = (t.match(/\b(\d[\d,.]*|hundred|thousand|hours?|minutes?|percent)\b/gi) ?? []).length;
    const lengthBonus = words >= 4 && words <= 8 ? 0.3 : 0.1;
    if (/^(and|so|but|because|which|that)\b/i.test(t)) return;
    candidates.push({ text: t, score: 0.6 * hits + 0.3 * Math.min(2, numbers) + lengthBonus + 0.3 * parentScore, sentence: parent });
  };
  for (const b of beat.blocks) {
    for (const s of b.sentences) {
      if (s.score === 0) continue;
      consider(s.text, s);
      const parts = s.text.split(/,\s+/);
      if (parts.length > 1) for (const p of parts) consider(p, s);
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.text.length - b.text.length);
  return candidates[0] ?? null;
}

export const deterministicReporter: Writer = {
  name: "deterministic-reporter/v1",

  write(input: WriterInput): WriterOutput {
    const { brief, transcript, blocks } = input;
    const last = lastName(brief.subject.name);
    const angleTokens = tokenize(brief.angle);
    const turns = transcript.turns;

    // Material per beat, in arc order.
    const material = new Map<Beat, BeatMaterial>();
    for (const block of blocks) {
      if (block.beat === "consent" || block.beat === "other") continue;
      const beat = block.beat;
      const answerTurns = block.answer_turn_indexes.map((i) => turns[i]).filter(Boolean);
      const sentences = answerTurns.flatMap((t) => scoreSentences(t, angleTokens));
      // The lede wants the subject's direct answer, so the context beat leans harder on how a turn opens.
      const openingBonus = beat === "context" ? 0.7 : 0.3;
      const spans = answerTurns.flatMap((t) =>
        candidateSpans(t, sentences.filter((s) => s.turn_index === t.index), 3, 55, openingBonus),
      );
      const entry = material.get(beat) ?? { beat, blocks: [] };
      entry.blocks.push({ block, label: labelFor(block, brief), turns: answerTurns, sentences, spans });
      material.set(beat, entry);
    }

    // Longest subject answer of the call, by word count: a fact we can state.
    const subjectTurns = turns.filter((t) => t.speaker === "subject");
    const longest = subjectTurns.reduce<Turn | null>((best, t) => {
      const w = t.text.split(/\s+/).length;
      return !best || w > best.text.split(/\s+/).length ? t : best;
    }, null);

    // Headline from the highest-weight beat that has material.
    const beatsWithMaterial = BEAT_ORDER.filter((b) => material.has(b));
    const topBeat =
      beatsWithMaterial
        .slice()
        .sort((a, b) => brief.emphasis[b] - brief.emphasis[a] || BEAT_ORDER.indexOf(a) - BEAT_ORDER.indexOf(b))[0] ??
      null;
    const headlineQuote = topBeat ? pickHeadlineQuote(material.get(topBeat)!, angleTokens) : null;
    const headline = headlineQuote
      ? `${LQ}${capitalizeFirst(headlineQuote.text)}${RQ}: ${brief.subject.company} on ${brief.topic}`
      : `${brief.subject.company} on ${brief.topic}`;

    // The dek is built from brief facts only. The angle is deliberately absent: it shapes
    // emphasis, and printing it here would portray the subject as having spoken to it.
    const dek = `A customer case study with ${brief.subject.name}, ${brief.subject.role} of ${brief.subject.company}, for ${brief.client.company}.`;
    const lastSecs = turns.length ? turns[turns.length - 1].time_in_call_secs : 0;
    const minutes = Math.max(1, Math.round(lastSecs / 60));
    const sourceWords = transcript.source === "elevenlabs" ? "a recorded" : "the text transcript of a";
    const byline = `Reported by InterLogue from ${sourceWords} ${minutes}-minute interview. Every quote links to a timestamp in the transcript.`;

    // Paragraphs, one per beat in arc order.
    const paragraphs: StoryParagraph[] = [];
    let frameIdx = 0;
    let usedLongest = false;
    for (const beat of BEAT_ORDER) {
      const m = material.get(beat);
      if (!m) continue;
      const weight = brief.emphasis[beat] ?? 0;
      const budget = weight >= 0.5 ? 3 : weight > 0 ? 2 : 1;

      // One span from each block first (primary, then follow-up), then fill from the pool.
      const chosen: Span[] = [];
      for (const b of m.blocks) {
        if (chosen.length >= budget) break;
        const best = pickSpans(b.spans.filter((s) => !overlapsAny(s, chosen)), 1);
        if (best[0]) chosen.push(best[0]);
      }
      if (chosen.length < budget) {
        const pool = m.blocks.flatMap((b) => b.spans).filter((s) => !overlapsAny(s, chosen));
        chosen.push(...pickSpans(pool, budget - chosen.length));
      }
      if (chosen.length === 0) continue;
      chosen.sort(byTranscriptOrder);

      const blockOf = (span: Span): BlockMaterial =>
        m.blocks.find((b) => b.block.answer_turn_indexes.includes(span.turn_index)) ?? m.blocks[0];

      const parts: string[] = [];
      if (paragraphs.length === 0) {
        parts.push(`${brief.subject.name} is the ${brief.subject.role} of ${brief.subject.company}.`);
      }
      let longestOpensParagraph = false;
      if (!usedLongest && longest && chosen[0].turn_index === longest.index) {
        const lb = m.blocks.find((b) => b.block.answer_turn_indexes.includes(longest.index));
        if (lb) {
          parts.push(`The question about ${lb.label} drew the longest answer of the call.`);
          usedLongest = true;
          longestOpensParagraph = true;
        }
      }

      chosen.forEach((span, k) => {
        const block = blockOf(span);
        if (k === 0) {
          parts.push(
            longestOpensParagraph
              ? `${last} said: ${LQ}${span.text}${RQ} ${ts(span)}`
              : frame(frameIdx, block.label, last, span),
          );
          return;
        }
        const prev = chosen[k - 1];
        const prevBlock = blockOf(prev);
        if (block !== prevBlock) {
          parts.push(frame(frameIdx + 1, block.label, last, span));
        } else if (span.turn_index === prev.turn_index) {
          // "went on" only when the two spans are literally consecutive in the turn.
          const gap = turns[span.turn_index].text.slice(prev.end, span.start);
          const contiguous = gap.trim() === "";
          if (!contiguous) parts.push(`Later in the same answer: ${LQ}${span.text}${RQ} ${ts(span)}`);
          else parts.push(k === 1 ? `${last} went on: ${LQ}${span.text}${RQ} ${ts(span)}` : `And: ${LQ}${span.text}${RQ} ${ts(span)}`);
        } else {
          parts.push(`${last} continued: ${LQ}${span.text}${RQ} ${ts(span)}`);
        }
      });

      frameIdx++;
      paragraphs.push({ text: parts.join(" "), citations: chosen.map(toCitation), beat });
    }

    // Pull quotes: 5 to 7, ranked by quotability weighted by emphasis, diverse across beats and turns.
    interface Ranked extends Span {
      beat: Beat;
      weighted: number;
    }
    const pool: Ranked[] = [];
    for (const [beat, m] of material) {
      for (const b of m.blocks) {
        for (const t of b.turns) {
          const sents = b.sentences.filter((s) => s.turn_index === t.index);
          for (const sp of candidateSpans(t, sents, 2, 40)) {
            if (sp.words < 6) continue;
            pool.push({ ...sp, beat, weighted: sp.score * (0.5 + (brief.emphasis[beat] ?? 0)) });
          }
        }
      }
    }
    pool.sort((a, b) => b.weighted - a.weighted || byTranscriptOrder(a, b));
    const perBeat = new Map<Beat, number>();
    const perTurn = new Set<number>();
    const picked: Ranked[] = [];
    for (const sp of pool) {
      if (picked.length >= 7) break;
      if ((perBeat.get(sp.beat) ?? 0) >= 2) continue;
      if (perTurn.has(sp.turn_index)) continue;
      if (overlapsAny(sp, picked)) continue;
      picked.push(sp);
      perBeat.set(sp.beat, (perBeat.get(sp.beat) ?? 0) + 1);
      perTurn.add(sp.turn_index);
    }
    // The headline quote must be visibly cited: make sure its source sentence is a pull quote
    // unless a story citation already covers it.
    if (headlineQuote && topBeat) {
      const needle = normalizeForMatch(headlineQuote.text).toLowerCase();
      const src = headlineQuote.sentence;
      const cited: Array<{ turn_index: number; quote: string }> = [
        ...picked.map((sp) => ({ turn_index: sp.turn_index, quote: sp.text })),
        ...paragraphs.flatMap((p) => p.citations),
      ];
      const covered = cited.some(
        (c) => c.turn_index === src.turn_index && normalizeForMatch(c.quote).toLowerCase().includes(needle),
      );
      if (!covered) {
        if (picked.length >= 7) {
          picked.sort((a, b) => a.weighted - b.weighted);
          picked.shift();
        }
        picked.push({
          text: src.text,
          turn_index: src.turn_index,
          timestamp: src.timestamp,
          time_in_call_secs: src.time_in_call_secs,
          start: src.start,
          end: src.end,
          words: src.words,
          score: src.score,
          sentence_count: 1,
          beat: topBeat,
          weighted: Number.POSITIVE_INFINITY,
        });
      }
    }
    picked.sort(byTranscriptOrder);
    const pull_quotes: PullQuote[] = picked.map((sp) => ({ ...toCitation(sp), beat: sp.beat }));

    const story: Story = { headline, dek, byline, paragraphs };
    return { story, pull_quotes };
  },
};
