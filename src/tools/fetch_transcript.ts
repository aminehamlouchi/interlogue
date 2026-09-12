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
import { detectConsent, looksLikeVoicemail } from "../consent.js";
import { ElevenLabsError, getConversation, getPhoneConfig, type ConversationDetails } from "../phone/elevenlabs.js";
import { waitForConversation } from "../phone/waitForConversation.js";
import { normalizeTranscript } from "../phone/normalize.js";
import { errorMessage, redactPhones, refuse, reply } from "../respond.js";
import { loadBrief, loadCall, loadTranscript, saveCall, saveTranscript } from "../store/fileStore.js";
import type { Transcript, Turn } from "../types.js";
import { formatTimestamp, newId, nowIso } from "../util.js";

/**
 * One call waits up to DEFAULT_WAIT_SECS, well under the host caps reported
 * for Claude Desktop (about four minutes). If a host cancels earlier, the
 * server records how long it waited and caps the next call for that brief
 * below it, so the demo self-corrects instead of tripping twice.
 */
export const DEFAULT_WAIT_SECS = 170;
export const MAX_WAIT_SECS = 200;
const POLL_INTERVAL_MS = 3000;
const HOST_ABORT_MARGIN_SECS = 15;

const inputSchema = {
  brief_id: z.string().min(1).describe("The brief whose call was placed with place_call."),
  wait_secs: z
    .number()
    .min(0)
    .max(MAX_WAIT_SECS)
    .default(DEFAULT_WAIT_SECS)
    .describe(
      `Seconds to wait for the call to end before answering "still in progress". Default ${DEFAULT_WAIT_SECS}. A ten-minute interview needs about four calls at the default. Leave it alone unless you know the host's timeout.`,
    ),
};

export function register(server: McpServer): void {
  server.registerTool(
    "fetch_transcript",
    {
      title: "Fetch the call transcript (phone path, step 2 of 2)",
      description:
        "Call this after place_call, and keep calling it until it answers TRANSCRIPT STORED. Each call waits up to about three minutes for the interview to end, then fetches the transcript and stores it. If it answers STILL IN PROGRESS, wait and call it again immediately; do not ask the user anything and do not report progress every time. When it answers TRANSCRIPT STORED, tell the user the interview is done and how long it ran, then call draft_piece and write the piece. If it answers NO ANSWER, the phone was not picked up: offer to call again.",
      inputSchema,
    },
    async (input, extra) => {
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

      // Bounded wait. If this host cancelled an earlier wait for this brief, stay under that.
      let waitSecs = input.wait_secs;
      let capNote = "";
      if (call.host_abort_after_secs && call.host_abort_after_secs - HOST_ABORT_MARGIN_SECS < waitSecs) {
        waitSecs = Math.max(10, call.host_abort_after_secs - HOST_ABORT_MARGIN_SECS);
        capNote = `Wait capped at ${waitSecs}s because this host cancelled an earlier wait after about ${call.host_abort_after_secs}s.`;
      }
      const progressToken = extra?._meta?.progressToken;
      const waitStarted = Date.now();
      const cfgConfig = cfg.config;
      const signal = extra?.signal;
      let abortHandled = false;
      const onAbort = async (): Promise<void> => {
        if (abortHandled) return;
        abortHandled = true;
        const secs = Math.round((Date.now() - waitStarted) / 1000);
        try {
          const latest = (await loadCall(brief.brief_id)) ?? call;
          if (latest.status === "placed") await saveCall({ ...latest, host_abort_after_secs: secs });
        } catch {
          // best effort; the next call simply uses the default wait
        }
      };
      signal?.addEventListener("abort", () => void onAbort(), { once: true });

      let details: ConversationDetails | null = null;
      let lastStatus: string | null = null;
      let elapsedMs = 0;
      try {
        const r = await waitForConversation({
          getDetails: () => getConversation(cfgConfig, call.conversation_id),
          waitMs: waitSecs * 1000,
          pollMs: POLL_INTERVAL_MS,
          signal,
          onProgress: async (elapsed, total, status) => {
            if (progressToken === undefined || !extra?.sendNotification) return;
            await extra.sendNotification({
              method: "notifications/progress",
              params: { progressToken, progress: Math.round(elapsed / 1000), total: Math.round(total / 1000), message: `call ${status}` },
            });
          },
        });
        details = r.details;
        lastStatus = r.lastStatus;
        elapsedMs = r.elapsedMs;
        if (r.aborted) {
          await onAbort();
          return refuse(["FETCH CANCELLED by the host before the call ended", `Waited ${Math.round(elapsedMs / 1000)}s. The call itself continues. Call fetch_transcript again.`]);
        }
      } catch (e) {
        if (e instanceof ElevenLabsError) return refuse([`FETCH FAILED: ElevenLabs returned HTTP ${e.status}`, `Detail: ${e.detail}`]);
        return refuse(["FETCH FAILED", redactPhones(errorMessage(e))]);
      }
      if (!details) {
        const sinceDial = Math.round((Date.now() - Date.parse(call.placed_at)) / 1000);
        return reply([
          `STILL IN PROGRESS: the interview is ${lastStatus ?? "running"}, ${sinceDial}s since the dial. Wait and call fetch_transcript again now. Do not ask the user anything; do not narrate each check.`,
          `This call waited ${Math.round(elapsedMs / 1000)}s. Each call waits up to ${waitSecs}s; a ten-minute interview takes about four calls.`,
          `conversation_id: ${call.conversation_id}, placed at ${call.placed_at}`,
          capNote,
          "",
          `Next: fetch_transcript with brief_id ${brief.brief_id}, repeated until it answers TRANSCRIPT STORED.`,
        ]);
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
      if (looksLikeVoicemail(turns)) {
        await saveCall({ ...call, status: "failed", last_error: "reached voicemail", call_duration_secs: meta.call_duration_secs, cost_credits: meta.cost ?? null, cost_usd: meta.cost_fiat ?? null });
        return refuse([
          "NO ANSWER: the call reached voicemail, not the person. Nothing was stored.",
          `conversation_id: ${call.conversation_id}`,
          "Tell the user the subject did not pick up, and offer to call again when they can answer. A new brief is needed for the next call.",
        ]);
      }
      const readyAt = nowIso();
      const wallClock = Math.round((Date.parse(readyAt) - Date.parse(call.placed_at)) / 1000);

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
        "Recorded with the subject's consent, confirmed verbally by the team for this session.",
        "The opening, verbatim:",
        ...opening,
        "",
        `Next: draft_piece with brief_id ${brief.brief_id}.`,
      ]);
    },
  );
}
