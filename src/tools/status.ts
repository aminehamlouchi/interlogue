/**
 * Tool: status. Where a brief is in the spine and what to call next.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorMessage, lastFour, refuse, reply } from "../respond.js";
import { listPieces, loadApproval, loadBrief, loadTranscript } from "../store/fileStore.js";
import type { Brief } from "../types.js";

const inputSchema = {
  brief_id: z.string().min(1).describe("The brief_id to report on."),
};

export function register(server: McpServer): void {
  server.registerTool(
    "status",
    {
      title: "Where is this brief in the spine?",
      description:
        "Call this when the user asks where things stand, or when you are unsure which step comes next for a brief. It reports whether the brief, the approval, the transcript and any pieces exist, and names the next step. When it returns, tell the user in one line where the interview stands and what happens next.",
      inputSchema,
    },
    async (input) => {
      let brief: Brief;
      try {
        brief = await loadBrief(input.brief_id);
      } catch (e) {
        return refuse([`STATUS: no brief ${input.brief_id}`, errorMessage(e), "Next: brief."]);
      }

      const [approval, transcript, pieces] = await Promise.all([
        loadApproval(brief.brief_id),
        loadTranscript(brief.brief_id),
        listPieces(brief.brief_id),
      ]);

      let next: string;
      if (!approval) next = `approve_contact with brief_id ${brief.brief_id} (a human confirms the person and number).`;
      else if (!transcript) next = `run_interview with brief_id ${brief.brief_id} (text-only: fixture or turns).`;
      else if (pieces.length === 0) next = `generate_piece with brief_id ${brief.brief_id}.`;
      else next = `check_citations with piece_id ${pieces[pieces.length - 1].piece_id}, then human review of the draft.`;

      return reply([
        `STATUS: brief ${brief.brief_id}`,
        `Brief: yes · created ${brief.created_at} · subject ${brief.subject.name}, ${brief.subject.company} (phone ${lastFour(brief.subject.phone)}) · client ${brief.client.company} / ${brief.client.product}`,
        `Angle: ${brief.angle}`,
        approval
          ? `Approval: yes · by ${approval.approved_by} at ${approval.approved_at} for ${approval.subject_name} (phone ${lastFour(approval.phone)})`
          : "Approval: NO. Nothing can proceed without a recorded human approval.",
        transcript
          ? `Transcript: yes · ${transcript.transcript_id} · ${transcript.turns.length} turns · source ${transcript.source} · consent: AI disclosed ${transcript.consent.ai_disclosed ? "yes" : "no"}, recording asked ${transcript.consent.recording_permission_asked ? "yes" : "no"}, granted ${transcript.consent.recording_permission_granted ? "yes" : "no"}`
          : "Transcript: none.",
        pieces.length > 0
          ? `Pieces: ${pieces.length} · ${pieces.map((p) => `${p.piece_id} (${p.generated_at})`).join(", ")}`
          : "Pieces: none.",
        "",
        `Next: ${next}`,
      ]);
    },
  );
}
