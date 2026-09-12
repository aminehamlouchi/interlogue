/**
 * Tool: check_citations. Step 5 of the spine.
 * Re-runs the citation check on a saved piece against its transcript and
 * reports where every quote resolves.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkCitations } from "../generate/citations.js";
import { errorMessage, refuse, reply } from "../respond.js";
import { loadPiece, loadTranscript } from "../store/fileStore.js";
import type { CitationFailure, CitationResolved, Piece } from "../types.js";

const inputSchema = {
  piece_id: z.string().min(1).describe("The piece_id returned by generate_piece."),
};

function clip(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function register(server: McpServer): void {
  server.registerTool(
    "check_citations",
    {
      title: "Check every quote against the transcript",
      description:
        "Independent check of a saved piece: every quoted span in the story and every pull quote must be a verbatim span of the cited subject turn at the cited timestamp. " +
        "Reports each resolved quote with its timestamp and turn, and lists any failure. Use it before sharing a draft.",
      inputSchema,
    },
    async (input) => {
      let piece: Piece;
      try {
        piece = await loadPiece(input.piece_id);
      } catch (e) {
        return refuse(["CITATION CHECK NOT RUN: no such piece", errorMessage(e), "Next: generate_piece, then check_citations with the returned piece_id."]);
      }

      const transcript = await loadTranscript(piece.brief_id);
      if (!transcript) {
        return refuse([
          "CITATION CHECK NOT RUN: transcript missing",
          `Piece ${piece.piece_id} cites transcript ${piece.transcript_id} for brief ${piece.brief_id}, but no transcript is stored for that brief.`,
          `Next: status with brief_id ${piece.brief_id}.`,
        ]);
      }
      if (transcript.transcript_id !== piece.transcript_id) {
        return refuse([
          "CITATION CHECK NOT RUN: transcript mismatch",
          `Piece ${piece.piece_id} cites transcript ${piece.transcript_id} but the stored transcript for brief ${piece.brief_id} is ${transcript.transcript_id}.`,
          `Next: generate_piece with brief_id ${piece.brief_id} to regenerate from the stored transcript.`,
        ]);
      }

      const report = checkCitations({ story: piece.story, pull_quotes: piece.pull_quotes }, transcript);
      const resolvedLines = report.resolved.map(
        (r: CitationResolved) => `- ${r.where} @ ${r.timestamp} (turn ${r.turn_index}): "${clip(r.quote)}"`,
      );

      if (report.ok) {
        return reply([
          `CITATIONS OK: ${report.resolved.length} of ${report.resolved.length} citations resolve to a subject turn at the cited timestamp (${report.checked} checks, including every quoted span and timestamp in the prose)`,
          `piece_id: ${piece.piece_id} · transcript_id: ${transcript.transcript_id} · brief_id: ${piece.brief_id}`,
          ...resolvedLines,
          "",
          "Next: the draft is ready for human review. Nothing public ships without it.",
        ]);
      }

      const failureLines = report.failures.map(
        (f: CitationFailure) =>
          `- ${f.where}: ${f.reason}` +
          (f.turn_index !== undefined ? ` (turn ${f.turn_index}${f.timestamp ? ` @ ${f.timestamp}` : ""})` : "") +
          `\n  quote: "${clip(f.quote, 120)}"`,
      );
      return refuse([
        `CITATION CHECK FAILED: ${report.failures.length} failures across ${report.checked} checks`,
        `piece_id: ${piece.piece_id} · transcript_id: ${transcript.transcript_id} · brief_id: ${piece.brief_id}`,
        "Failures:",
        ...failureLines,
        report.resolved.length > 0 ? "Resolved:" : null,
        ...resolvedLines,
        "",
        "A quote without a timestamp is a bug. Do not share this draft.",
        `Next: generate_piece with brief_id ${piece.brief_id} to regenerate from the transcript.`,
      ]);
    },
  );
}
