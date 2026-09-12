/**
 * The thin-interview gate. Grades a transcript before a story contract is
 * issued. Thresholds were chosen from four real transcripts on disk on
 * Sep 12 2026: the ten-minute fixture (946 words, 7/7 beats, 30 candidates)
 * and the rehearsal (186, 5/7, 10) pass; a two-and-a-half-minute interview
 * of five non-answers (80, 2/7, 4) and the one-sentence test call
 * (20, 1/7, 1) fail. All three thresholds must be met.
 */
import { BEAT_ORDER, type Beat, type Brief, type Transcript } from "../types.js";
import { quoteCandidates } from "./packet.js";
import { segmentTranscript } from "./segment.js";

export const THRESHOLDS = {
  /** Words the subject said in real answers, fillers and one-liners excluded. */
  substantive_words: 120,
  /** Planned beats that received an answer of at least REAL_ANSWER_WORDS words. */
  beats_answered: 4,
  /** Verbatim quote candidates of at least QUOTE_MIN_WORDS words. */
  quote_candidates: 6,
} as const;

export const REAL_ANSWER_WORDS = 15;
export const QUOTE_MIN_WORDS = 8;

const FILLER_RE =
  /^(yeah|yes|yep|sure|ok|okay|no|nope|hello|hi|hey|bye|bye-bye|thanks|thank you|of course|go ahead|all right|alright|great|sounds good|see you|right|man|uh|um|mm-hmm)[\s.,!?]*$/i;

export interface GradeResult {
  thin: boolean;
  substantive_words: number;
  beats_planned: Beat[];
  beats_answered: Beat[];
  beats_unanswered: Beat[];
  quote_candidates: number;
  subject_turns: number;
  duration: string;
  thresholds: typeof THRESHOLDS;
  /** Human-readable reasons, one per failed threshold. */
  reasons: string[];
}

function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export function gradeInterview(brief: Brief, transcript: Transcript): GradeResult {
  const blocks = segmentTranscript(transcript, brief).filter((b) => b.beat !== "consent");
  let substantive = 0;
  const bestPerBeat = new Map<Beat, number>();
  for (const block of blocks) {
    for (const i of block.answer_turn_indexes) {
      const text = transcript.turns[i]?.text ?? "";
      if (FILLER_RE.test(text.trim()) || words(text) < 4) continue;
      substantive += words(text);
    }
    if (block.beat !== "other" && block.beat !== "consent") {
      const beat: Beat = block.beat;
      const w = words(block.answer);
      bestPerBeat.set(beat, Math.max(bestPerBeat.get(beat) ?? 0, w));
    }
  }
  const beats_planned = BEAT_ORDER.filter((b) => brief.question_plan.some((q) => q.beat === b));
  const beats_answered = beats_planned.filter((b) => (bestPerBeat.get(b) ?? 0) >= REAL_ANSWER_WORDS);
  const beats_unanswered = beats_planned.filter((b) => !beats_answered.includes(b));
  const quote_candidates = quoteCandidates(brief, transcript, 40).filter((c) => words(c.quote) >= QUOTE_MIN_WORDS).length;
  const subjectTurns = transcript.turns.filter((t) => t.speaker === "subject").length;
  const duration = transcript.turns.length ? transcript.turns[transcript.turns.length - 1].timestamp : "00:00";

  const reasons: string[] = [];
  if (substantive < THRESHOLDS.substantive_words) reasons.push(`substantive subject words ${substantive}, minimum ${THRESHOLDS.substantive_words}`);
  if (beats_answered.length < THRESHOLDS.beats_answered) reasons.push(`planned beats with a real answer ${beats_answered.length} of ${beats_planned.length}, minimum ${THRESHOLDS.beats_answered}`);
  if (quote_candidates < THRESHOLDS.quote_candidates) reasons.push(`quote candidates of ${QUOTE_MIN_WORDS}+ words ${quote_candidates}, minimum ${THRESHOLDS.quote_candidates}`);

  return {
    thin: reasons.length > 0,
    substantive_words: substantive,
    beats_planned,
    beats_answered,
    beats_unanswered,
    quote_candidates,
    subject_turns: subjectTurns,
    duration,
    thresholds: THRESHOLDS,
    reasons,
  };
}

/** The headline of a piece from a thin interview must say so. */
export const BRIEF_HEADLINE_RE = /\b(brief|short)\b[^\n]*\b(interview|call|conversation)\b|\b(interview|call|conversation)\b[^\n]*\b(brief|short)\b/i;

export function headlineSaysBrief(headline: string): boolean {
  return BRIEF_HEADLINE_RE.test(headline);
}

/** The lines draft_piece shows when it refuses to issue a story contract. */
export function tooThinLines(brief: Brief, transcript: Transcript, g: GradeResult): string[] {
  return [
    "INTERVIEW TOO THIN for a story. No writing contract issued.",
    `Subject: ${brief.subject.name}, ${brief.subject.company}. Transcript ${transcript.transcript_id}: ${g.duration} long, ${g.subject_turns} subject turns.`,
    `Substantive subject words: ${g.substantive_words} (minimum ${g.thresholds.substantive_words})`,
    `Planned beats with a real answer of ${REAL_ANSWER_WORDS}+ words: ${g.beats_answered.length} of ${g.beats_planned.length} (minimum ${g.thresholds.beats_answered})`,
    `  answered: ${g.beats_answered.join(", ") || "none"}`,
    `  unanswered: ${g.beats_unanswered.join(", ") || "none"}`,
    `Quote candidates of ${QUOTE_MIN_WORDS}+ words: ${g.quote_candidates} (minimum ${g.thresholds.quote_candidates})`,
    "",
    "What this means: there is not enough said here to write a piece that leads with a story. Written up as a case study it would be a per-question record dressed as one, which is the failure this tool exists to prevent.",
    "",
    "Recommended, in this order:",
    `  1. Re-interview. Create a new brief for the same subject and ask the unanswered beats first: ${g.beats_unanswered.join(", ") || "none"}. The transcript on file stays as it is.`,
    "  2. Publish only the per-question record. The transcript is stored with every turn timestamped; it can be shown as the record of the call without a story on top.",
    `  3. If a piece must run anyway, call draft_piece again with allow_thin: true. The contract will then require the headline to say the interview was brief, and check_citations enforces it.`,
  ];
}
