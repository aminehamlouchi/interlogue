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
  subject_name: z.string().min(1).describe("The subject's full name, exactly as on the brief."),
  phone: z.string().min(4).describe("The subject's phone number, exactly as on the brief."),
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
        "Call this right after brief, as soon as the user has said, in any words, that this person may be contacted at this number: \"yes\", \"go ahead\", \"call her\", \"you can reach him there\" all count. Pass what the user actually said as the statement and the user's name as approved_by. Do not ask the user for a confirmation phrase, and never invent an approval they did not give. When it returns, tell the user the approval is on file and ask whether to call now or use a text interview.",
      inputSchema,
    },
    async (input) => {
      let brief: Brief;
      try {
        brief = await loadBrief(input.brief_id);
      } catch (e) {
        return refuse(["APPROVAL REFUSED: no such brief", errorMessage(e), "Next: brief, then approve_contact with the returned brief_id."]);
      }

      const problems: string[] = [];
      if (normalizeName(input.subject_name) !== normalizeName(brief.subject.name)) {
        problems.push(`Name "${normalizeWhitespace(input.subject_name)}" does not match the brief's subject "${brief.subject.name}".`);
      }
      if (normalizePhone(input.phone) !== normalizePhone(brief.subject.phone)) {
        problems.push(`Phone ${lastFour(input.phone)} does not match the brief's subject phone ${lastFour(brief.subject.phone)}.`);
      }
      if (problems.length > 0) {
        return refuse([
          "APPROVAL REFUSED: does not match the brief",
          ...problems,
          "An approval covers exactly the person and number on the brief. If the brief is wrong, create a new brief; do not approve a different person or number against it.",
          `Next: approve_contact again with the name and number from brief ${brief.brief_id}, or brief to start over.`,
        ]);
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
      return reply(summary(candidate, `APPROVAL RECORDED: brief ${candidate.brief_id}`));
    },
  );
}
