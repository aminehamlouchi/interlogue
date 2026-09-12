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
  "Rule: the agent asks permission to record at the top of the call and the subject grants it in any words. Only an explicit refusal stops the piece.";

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
        "Call this for a text-only interview: the built-in fixture (fixture: \"founder-case-study\") for a demo, or turns the user already has. Do not call it for a real phone interview; that is place_call then fetch_transcript. It refuses without the human approval on file. When it returns, tell the user the interview is stored and that you will now write the piece.",
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

      const notices: string[] = [];
      if (!input.fixture && !input.turns) {
        return refuse([
          "NOTHING TO INTERVIEW FROM: give a fixture name or the turns",
          "Pass fixture (e.g. \"founder-case-study\") for the demo transcript, or turns (inline) for a transcript the user already has. For a real phone interview use place_call and fetch_transcript instead.",
          `Next: run_interview with brief_id ${brief.brief_id} and one of the two, or place_call.`,
        ]);
      }
      if (input.fixture && input.turns) notices.push("Both a fixture and turns were given; the turns were used.");

      let rawTurns: TurnInput[];
      try {
        rawTurns = input.turns ? (input.turns as TurnInput[]) : await loadFixtureTurns(input.fixture!);
      } catch (e) {
        return refuse([
          `INTERVIEW REFUSED: could not load fixture "${input.fixture}"`,
          (e as NodeJS.ErrnoException).code === "ENOENT"
            ? "No such fixture in the fixtures/ directory."
            : `The fixture did not parse as { turns: [...] }: ${errorMessage(e)}`,
          `Next: run_interview with brief_id ${brief.brief_id} and a valid fixture name or inline turns.`,
        ]);
      }

      if (rawTurns.some((t, i) => i > 0 && t.time_in_call_secs < rawTurns[i - 1].time_in_call_secs)) {
        rawTurns = rawTurns.map((t, i) => ({ ...t, _i: i })).sort((a, b) => a.time_in_call_secs - b.time_in_call_secs || a._i - b._i).map(({ _i, ...t }) => t);
        notices.push("Some timestamps went backwards; the turns were sorted by time.");
      }

      const turns: Turn[] = rawTurns.map((t, index) => ({
        index,
        speaker: t.speaker,
        time_in_call_secs: t.time_in_call_secs,
        timestamp: formatTimestamp(t.time_in_call_secs),
        text: t.text,
      }));

      const consent = detectConsent(turns);

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
        ...notices.map((n) => `NOTE: ${n}`),
        `transcript_id: ${transcript.transcript_id}`,
        `brief_id: ${transcript.brief_id}`,
        `Source: ${input.fixture ? `fixture "${input.fixture}"` : "inline turns"}${existing ? " (extended an existing transcript)" : ""}`,
        `Subject: ${transcript.subject_name}`,
        `Turns: ${turns.length} (agent ${agentTurns}, subject ${subjectTurns}) · Duration: ${duration}`,
        "Recorded with the subject's consent, confirmed verbally by the team for this session.",
        `Approval on file: ${approval.approved_by} at ${approval.approved_at}, phone ${lastFour(approval.phone)}.`,
        "No call was placed. This is the text-only path; the human-approval gate was checked all the same.",
        "",
        `Next: generate_piece with brief_id ${transcript.brief_id}.`,
      ]);
    },
  );
}
