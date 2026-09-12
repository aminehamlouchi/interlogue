/**
 * InterLogue shared types. This file is the contract between the MCP tools,
 * the file store, the generation path and the citation check.
 *
 * Spine: brief -> approve_contact -> run_interview -> generate_piece.
 * Every quote in a piece carries the transcript timestamp it came from.
 */

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

export type Speaker = "agent" | "subject";

/** One utterance. Timestamps are seconds into the call, plus an MM:SS display. */
export interface Turn {
  /** 0-based position in the transcript, assigned on append. */
  index: number;
  speaker: Speaker;
  /** Seconds from the start of the call. Matches the ElevenLabs field name. */
  time_in_call_secs: number;
  /** "MM:SS" derived from time_in_call_secs. This is the cited value. */
  timestamp: string;
  text: string;
}

/** A turn as supplied by a fixture or a caller, before index/timestamp are assigned. */
export interface TurnInput {
  speaker: Speaker;
  time_in_call_secs: number;
  text: string;
}

export type TranscriptSource = "text_fixture" | "text_inline" | "elevenlabs";

export interface ConsentEvidence {
  /** The agent said it is an AI at the top of the call. */
  ai_disclosed: boolean;
  /** The agent asked permission to record at the top of the call. */
  recording_permission_asked: boolean;
  /** The subject agreed. */
  recording_permission_granted: boolean;
  /** Turn indexes that prove the above. */
  evidence_turn_indexes: number[];
}

export interface Transcript {
  transcript_id: string;
  brief_id: string;
  source: TranscriptSource;
  subject_name: string;
  started_at: string; // ISO 8601
  /** Append-only. The store refuses any write that is not a strict extension. */
  turns: Turn[];
  consent: ConsentEvidence;
}

// ---------------------------------------------------------------------------
// Brief and question plan
// ---------------------------------------------------------------------------

export type Genre = "customer_case_study";

/** Story beats of a customer case study, in arc order. */
export type Beat =
  | "context"
  | "problem"
  | "search"
  | "decision"
  | "implementation"
  | "results"
  | "reflection";

export const BEAT_ORDER: readonly Beat[] = [
  "context",
  "problem",
  "search",
  "decision",
  "implementation",
  "results",
  "reflection",
] as const;

export interface PlannedQuestion {
  id: string;
  beat: Beat;
  /** The question the interviewer asks, with placeholders already filled. */
  text: string;
  /** Reporter label used in the story's connective tissue, e.g. "why Ridgeline chose Tallyhook". */
  label: string;
  /** High-priority beats come from the angle. They get follow-ups and lead the emphasis. */
  priority: "high" | "normal";
  follow_up: boolean;
}

export interface Brief {
  brief_id: string;
  created_at: string; // ISO 8601
  genre: Genre;
  subject: {
    name: string;
    phone: string;
    role: string;
    company: string;
  };
  /** Who commissioned the piece and which product the case study is about. */
  client: {
    company: string;
    product: string;
  };
  /** The subject matter of the piece as a noun phrase, e.g. "order entry and fulfillment". */
  topic: string;
  /** The editor's angle. Shapes which questions are asked and what is emphasized. Never what the subject said. */
  angle: string;
  content_needed: string[];
  /** Angle weights per beat, 0..1. Derived from the angle, stored for transparency. */
  emphasis: Record<Beat, number>;
  question_plan: PlannedQuestion[];
}

// ---------------------------------------------------------------------------
// Approval (the only thing that can ever unlock a dial)
// ---------------------------------------------------------------------------

export interface Approval {
  brief_id: string;
  subject_name: string;
  phone: string;
  approved_by: string;
  approved_at: string; // ISO 8601
  /** How the human knows the subject consents, in their own words. */
  consent_basis: string;
  /** The exact statement the approver made. Stored verbatim. */
  statement: string;
}

// ---------------------------------------------------------------------------
// Piece: story first, pull quotes second, per-question answers third
// ---------------------------------------------------------------------------

/** A verbatim quote tied to one subject turn. */
export interface Citation {
  /** Verbatim substring of the cited turn's text (whitespace-normalized). */
  quote: string;
  turn_index: number;
  timestamp: string;
  time_in_call_secs: number;
  speaker: "subject";
}

export interface StoryParagraph {
  /** Prose. Every quoted span inside it appears in `citations`. */
  text: string;
  citations: Citation[];
  beat?: Beat;
}

export interface Story {
  headline: string;
  dek: string;
  byline: string;
  paragraphs: StoryParagraph[];
}

export interface PullQuote extends Citation {
  beat: Beat;
}

export interface QABlock {
  beat: Beat | "consent" | "other";
  question: string;
  question_turn_index: number;
  question_timestamp: string;
  /** The subject's answer, all turns joined, verbatim. */
  answer: string;
  answer_turn_indexes: number[];
  answer_timestamps: string[];
  /** Planned question id this block was matched to, if any. */
  planned_question_id?: string;
}

export interface CitationFailure {
  where: string;
  reason: string;
  quote: string;
  turn_index?: number;
  timestamp?: string;
}

export interface CitationResolved {
  where: string;
  quote: string;
  turn_index: number;
  timestamp: string;
}

export interface CitationReport {
  ok: boolean;
  checked: number;
  resolved: CitationResolved[];
  failures: CitationFailure[];
}

export interface Piece {
  piece_id: string;
  brief_id: string;
  transcript_id: string;
  generated_at: string; // ISO 8601
  genre: Genre;
  /** Which writer produced the prose, e.g. "deterministic-reporter/v1". */
  writer: string;
  story: Story;
  pull_quotes: PullQuote[];
  qa: QABlock[];
  citation_check: CitationReport;
  /** Full rendered document in the mandated order: story, pull quotes, per-question answers. */
  markdown: string;
}

// ---------------------------------------------------------------------------
// Writer interface. The deterministic reporter is the only writer in this
// build. An LLM writer can be added later behind the same citation gate.
// ---------------------------------------------------------------------------

export interface WriterInput {
  brief: Brief;
  transcript: Transcript;
  blocks: QABlock[];
}

export interface WriterOutput {
  story: Story;
  pull_quotes: PullQuote[];
}

export interface Writer {
  name: string;
  write(input: WriterInput): WriterOutput;
}
