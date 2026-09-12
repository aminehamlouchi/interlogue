/**
 * Tool: generate_piece. Step 4 of the spine.
 * Regenerates the piece from the brief and the transcript, runs the citation
 * check, and publishes (saves) only if every quote resolves to a transcript
 * timestamp. Output order: story, pull quotes, per-question answers.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { generatePiece } from "../generate/index.js";
import { errorMessage, refuse, reply } from "../respond.js";
import { loadBrief, loadTranscript, savePiece } from "../store/fileStore.js";
import type { Brief, CitationFailure, Piece } from "../types.js";

const inputSchema = {
  brief_id: z.string().min(1).describe("The brief_id whose transcript should be written up."),
};

export function register(server: McpServer): void {
  server.registerTool(
    "generate_piece",
    {
      title: "Fallback writer: generate the piece deterministically",
      description:
        "Do not call this when you can write: use draft_piece and write the piece yourself. This is the no-host fallback writer for the judge's one-command run; it assembles a mechanical piece from the transcript and publishes it only if the citation check passes.",
      inputSchema,
    },
    async (input) => {
      let brief: Brief;
      try {
        brief = await loadBrief(input.brief_id);
      } catch (e) {
        return refuse(["PIECE NOT GENERATED: no such brief", errorMessage(e), "Next: brief, approve_contact, run_interview, then generate_piece."]);
      }

      const transcript = await loadTranscript(brief.brief_id);
      if (!transcript) {
        return refuse([
          "PIECE NOT GENERATED: no transcript for this brief",
          `Brief ${brief.brief_id} exists but no interview has been recorded for it.`,
          `Next: run_interview with brief_id ${brief.brief_id} (after approve_contact).`,
        ]);
      }

      let piece: Piece;
      try {
        piece = generatePiece(brief, transcript);
      } catch (e) {
        return refuse(["PIECE NOT GENERATED: the writer failed", errorMessage(e), "Nothing was persisted. Next: report this and retry generate_piece."]);
      }

      if (!piece.citation_check.ok) {
        const failures = piece.citation_check.failures.map(
          (f: CitationFailure) =>
            `- ${f.where}: ${f.reason}` +
            (f.turn_index !== undefined ? ` (turn ${f.turn_index}${f.timestamp ? ` @ ${f.timestamp}` : ""})` : "") +
            `\n  quote: "${f.quote}"`,
        );
        return refuse([
          "CITATION CHECK FAILED: piece not published",
          `${piece.citation_check.failures.length} of ${piece.citation_check.checked} quoted spans did not resolve to a transcript turn. Nothing was persisted.`,
          ...failures,
          "A quote without a timestamp is a bug, not a style issue. The piece is regenerated from the transcript; the transcript is never edited.",
          `Next: report this, then generate_piece again with brief_id ${brief.brief_id} once the writer is fixed.`,
        ]);
      }

      try {
        await savePiece(piece);
      } catch (e) {
        return refuse(["PIECE NOT SAVED", errorMessage(e), "Next: report this and retry generate_piece."]);
      }

      const summary = {
        piece_id: piece.piece_id,
        brief_id: piece.brief_id,
        transcript_id: piece.transcript_id,
        writer: piece.writer,
        pull_quotes: piece.pull_quotes.length,
        qa_blocks: piece.qa.length,
        citation_check: { ok: piece.citation_check.ok, checked: piece.citation_check.checked },
      };

      return reply([
        piece.markdown.trimEnd(),
        "",
        "---",
        `PIECE PUBLISHED (draft): ${piece.piece_id}`,
        JSON.stringify(summary, null, 2),
        `Next: check_citations with piece_id ${piece.piece_id}.`,
      ]);
    },
  );
}
