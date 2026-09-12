/**
 * The reporter's packet: everything a host writer needs to write the piece
 * from the transcript without inventing anything. Returned by draft_piece.
 */
import { BEAT_ORDER, type Beat, type Brief, type Transcript } from "../types.js";
import { tokenize } from "../util.js";
import { WRITING_CONTRACT } from "./contract.js";
import { candidateSpans, pickSpans, scoreSentences, type Span } from "./rank.js";
import { segmentTranscript } from "./segment.js";

export interface QuoteCandidate {
  quote: string;
  timestamp: string;
  turn_index: number;
  beat: Beat | "other";
  score: number;
}

export function quoteCandidates(brief: Brief, transcript: Transcript, limit = 18): QuoteCandidate[] {
  const blocks = segmentTranscript(transcript, brief);
  const angleTokens = tokenize(brief.angle);
  const pool: Array<Span & { beat: Beat | "other"; weighted: number }> = [];
  for (const block of blocks) {
    if (block.beat === "consent") continue;
    const beat = block.beat;
    const weight = beat === "other" ? 0 : (brief.emphasis[beat] ?? 0);
    for (const i of block.answer_turn_indexes) {
      const turn = transcript.turns[i];
      if (!turn) continue;
      const sentences = scoreSentences(turn, angleTokens);
      for (const sp of candidateSpans(turn, sentences, 2, 40)) {
        if (sp.words < 6) continue;
        pool.push({ ...sp, beat, weighted: sp.score * (0.5 + weight) });
      }
    }
  }
  pool.sort((a, b) => b.weighted - a.weighted);
  const chosen = pickSpans(
    pool.map((p) => ({ ...p, score: p.weighted })),
    limit,
  );
  return chosen
    .map((sp) => {
      const src = pool.find((p) => p.turn_index === sp.turn_index && p.start === sp.start && p.end === sp.end)!;
      return { quote: sp.text, timestamp: sp.timestamp, turn_index: sp.turn_index, beat: src.beat, score: Math.round(src.weighted * 100) / 100 };
    })
    .sort((a, b) => b.score - a.score);
}

export function buildPacket(brief: Brief, transcript: Transcript): string {
  const out: string[] = [];
  const high = BEAT_ORDER.filter((b) => (brief.emphasis[b] ?? 0) >= 0.5);
  out.push(`# Reporter's packet: ${brief.subject.name}, ${brief.subject.role} of ${brief.subject.company}, for ${brief.client.company}`);
  out.push("");
  out.push("## The assignment");
  out.push(`brief_id: ${brief.brief_id}`);
  out.push(`Genre: customer case study`);
  out.push(`Subject: ${brief.subject.name}, ${brief.subject.role}, ${brief.subject.company}`);
  out.push(`Client: ${brief.client.company} (product: ${brief.client.product})`);
  out.push(`Topic: ${brief.topic}`);
  out.push(`Angle (emphasis only, never words): ${brief.angle}`);
  out.push(`Content needed: ${brief.content_needed.join(", ")}`);
  out.push(`Emphasis by beat: ${BEAT_ORDER.map((b) => `${b} ${brief.emphasis[b] ?? 0}`).join(", ")}`);
  out.push(`Lead with: ${high.join(", ") || "problem, results"}`);
  out.push("");
  out.push("## Question plan (what the interviewer set out to ask)");
  for (const q of brief.question_plan) out.push(`- [${q.beat}, ${q.priority}${q.follow_up ? ", follow-up" : ""}] ${q.text}`);
  out.push("");
  out.push("## Writing contract");
  out.push(WRITING_CONTRACT);
  out.push("");
  out.push("## Quote candidates (verbatim, ranked for the angle; each with its timestamp)");
  out.push("Use these or any other verbatim span from a subject turn below. Every quote you use must be followed by its (MM:SS).");
  quoteCandidates(brief, transcript).forEach((c, i) => {
    out.push(`${i + 1}. (${c.timestamp}, turn ${c.turn_index}, ${c.beat}) “${c.quote}”`);
  });
  out.push("");
  out.push("## Full transcript");
  for (const t of transcript.turns) out.push(`[${t.timestamp}] turn ${t.index}, ${t.speaker}: ${t.text}`);
  out.push("");
  out.push("## How to submit");
  out.push(`Call check_citations with { "brief_id": "${brief.brief_id}", "markdown": "<your piece>" }.`);
  out.push("A clean pass appends the per-question view, persists the piece as a draft for human review, and returns its piece_id. A failing check returns every failing span with the closest matching turn so you can fix and resubmit. Nothing persists on a fail.");
  out.push("");
  return out.join("\n");
}
