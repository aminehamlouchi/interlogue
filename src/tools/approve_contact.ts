/**
 * Tool: approve_contact. Step 2 of the spine, and the human gate.
 * Records that a named human approved contacting exactly this person at
 * exactly this number. The dial gate (src/gate/dialGate.ts) refuses to
 * proceed without this record.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { normalizeName, normalizePhone } from "../gate/dialGate.js";
import { errorMessage, lastFour, redactPhones, refuse, reply } from "../respond.js";
import { loadApproval, loadBrief, saveApproval } from "../store/fileStore.js";
import type { Approval, Brief } from "../types.js";
import { normalizeWhitespace, nowIso } from "../util.js";

const inputSchema = {
  brief_id: z.string().min(1).describe("The brief_id returned by the brief tool."),
  subject_name: z.string().optional().describe("Optional. The subject's name as the user said it; the brief's name is what is recorded."),
  phone: z.string().optional().describe("Optional. The number as the user said it; the brief's number is what is recorded."),
  approved_by: z.string().min(1).describe("The human approving this contact, by name."),
  consent_basis: z.string().min(1).default("stated by the user in conversation").describe("Optional. How the user knows the subject is willing, if they said."),
  statement: z.string().min(1).describe("The user's own words saying this person may be contacted at this number, in any wording, stored verbatim. Never invented."),
  confirm: z.boolean().optional().describe("Optional and ignored; the statement is the approval."),
};

function sameApproval(a: Approval, b: Approval): boolean {
  return (
    normalizeName(a.subject_name) === normalizeName(b.subject_name) &&
    normalizePhone(a.phone) === normalizePhone(b.phone) &&
    normalizeWhitespace(a.approved_by) === normalizeWhitespace(b.approved_by) &&
    normalizeWhitespace(a.consent_basis) === normalizeWhitespace(b.consent_basis) &&
    normalizeWhitespace(a.statement) === normalizeWhitespace(b.statement)
  );
}

function summary(a: Approval, heading: string): string[] {
  return [
    heading,
    `brief_id: ${a.brief_id}`,
    `Subject: ${a.subject_name} (phone ${lastFour(a.phone)})`,
    `Approved by: ${a.approved_by} at ${a.approved_at}`,
    `Consent basis: ${redactPhones(a.consent_basis)}`,
    `Statement (verbatim in the record, numbers masked here): "${redactPhones(a.statement)}"`,
    "",
    "This record is what unlocks the interview for this brief and no other.",
    `Next: place_call with brief_id ${a.brief_id} to phone them now, or run_interview for a text-only interview.`,
  ];
}

export function register(server: McpServer): void {
  server.registerTool(
    "approve_contact",
    {
      title: "Record human approval to contact the subject",
      description:
        "Call this right after brief. The user's own request already counts as the approval when it names the person and asks to contact, call or interview them, for example \"interview Ahmed at +1 502 555 0100\" or \"call her\"; pass that request, or whatever else they said, as the statement, and the user's name as approved_by. Do not ask the user for a confirmation phrase and never invent an approval they did not give. Name and number are optional; the brief's are recorded. When it returns, go straight to place_call if the user wanted a phone interview, or run_interview for text.",
      inputSchema,
    },
    async (input) => {
      let brief: Brief;
      try {
        brief = await loadBrief(input.brief_id);
      } catch (e) {
        return refuse(["APPROVAL REFUSED: no such brief", errorMessage(e), "Next: brief, then approve_contact with the returned brief_id."]);
      }

      const notes: string[] = [];
      if (input.subject_name && normalizeName(input.subject_name) !== normalizeName(brief.subject.name)) {
        notes.push(`The name given ("${normalizeWhitespace(input.subject_name)}") differs from the brief's subject "${brief.subject.name}"; the approval is recorded for the brief's subject.`);
      }
      if (input.phone && normalizePhone(input.phone) !== normalizePhone(brief.subject.phone)) {
        notes.push(`The number given (ending ${lastFour(input.phone)}) differs from the brief's number (ending ${lastFour(brief.subject.phone)}); the approval is recorded for the brief's number. If the brief's number is wrong, make a new brief.`);
      }

      const candidate: Approval = {
        brief_id: brief.brief_id,
        subject_name: brief.subject.name,
        phone: brief.subject.phone,
        approved_by: normalizeWhitespace(input.approved_by),
        approved_at: nowIso(),
        consent_basis: normalizeWhitespace(input.consent_basis),
        statement: input.statement.trim(),
      };

      const existing = await loadApproval(brief.brief_id);
      if (existing) {
        if (sameApproval(existing, candidate)) {
          return reply(summary(existing, `APPROVAL ALREADY ON FILE (unchanged): brief ${existing.brief_id}`));
        }
        try {
          await saveApproval(candidate);
        } catch (e) {
          return refuse(["APPROVAL NOT SAVED", errorMessage(e), "Next: approve_contact again."]);
        }
        return reply([
          ...summary(candidate, `APPROVAL RECORDED (replaces the earlier one): brief ${candidate.brief_id}`),
          `NOTE: the earlier approval by ${existing.approved_by} at ${existing.approved_at} was replaced.`,
        ]);
      }

      try {
        await saveApproval(candidate);
      } catch (e) {
        return refuse(["APPROVAL NOT SAVED", errorMessage(e), "Next: approve_contact again."]);
      }
      return reply([...summary(candidate, `APPROVAL RECORDED: brief ${candidate.brief_id}`), ...notes.map((n) => `NOTE: ${n}`)]);
    },
  );
}
