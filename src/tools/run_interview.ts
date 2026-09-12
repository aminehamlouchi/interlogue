/**
 * Tool: run_interview. Step 3 of the spine, text-only path.
 *
 * Takes the interview turns from a fixture file or inline, checks the human
 * approval gate, checks consent at the top of the call, and saves the
 * transcript (append-only). No call is placed in this build; the gate is
 * checked all the same so every run of the spine exercises it.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectConsent } from "../consent.js";
import { GateError, assertDialApproved } from "../gate/dialGate.js";
import { errorMessage, lastFour, refuse, reply } from "../respond.js";
import { PACKAGE_ROOT, loadBrief, loadTranscript, saveTranscript } from "../store/fileStore.js";
import type { Approval, Brief, Transcript, Turn, TurnInput } from "../types.js";
import { formatTimestamp, newId, nowIso } from "../util.js";

const turnInputSchema = z.object({
  speaker: z.enum(["agent", "subject"]),
  time_in_call_secs: z.number().min(0),
  text: z.string().min(1),
});

const fixtureFileSchema = z.object({
  turns: z.array(turnInputSchema).min(1),
});

const FIXTURE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const inputSchema = {
  brief_id: z.string().min(1).describe("The brief_id from the brief tool. Must have a matching approve_contact record."),
  fixture: z
    .string()
    .regex(FIXTURE_NAME, "fixture is a bare file name, no path")
    .optional()
    .describe("Name of a fixture in the package's fixtures/ directory without the \".transcript.json\" suffix, e.g. \"founder-case-study\". Give either fixture or turns, not both."),
  turns: z
    .array(turnInputSchema)
    .min(1)
    .optional()
    .describe("Inline interview turns in call order: { speaker: agent|subject, time_in_call_secs, text }. Give either fixture or turns, not both."),
};

const CONSENT_RULE =
  "Rule: the agent states it is an AI and asks permission to record at the top of the call. A transcript whose opening does not show both is not accepted.";

async function loadFixtureTurns(name: string): Promise<TurnInput[]> {
  const file = path.join(PACKAGE_ROOT, "fixtures", `${name}.transcript.json`);
  const raw = await fs.readFile(file, "utf8");
  const parsed = fixtureFileSchema.parse(JSON.parse(raw));
  return parsed.turns;
}

export function register(server: McpServer): void {
  server.registerTool(
    "run_interview",
    {
      title: "Run the interview (text-only in this build)",
      description:
        "Runs the interview step of the spine on text: either a named fixture transcript or inline turns. " +
        "Refuses unless a human approval for this brief's exact person and number is on file (the same gate a real dial would need). " +
        "Checks that the agent disclosed it is an AI and asked permission to record at the top of the call, then saves the transcript. Transcripts are append-only. " +
        "No phone call is placed in this build. Next step: generate_piece.",
      inputSchema,
    },
    async (input) => {
      let brief: Brief;
      try {
        brief = await loadBrief(input.brief_id);
      } catch (e) {
        return refuse(["INTERVIEW REFUSED: no such brief", errorMessage(e), "Next: brief, then approve_contact, then run_interview."]);
      }

      // The human-approval gate. Nothing proceeds without it, text-only or not.
      let approval: Approval;
      try {
        approval = await assertDialApproved(brief.brief_id);
      } catch (e) {
        if (e instanceof GateError) {
          return refuse([
            "HUMAN-APPROVAL GATE: interview refused",
            `Reason: ${e.message}`,
            "No call is placed and no transcript is written until a human has recorded approval to contact this specific person at this specific number. This build is text-only and still enforces the gate.",
            `Next: approve_contact with brief_id ${brief.brief_id}, the subject's name and number as on the brief, and confirm: true.`,
          ]);
        }
        throw e;
      }

      if ((input.fixture && input.turns) || (!input.fixture && !input.turns)) {
        return refuse([
          "INTERVIEW REFUSED: give exactly one of fixture or turns",
          "Pass fixture (a name in fixtures/, e.g. \"founder-case-study\") or turns (inline), not both and not neither.",
          `Next: run_interview with brief_id ${brief.brief_id} and one of the two.`,
        ]);
      }

      let rawTurns: TurnInput[];
      try {
        rawTurns = input.fixture ? await loadFixtureTurns(input.fixture) : (input.turns as TurnInput[]);
      } catch (e) {
        return refuse([
          `INTERVIEW REFUSED: could not load fixture "${input.fixture}"`,
          (e as NodeJS.ErrnoException).code === "ENOENT"
            ? "No such fixture in the fixtures/ directory."
            : `The fixture did not parse as { turns: [...] }: ${errorMessage(e)}`,
          `Next: run_interview with brief_id ${brief.brief_id} and a valid fixture name or inline turns.`,
        ]);
      }

      for (let i = 1; i < rawTurns.length; i++) {
        if (rawTurns[i].time_in_call_secs < rawTurns[i - 1].time_in_call_secs) {
          return refuse([
            "INTERVIEW REFUSED: timestamps go backwards",
            `Turn ${i} is at ${rawTurns[i].time_in_call_secs}s but turn ${i - 1} is at ${rawTurns[i - 1].time_in_call_secs}s. time_in_call_secs must be non-decreasing.`,
            "Next: fix the turns and call run_interview again.",
          ]);
        }
      }

      const turns: Turn[] = rawTurns.map((t, index) => ({
        index,
        speaker: t.speaker,
        time_in_call_secs: t.time_in_call_secs,
        timestamp: formatTimestamp(t.time_in_call_secs),
        text: t.text,
      }));

      const consent = detectConsent(turns);
      if (!consent.ai_disclosed || !consent.recording_permission_asked || !consent.recording_permission_granted) {
        return refuse([
          "CONSENT CHECK FAILED: transcript not saved",
          CONSENT_RULE,
          `AI disclosed at the top of the call: ${consent.ai_disclosed ? "yes" : "NO"}`,
          `Permission to record asked at the top of the call: ${consent.recording_permission_asked ? "yes" : "NO"}`,
          `Permission to record granted by the subject: ${consent.recording_permission_granted ? "yes" : "NO"}`,
          "Nothing was persisted. The opening agent turns must state that the interviewer is an AI and ask whether it is okay to record, and the subject must say yes before the interview continues.",
          "Next: fix the opening turns and call run_interview again.",
        ]);
      }

      const existing = await loadTranscript(brief.brief_id);
      const transcript: Transcript = {
        transcript_id: existing ? existing.transcript_id : newId("trn"),
        brief_id: brief.brief_id,
        source: input.fixture ? "text_fixture" : "text_inline",
        subject_name: brief.subject.name,
        started_at: existing ? existing.started_at : nowIso(),
        turns,
        consent,
      };

      try {
        await saveTranscript(transcript);
      } catch (e) {
        return refuse([
          "TRANSCRIPT IS APPEND-ONLY: write refused",
          errorMessage(e),
          "A transcript is never shortened or edited. To add turns, resend all existing turns unchanged followed by the new ones. To fix a piece, regenerate it from the transcript instead.",
          `Next: status with brief_id ${brief.brief_id} to see what is stored.`,
        ]);
      }

      const agentTurns = turns.filter((t) => t.speaker === "agent").length;
      const subjectTurns = turns.length - agentTurns;
      const duration = formatTimestamp(turns[turns.length - 1].time_in_call_secs);
      const yn = (b: boolean) => (b ? "yes" : "no");

      return reply([
        `INTERVIEW RECORDED (text-only): ${transcript.transcript_id}`,
        `transcript_id: ${transcript.transcript_id}`,
        `brief_id: ${transcript.brief_id}`,
        `Source: ${input.fixture ? `fixture "${input.fixture}"` : "inline turns"}${existing ? " (extended an existing transcript)" : ""}`,
        `Subject: ${transcript.subject_name}`,
        `Turns: ${turns.length} (agent ${agentTurns}, subject ${subjectTurns}) · Duration: ${duration}`,
        `Consent evidence: AI disclosed ${yn(consent.ai_disclosed)} · recording permission asked ${yn(consent.recording_permission_asked)} · granted ${yn(consent.recording_permission_granted)} · evidence turns [${consent.evidence_turn_indexes.join(", ")}]`,
        `Approval on file: ${approval.approved_by} at ${approval.approved_at}, phone ${lastFour(approval.phone)}.`,
        "No call was placed. This is the text-only path; the human-approval gate was checked all the same.",
        "",
        `Next: generate_piece with brief_id ${transcript.brief_id}.`,
      ]);
    },
  );
}
