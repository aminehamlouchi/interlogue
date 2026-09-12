/**
 * Tool: draft_piece. The host writer's entry point.
 *
 * Grades the interview first. A thin interview gets INTERVIEW TOO THIN with
 * the numbers, the beats that went unanswered, and what to do, and no story
 * contract. A human can override with allow_thin, in which case the packet's
 * contract requires the headline to say the interview was brief.
 *
 * Otherwise returns the reporter's packet: the assignment, the question
 * plan, the writing contract, ranked verbatim quote candidates with
 * timestamps, and the full transcript. The host writes the piece and submits
 * it to check_citations, the fact-checker and the only path to persistence.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { gradeInterview, tooThinLines } from "../generate/grade.js";
import { buildPacket } from "../generate/packet.js";
import { errorMessage, refuse, reply } from "../respond.js";
import { loadBrief, loadTranscript } from "../store/fileStore.js";

const inputSchema = {
  brief_id: z.string().min(1).describe("The brief_id whose transcript you are writing from. run_interview or fetch_transcript must have stored a transcript for it."),
  allow_thin: z
    .boolean()
    .default(false)
    .describe("A human sets true to get the packet for an interview that graded too thin for a story. The contract then requires the headline to say the interview was brief."),
};

export function register(server: McpServer): void {
  server.registerTool(
    "draft_piece",
    {
      title: "Get the reporter's packet to write the piece",
      description:
        "Grades the stored interview first: if the subject said too little for a story, it answers INTERVIEW TOO THIN with the numbers and what to do, and issues no story contract (a human can pass allow_thin: true to proceed anyway). " +
        "Otherwise returns everything needed to write the published piece from the transcript: the brief and angle, the question plan, a strict writing contract, ranked verbatim quote candidates each with its timestamp, and the full timestamped transcript. " +
        "You (the host) write the story first, then pull quotes, in markdown, and submit it to check_citations. Every quoted span must be verbatim from a subject turn and followed by its (MM:SS). Nothing is published until the check passes.",
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
          "No interview has been stored yet, so there is nothing to write from.",
          `Next: run_interview (text) or place_call then fetch_transcript (phone) with brief_id ${brief.brief_id}.`,
        ]);
      }

      const grade = gradeInterview(brief, transcript);
      if (grade.thin && !input.allow_thin) {
        return refuse(tooThinLines(brief, transcript, grade));
      }
      const packet = buildPacket(brief, transcript, grade.thin ? { thin: grade } : {});
      return reply([packet]);
    },
  );
}
