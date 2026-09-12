/**
 * generatePiece: brief + transcript -> Piece, with the citation check run.
 * Pure: no file IO, no logging. The caller decides whether to persist, and
 * must not persist a piece whose citation_check.ok is false.
 */
import type { Brief, Piece, Transcript, Writer } from "../types.js";
import { newId, nowIso } from "../util.js";
import { checkCitations } from "./citations.js";
import { renderMarkdown } from "./render.js";
import { deterministicReporter } from "./reporter.js";
import { segmentTranscript } from "./segment.js";

export { checkCitations } from "./citations.js";
export { deterministicReporter } from "./reporter.js";
export { segmentTranscript } from "./segment.js";
export { renderMarkdown } from "./render.js";

export function generatePiece(brief: Brief, transcript: Transcript, writer: Writer = deterministicReporter): Piece {
  const blocks = segmentTranscript(transcript, brief);
  const { story, pull_quotes } = writer.write({ brief, transcript, blocks });
  const citation_check = checkCitations({ story, pull_quotes }, transcript);
  const suffix = newId("pc").split("_")[1];
  const base: Omit<Piece, "markdown"> = {
    piece_id: `${brief.brief_id}_pc_${suffix}`,
    brief_id: brief.brief_id,
    transcript_id: transcript.transcript_id,
    generated_at: nowIso(),
    genre: brief.genre,
    writer: writer.name,
    story,
    pull_quotes,
    qa: blocks,
    citation_check,
  };
  return { ...base, markdown: renderMarkdown(base, brief.subject.name) };
}
