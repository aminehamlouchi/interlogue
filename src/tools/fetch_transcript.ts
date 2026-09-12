/**
 * Tool: fetch_transcript. The phone path, step 2 of 2.
 *
 * Polls the ElevenLabs conversation until it is done, normalizes the
 * transcript to one timestamped turn per entry, stores it append-only
 * against the brief, and runs the consent check. If the agent's real
 * opening fails the check, the opening turns are reported verbatim and
 * nothing is stored. Records wall-clock time, call duration and cost.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectConsent } from "../consent.js";
import { ElevenLabsError, TERMINAL_STATUSES, getConversation, getPhoneConfig, type ConversationDetails } from "../phone/elevenlabs.js";
import { normalizeTranscript } from "../phone/normalize.js";
import { errorMessage, redactPhones, refuse, reply } from "../respond.js";
import { loadBrief, loadCall, loadTranscript, saveCall, saveTranscript } from "../store/fileStore.js";
import type { Transcript, Turn } from "../types.js";
import { formatTimestamp, newId, nowIso } from "../util.js";

const inputSchema = {
  brief_id: z.string().min(1).describe("The brief whose call was placed with place_call."),
  wait_secs: z.number().min(0).max(55).default(50).describe("How long to wait for the conversation to finish before returning 'still in progress'. Repeat the call if needed."),
};

const POLL_INTERVAL_MS = 3000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function register(server: McpServer): void {
  server.registerTool(
    "fetch_transcript",
    {
      title: "Fetch the call transcript (phone path, step 2 of 2)",
      description:
        "Waits for the placed call to end, fetches the conversation transcript from ElevenLabs, normalizes it to timestamped turns, " +
        "runs the consent check (AI disclosure, permission to record, the subject's yes), and stores it append-only against the brief. " +
        "Returns 'still in progress' if the call has not ended within wait_secs; call again. Then: draft_piece.",
      inputSchema,
    },
    async (input) => {
      let brief;
      try {
        brief = await loadBrief(input.brief_id);
      } catch (e) {
        return refuse(["FETCH REFUSED: no such brief", errorMessage(e)]);
      }
      const call = await loadCall(brief.brief_id);
      if (!call) return refuse(["FETCH REFUSED: no call has been placed for this brief", `Next: place_call with brief_id ${brief.brief_id}.`]);
      if (call.status === "transcript_stored") {
        return reply([
          "TRANSCRIPT ALREADY STORED for this call",
          `transcript_id: ${call.transcript_id} · conversation_id: ${call.conversation_id}`,
          `Next: draft_piece with brief_id ${brief.brief_id}.`,
        ]);
      }
      const cfg = getPhoneConfig();
      if (!cfg.ok) return refuse(["FETCH REFUSED: phone path not configured", `Missing environment variable(s): ${cfg.missing.join(", ")}.`]);

      // Poll until terminal or the wait budget is spent.
      const deadline = Date.now() + input.wait_secs * 1000;
      let details: ConversationDetails | null = null;
      try {
        for (;;) {
          details = await getConversation(cfg.config, call.conversation_id);
          if (TERMINAL_STATUSES.has(details.status)) break;
          if (Date.now() >= deadline) {
            return reply([
              `CALL STILL IN PROGRESS: status "${details.status}"`,
              `conversation_id: ${call.conversation_id} · placed at ${call.placed_at}`,
              `Next: fetch_transcript again with brief_id ${brief.brief_id} once the call has ended.`,
            ]);
          }
          await sleep(POLL_INTERVAL_MS);
        }
      } catch (e) {
        if (e instanceof ElevenLabsError) return refuse([`FETCH FAILED: ElevenLabs returned HTTP ${e.status}`, `Detail: ${e.detail}`]);
        return refuse(["FETCH FAILED", redactPhones(errorMessage(e))]);
      }

      if (details.status === "failed") {
        await saveCall({ ...call, status: "failed", last_error: "conversation status failed" });
        return refuse(["CALL FAILED on the ElevenLabs side", `conversation_id: ${call.conversation_id}`, "No transcript was stored. Place a new call after checking the number and the agent."]);
      }

      const rawTurns = normalizeTranscript(details);
      if (rawTurns.length === 0) {
        await saveCall({ ...call, status: "failed", last_error: "empty transcript" });
        return refuse(["CALL ENDED WITH AN EMPTY TRANSCRIPT", `conversation_id: ${call.conversation_id}`, "Nothing was stored. The call may not have been answered."]);
      }
      const turns: Turn[] = rawTurns.map((t, index) => ({ index, speaker: t.speaker, time_in_call_secs: t.time_in_call_secs, timestamp: formatTimestamp(t.time_in_call_secs), text: t.text }));

      const consent = detectConsent(turns);
      const opening = turns.slice(0, 4).map((t) => `  [${t.timestamp}] ${t.speaker}: ${t.text}`);
      const meta = details.metadata ?? {};
      const readyAt = nowIso();
      const wallClock = Math.round((Date.parse(readyAt) - Date.parse(call.placed_at)) / 1000);

      if (!consent.ai_disclosed || !consent.recording_permission_asked || !consent.recording_permission_granted) {
        await saveCall({
          ...call,
          status: "consent_failed",
          transcript_ready_at: readyAt,
          wall_clock_secs: wallClock,
          call_duration_secs: meta.call_duration_secs,
          cost_credits: meta.cost ?? null,
          cost_usd: meta.cost_fiat ?? null,
          last_error: "consent check failed on the real opening",
        });
        const yn = (b: boolean) => (b ? "yes" : "NO");
        return refuse([
          "CONSENT CHECK FAILED on the real call: transcript not stored",
          "Rule: the agent states it is an AI and asks permission to record at the top of the call, and the subject says yes.",
          `AI disclosed: ${yn(consent.ai_disclosed)} · permission asked: ${yn(consent.recording_permission_asked)} · permission granted: ${yn(consent.recording_permission_granted)}`,
          "The opening, verbatim:",
          ...opening,
          "Fix the agent's first message (or the check is right and the subject did not consent). The check is not loosened for a real call.",
        ]);
      }

      const existing = await loadTranscript(brief.brief_id);
      const transcript: Transcript = {
        transcript_id: existing ? existing.transcript_id : newId("trn"),
        brief_id: brief.brief_id,
        source: "elevenlabs",
        subject_name: brief.subject.name,
        started_at: meta.start_time_unix_secs ? new Date(meta.start_time_unix_secs * 1000).toISOString() : call.placed_at,
        turns,
        consent,
      };
      try {
        await saveTranscript(transcript);
      } catch (e) {
        return refuse(["TRANSCRIPT IS APPEND-ONLY: write refused", errorMessage(e), "A transcript already stored for this brief differs from the call transcript. Use a new brief per interview."]);
      }
      await saveCall({
        ...call,
        status: "transcript_stored",
        transcript_id: transcript.transcript_id,
        transcript_ready_at: readyAt,
        wall_clock_secs: wallClock,
        call_duration_secs: meta.call_duration_secs,
        cost_credits: meta.cost ?? null,
        cost_usd: meta.cost_fiat ?? null,
      });

      const agentTurns = turns.filter((t) => t.speaker === "agent").length;
      return reply([
        `TRANSCRIPT STORED from the call: ${transcript.transcript_id}`,
        `transcript_id: ${transcript.transcript_id}`,
        `brief_id: ${brief.brief_id} · conversation_id: ${call.conversation_id}`,
        `Turns: ${turns.length} (agent ${agentTurns}, subject ${turns.length - agentTurns}) · call duration: ${meta.call_duration_secs ?? "?"}s · wall clock from dial to transcript: ${wallClock}s`,
        `Cost as reported by ElevenLabs: ${meta.cost ?? "?"} credits${meta.cost_fiat != null ? `, USD ${meta.cost_fiat}` : ""}`,
        `Consent evidence: AI disclosed yes · recording permission asked yes · granted yes · evidence turns [${consent.evidence_turn_indexes.join(", ")}]`,
        "The opening, verbatim:",
        ...opening,
        "",
        `Next: draft_piece with brief_id ${brief.brief_id}.`,
      ]);
    },
  );
}
