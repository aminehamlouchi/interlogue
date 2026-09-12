/**
 * Tool: draft_piece. The host writer's entry point.
 *
 * Returns a reporter's packet for a brief and its transcript: the assignment,
 * the question plan, the writing contract, ranked verbatim quote candidates
 * with timestamps, and the full transcript. The host Claude writes the piece
 * from it and submits the markdown to check_citations, which is the
 * fact-checker and the only path to persistence.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildPacket } from "../generate/packet.js";
import { errorMessage, refuse, reply } from "../respond.js";
import { loadBrief, loadTranscript } from "../store/fileStore.js";

const inputSchema = {
  brief_id: z.string().min(1).describe("The brief_id whose transcript you are writing from. run_interview must have stored a transcript for it."),
};

export function register(server: McpServer): void {
  server.registerTool(
    "draft_piece",
    {
      title: "Get the reporter's packet to write the piece",
      description:
        "Returns everything needed to write the published piece from the transcript: the brief and angle, the question plan, " +
        "a strict writing contract, ranked verbatim quote candidates each with its timestamp, and the full timestamped transcript. " +
        "You (the host) write the story first, then pull quotes, in markdown, and submit it to check_citations. " +
        "Every quoted span must be verbatim from a subject turn and followed by its (MM:SS). Nothing is published until the check passes.",
      inputSchema,
    },
    async (input) => {
      let brief;
      try {
        brief = await loadBrief(input.brief_id);
      } catch (e) {
        return refuse(["DRAFT REFUSED: no such brief", errorMessage(e), "Next: brief, approve_contact, run_interview, then draft_piece."]);
      }
      const transcript = await loadTranscript(brief.brief_id);
      if (!transcript) {
        return refuse([
          "DRAFT REFUSED: no transcript for this brief",
          "run_interview has not stored a transcript yet, so there is nothing to write from.",
          `Next: run_interview with brief_id ${brief.brief_id}.`,
        ]);
      }
      return reply([buildPacket(brief, transcript)]);
    },
  );
}
