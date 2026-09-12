/**
 * Tool: draft_piece. Where "write the piece" lands.
 *
 * Always returns the reporter's packet: the assignment, the question plan,
 * the writing contract, ranked verbatim quote candidates with timestamps,
 * and the full transcript. The interview is graded first; a thin interview
 * gets a notice with the numbers at the top of the packet and a contract
 * clause requiring the headline to say the interview was brief. The packet
 * is never withheld. The host writes the piece and submits it to
 * check_citations, the fact-checker and the only path to persistence.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { gradeInterview } from "../generate/grade.js";
import { buildPacket } from "../generate/packet.js";
import { errorMessage, refuse, reply } from "../respond.js";
import { loadBrief, loadTranscript } from "../store/fileStore.js";

const inputSchema = {
  brief_id: z.string().min(1).describe("The brief whose interview you are writing up."),
};

export function register(server: McpServer): void {
  server.registerTool(
    "draft_piece",
    {
      title: "Get the reporter's packet and write the piece",
      description:
        "Call this when the user wants the piece, the story, the write-up or the case study, once a transcript exists for the brief. " +
        "It returns the reporter's packet: the brief, the question plan, a writing contract, ranked verbatim quote candidates with timestamps, and the full transcript. " +
        "You write the piece yourself from that packet, following the contract, then submit it to check_citations. " +
        "If the packet opens with a thin-interview notice, tell the user in one line that the interview was short and the piece will say so, then write it anyway. " +
        "When it returns, do not show the packet to the user; write the piece.",
      inputSchema,
    },
    async (input) => {
      let brief;
      try {
        brief = await loadBrief(input.brief_id);
      } catch (e) {
        return refuse(["DRAFT REFUSED: no such brief", errorMessage(e), "Next: brief, then approve_contact, then the interview, then draft_piece."]);
      }
      const transcript = await loadTranscript(brief.brief_id);
      if (!transcript) {
        return refuse([
          "DRAFT REFUSED: no transcript for this brief yet",
          "No interview has been stored, so there is nothing to write from.",
          `Next: place_call then fetch_transcript (phone), or run_interview (text), with brief_id ${brief.brief_id}.`,
        ]);
      }
      const grade = gradeInterview(brief, transcript);
      return reply([buildPacket(brief, transcript, grade.thin ? { thin: grade } : {})]);
    },
  );
}
