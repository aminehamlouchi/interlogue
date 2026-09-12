/**
 * The dial gate.
 *
 * assertDialApproved is the only thing that can unlock a dial. No code path
 * may place a call without calling it and receiving an Approval back. It
 * checks that a human recorded approval for this brief, and that the
 * approved name and number match the brief's subject exactly (name
 * whitespace-normalized and case-insensitive, phone normalized to digits).
 *
 * Nothing in this build dials. The text-only interview path calls this gate
 * too, so the gate is exercised on every run of the spine and a missing or
 * mismatched approval stops the spine before any transcript is written.
 */
import { loadApproval, loadBrief } from "../store/fileStore.js";
import type { Approval } from "../types.js";
import { normalizeWhitespace } from "../util.js";

export class GateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GateError";
  }
}

/** Keep digits, and a leading "+" if present. "+1-502-555-0142" -> "+15025550142". */
export function normalizePhone(s: string): string {
  const t = String(s ?? "").trim();
  const plus = t.startsWith("+") ? "+" : "";
  return plus + t.replace(/\D/g, "");
}

export function normalizeName(s: string): string {
  return normalizeWhitespace(String(s ?? "")).toLowerCase();
}

function last4(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : "????";
}

/**
 * Returns the recorded Approval for the brief, or throws GateError.
 * The returned Approval is the token that a dialing path would require.
 */
export async function assertDialApproved(briefId: string): Promise<Approval> {
  let brief;
  try {
    brief = await loadBrief(briefId);
  } catch (e) {
    throw new GateError(`No brief with id "${briefId}", so there is nothing a human could have approved.`);
  }

  const approval = await loadApproval(briefId);
  if (!approval) {
    throw new GateError(
      `No human approval is recorded for brief ${briefId}. A human must approve contacting this specific person at this specific number (approve_contact) before anything proceeds.`,
    );
  }

  if (normalizeName(approval.subject_name) !== normalizeName(brief.subject.name)) {
    throw new GateError(
      `The recorded approval names "${approval.subject_name}" but the brief's subject is "${brief.subject.name}". The approval must name exactly the person on the brief.`,
    );
  }

  if (normalizePhone(approval.phone) !== normalizePhone(brief.subject.phone)) {
    throw new GateError(
      `The recorded approval is for a number ending ${last4(approval.phone)} but the brief's subject number ends ${last4(brief.subject.phone)}. The approval must cover exactly the number on the brief.`,
    );
  }

  return approval;
}
