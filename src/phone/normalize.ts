/**
 * Bridges between the brief and the ElevenLabs agent, in both directions:
 * the brief becomes the six dynamic variables the published agent expects,
 * and the conversation transcript becomes InterLogue's timestamped turns.
 */
import type { Brief, TurnInput } from "../types.js";
import type { ConversationDetails } from "./elevenlabs.js";

/** The six dynamic variables the published agent declares. Names are the agent's contract. */
export function buildDynamicVariables(brief: Brief): Record<string, string> {
  const plan = brief.question_plan.map((q, i) => `${i + 1}. ${q.text}`).join("\n");
  return {
    subject_name: brief.subject.name,
    subject_role: brief.subject.role,
    client_name: brief.client.company,
    genre: "customer case study",
    angle: brief.angle,
    question_plan: plan,
  };
}

/**
 * One turn per transcript entry that carries a message, with the real
 * seconds-into-call timestamp. Entries with no message (tool calls, empty
 * segments) are dropped. Order is by time, stable.
 */
/**
 * Stage-direction tags the agent's model emits inside its own lines, such as
 * "[professional]" or "[surprised]". They are delivery notes, not speech.
 * Stripped from AGENT turns only; subject turns are never touched.
 */
const STAGE_TAG_RE = /\[[a-z][a-z .,'-]{0,40}\]/gi;

export function stripStageTags(agentText: string): string {
  return agentText
    .replace(STAGE_TAG_RE, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,;:!?])/g, "$1")
    .replace(/\s+\.(?!\.)/g, ".")
    .trim();
}

export function normalizeTranscript(details: ConversationDetails): TurnInput[] {
  const turns: TurnInput[] = [];
  for (const entry of details.transcript ?? []) {
    const raw = (entry.message ?? "").replace(/\s+/g, " ").trim();
    const text = entry.role === "agent" ? stripStageTags(raw) : raw;
    if (!text) continue;
    const secs = typeof entry.time_in_call_secs === "number" && Number.isFinite(entry.time_in_call_secs) ? Math.max(0, entry.time_in_call_secs) : 0;
    turns.push({ speaker: entry.role === "user" ? "subject" : "agent", time_in_call_secs: secs, text });
  }
  return turns.map((t, i) => ({ ...t, _i: i })).sort((a, b) => a.time_in_call_secs - b.time_in_call_secs || a._i - b._i).map(({ _i, ...t }) => t);
}
