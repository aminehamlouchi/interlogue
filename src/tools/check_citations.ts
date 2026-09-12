/**
 * Tool: check_citations. The fact-checker, and the only path by which a
 * host-written piece is persisted.
 *
 * Two modes:
 *  - piece_id: re-run the citation check on a stored piece.
 *  - brief_id + markdown: validate a host-written piece (section order, every
 *    quoted span verbatim from a subject turn at the cited timestamp, no
 *    numbers outside quotes, no repeated frames). On a clean pass the
 *    per-question view is appended verbatim and the piece is persisted.
 *    On a fail, every failing span comes back with the closest turn, and
 *    nothing is persisted.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkCitations } from "../generate/citations.js";
import { checkMarkdownPiece } from "../generate/markdownPiece.js";
import { errorMessage, refuse, reply } from "../respond.js";
import { loadBrief, loadPiece, loadTranscript, savePiece } from "../store/fileStore.js";
import type { CitationFailure, CitationReport } from "../types.js";

const inputSchema = {
  piece_id: z.string().min(1).optional().describe("Re-check a stored piece by id. Give either piece_id, or brief_id plus markdown."),
  brief_id: z.string().min(1).optional().describe("With markdown: the brief whose transcript the piece was written from."),
  markdown: z
    .string()
    .min(1)
    .optional()
    .describe("With brief_id: the host-written piece. H1 headline, prose story, then '## Pull quotes' with one '> “quote” (MM:SS)' per line. The per-question view is appended for you."),
};

function failureLines(failures: CitationFailure[]): string[] {
  return failures.map((f) => {
    const loc = f.timestamp ? ` @ ${f.timestamp}` : "";
    const q = f.quote ? `: “${f.quote.length > 120 ? `${f.quote.slice(0, 120)}…` : f.quote}”` : "";
    return `- ${f.where}${loc}: ${f.reason}${q}${f.hint ? `\n    ${f.hint}` : ""}`;
  });
}

function resolvedLines(report: CitationReport): string[] {
  return report.resolved.map((r) => `- ${r.where} @ ${r.timestamp} (turn ${r.turn_index}): "${r.quote.length > 60 ? `${r.quote.slice(0, 60)}…` : r.quote}"`);
}

export function register(server: McpServer): void {
  server.registerTool(
    "check_citations",
    {
      title: "Fact-check a piece against its transcript",
      description:
        "Call this to publish a piece you have written: pass the brief_id and the whole piece as markdown (headline, story, then a '## Pull quotes' section). It checks that every quoted span is verbatim from the subject at the cited timestamp and that the piece leads with the story. On a pass it stores the piece and returns it with the per-question record appended: show the user the published piece. On a fail it lists each failing span with the closest transcript turn: fix those spans and resubmit without asking the user; nothing is stored until it passes. With piece_id alone it re-checks a stored piece.",
      inputSchema,
    },
    async (input) => {
      const markdownMode = input.markdown !== undefined || input.brief_id !== undefined;
      if ((input.piece_id && markdownMode) || (!input.piece_id && !(input.brief_id && input.markdown))) {
        return refuse([
          "CHECK REFUSED: give either piece_id, or brief_id plus markdown",
          "piece_id re-checks a stored piece. brief_id plus markdown checks and, on a clean pass, publishes a host-written piece.",
        ]);
      }

      if (input.piece_id) {
        let piece;
        try {
          piece = await loadPiece(input.piece_id);
        } catch (e) {
          return refuse(["CHECK REFUSED: no such piece", errorMessage(e)]);
        }
        const transcript = await loadTranscript(piece.brief_id);
        if (!transcript) return refuse(["CHECK REFUSED: the piece's transcript is missing", `brief_id ${piece.brief_id} has no stored transcript.`]);
        if (transcript.transcript_id !== piece.transcript_id) {
          return refuse(["CHECK REFUSED: transcript mismatch", `The piece cites transcript ${piece.transcript_id} but the stored transcript is ${transcript.transcript_id}.`]);
        }
        const report = checkCitations({ story: piece.story, pull_quotes: piece.pull_quotes }, transcript);
        if (!report.ok) {
          return refuse([`CITATION CHECK FAILED: ${report.failures.length} failures across ${report.checked} checks`, `piece_id: ${piece.piece_id}`, ...failureLines(report.failures)]);
        }
        return reply([
          `CITATIONS OK: ${report.resolved.length} of ${report.resolved.length} citations resolve to a subject turn at the cited timestamp (${report.checked} checks, including every quoted span and timestamp in the prose)`,
          `piece_id: ${piece.piece_id} · transcript_id: ${transcript.transcript_id} · brief_id: ${piece.brief_id} · writer: ${piece.writer}`,
          ...resolvedLines(report),
          "",
          "Next: the draft is ready for human review. Nothing public ships without it.",
        ]);
      }

      // ---- markdown mode
      let brief;
      try {
        brief = await loadBrief(input.brief_id!);
      } catch (e) {
        return refuse(["CHECK REFUSED: no such brief", errorMessage(e)]);
      }
      const transcript = await loadTranscript(brief.brief_id);
      if (!transcript) return refuse(["CHECK REFUSED: no transcript for this brief", `Next: run_interview with brief_id ${brief.brief_id}.`]);

      const result = checkMarkdownPiece(input.markdown!, brief, transcript);
      if (!result.ok || !result.piece) {
        return refuse([
          `CITATION CHECK FAILED: ${result.report.failures.length} failures across ${result.report.checked} checks. Nothing was persisted.`,
          "Fix each item below and resubmit the whole piece to check_citations.",
          ...failureLines(result.report.failures),
          ...(result.notes.length ? ["", ...result.notes] : []),
        ]);
      }

      await savePiece(result.piece);
      const r = result.report;
      return reply([
        `CITATIONS OK: ${r.resolved.length} of ${r.resolved.length} quoted spans resolve to a subject turn at the cited timestamp (${r.checked} checks). Piece persisted as a draft.`,
        `piece_id: ${result.piece.piece_id} · transcript_id: ${transcript.transcript_id} · brief_id: ${brief.brief_id} · writer: ${result.piece.writer}`,
        ...resolvedLines(r),
        ...(result.notes.length ? ["", ...result.notes] : []),
        "",
        "PUBLISHED PIECE (draft, with the per-question view appended):",
        "",
        result.piece.markdown,
        "",
        "Next: the draft is ready for human review. Nothing public ships without it.",
      ]);
    },
  );
}
