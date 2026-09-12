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
  consent_basis: z.string().min(1).describe("How the approver knows the subject consents to being interviewed and recorded, e.g. \"agreed by email on Tuesday\"."),
  statement: z.string().min(1).describe("The approver's own words, stored verbatim."),
  confirm: z.literal(true).describe("A human must pass true. This records approval to contact exactly this person at exactly this number."),
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
    "This record is what unlocks the interview for this brief and no other. Nothing is dialed in this build.",
    `Next: run_interview with brief_id ${a.brief_id} (text-only: pass a fixture name or the turns).`,
  ];
}

export function register(server: McpServer): void {
  server.registerTool(
    "approve_contact",
    {
      title: "Record human approval to contact the subject",
      description:
        "Call this right after brief, once the user has confirmed in their own words that InterLogue may contact this specific person at this specific number; pass their words as the statement, the user's name as approved_by, and confirm: true. Never call it before the user has said yes, and never invent the statement. It records the human approval that every interview and every call requires. When it returns, tell the user the approval is on file and ask whether to call now (phone) or run the interview from text.",
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
        return refuse([
          "APPROVAL REFUSED: a different approval already exists for this brief",
          `Existing record: approved by ${existing.approved_by} at ${existing.approved_at} for ${existing.subject_name} (phone ${lastFour(existing.phone)}).`,
          "Approvals are not silently rewritten. Re-approving with identical values is fine; to change who approved or on what basis, create a new brief.",
          `Next: status with brief_id ${existing.brief_id} to see the record, or brief to start over.`,
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
