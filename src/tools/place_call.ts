/**
 * Tool: place_call. The phone path, step 1 of 2.
 *
 * Refuses unless the dial gate finds a recorded human approval for this
 * brief's exact name and number. Then triggers one outbound call through
 * the ElevenLabs native Twilio integration, passing the six dynamic
 * variables built from the brief, and returns at once with the
 * conversation id. fetch_transcript is step 2.
 *
 * Credentials are read from process.env only. Missing ones are reported by
 * NAME. Nothing here logs.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GateError, assertDialApproved, normalizePhone } from "../gate/dialGate.js";
import { ElevenLabsError, getPhoneConfig, placeOutboundCall } from "../phone/elevenlabs.js";
import { buildDynamicVariables } from "../phone/normalize.js";
import { errorMessage, redactPhones, refuse, reply } from "../respond.js";
import { loadBrief, loadCall, saveCall } from "../store/fileStore.js";
import type { CallRecord } from "../types.js";
import { nowIso } from "../util.js";

const inputSchema = {
  brief_id: z.string().min(1).describe("The brief to interview. approve_contact must have recorded approval for its exact name and number."),
  confirm_dial: z.boolean().optional().describe("Optional and ignored; the recorded approval is what allows the call."),
};

export function register(server: McpServer): void {
  server.registerTool(
    "place_call",
    {
      title: "Place the interview call (phone path, step 1 of 2)",
      description:
        "Call this as soon as approve_contact has returned for a brief whose user wants the person phoned; do not ask the user again. It dials the subject through the interviewing agent, which opens by saying it is an AI and asking permission to record, and returns at once with a conversation id. When it returns, tell the user the phone is ringing on the subject's side, then call fetch_transcript immediately and keep calling it until it answers TRANSCRIPT STORED, without asking the user anything in between.",
      inputSchema,
    },
    async (input) => {
      let brief;
      try {
        brief = await loadBrief(input.brief_id);
      } catch (e) {
        return refuse(["CALL REFUSED: no such brief", errorMessage(e), "Next: brief, then approve_contact, then place_call."]);
      }

      // The gate. Same function as the text path; the only unlock for a dial.
      let approval;
      try {
        approval = await assertDialApproved(brief.brief_id);
      } catch (e) {
        if (e instanceof GateError) {
          return refuse([
            "HUMAN-APPROVAL GATE: call refused",
            `Reason: ${e.message}`,
            "No call is placed until a human has recorded approval to contact this specific person at this specific number.",
            `Next: approve_contact with brief_id ${brief.brief_id}, the subject's name and number as on the brief, and confirm: true.`,
          ]);
        }
        throw e;
      }

      const cfg = getPhoneConfig();
      if (!cfg.ok) {
        return refuse([
          "CALL REFUSED: phone path not configured",
          `Missing environment variable(s): ${cfg.missing.join(", ")}.`,
          "Start the server with `node --env-file=.env dist/src/index.js` (or the Claude Desktop entry that does so). Values are never read from the file by this code, only from the environment.",
        ]);
      }

      const existing = await loadCall(brief.brief_id);
      if (existing && existing.status === "placed") {
        return refuse([
          "CALL ALREADY IN PROGRESS for this brief",
          `conversation_id: ${existing.conversation_id} placed at ${existing.placed_at}.`,
          `Next: fetch_transcript with brief_id ${brief.brief_id}. Place a new call only after that one has ended.`,
        ]);
      }
      if (existing && existing.status === "transcript_stored") {
        return refuse([
          "CALL REFUSED: this brief already has a stored transcript from a call",
          `conversation_id ${existing.conversation_id}, transcript ${existing.transcript_id}. Transcripts are append-only and one call per brief is the rule in this build.`,
          "Next: create a new brief for a new interview.",
        ]);
      }

      const dynamicVariables = buildDynamicVariables(brief);
      const toNumber = normalizePhone(brief.subject.phone);
      const placedAt = nowIso();
      let res;
      try {
        res = await placeOutboundCall(cfg.config, { toNumber, dynamicVariables });
      } catch (e) {
        if (e instanceof ElevenLabsError) {
          const blocked = e.status === 401 || e.status === 402 || /quota|credit|balance|payment|unusual_activity/i.test(e.detail);
          return refuse([
            `CALL NOT PLACED: ElevenLabs refused the request (HTTP ${e.status})`,
            `Detail: ${e.detail}`,
            blocked
              ? "This looks like an account, balance or quota block. That is for the account owner to fix; nothing was dialed."
              : "Nothing was dialed. Check the agent id and phone number id, then try again.",
          ]);
        }
        return refuse(["CALL NOT PLACED: request failed before reaching ElevenLabs", redactPhones(errorMessage(e))]);
      }

      if (!res.success || !res.conversation_id) {
        return refuse(["CALL NOT PLACED: ElevenLabs did not start a conversation", `Message: ${redactPhones(String(res.message ?? ""))}`]);
      }

      const record: CallRecord = {
        brief_id: brief.brief_id,
        conversation_id: res.conversation_id,
        call_sid: res.callSid ?? null,
        to_number_last4: brief.subject.phone.replace(/\D/g, "").slice(-4),
        placed_at: placedAt,
        placed_under_approval: { approved_by: approval.approved_by, approved_at: approval.approved_at },
        dynamic_variables: dynamicVariables,
        status: "placed",
      };
      await saveCall(record);

      return reply([
        `CALL PLACED: conversation ${res.conversation_id}`,
        `brief_id: ${brief.brief_id}`,
        `conversation_id: ${res.conversation_id}`,
        `To: ${brief.subject.name}, number ending ${record.to_number_last4}, under approval by ${approval.approved_by} at ${approval.approved_at}.`,
        `Placed at ${placedAt}. Dynamic variables passed: ${Object.keys(dynamicVariables).join(", ")}.`,
        "The agent opens by stating it is an AI and asking permission to record; the transcript is checked for that before anything proceeds.",
        "",
        `Next: fetch_transcript with brief_id ${brief.brief_id} once the call has ended (it waits up to about 50 seconds per call and can be repeated).`,
      ]);
    },
  );
}
