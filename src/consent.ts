/**
 * Consent evidence from the opening of a call, matched on meaning.
 *
 * The commitment: the agent asks to record and the subject grants. The
 * wording of the grant was never the commitment. So:
 *  - The window is the opening minute of the call or the first six turns,
 *    whichever is longer.
 *  - Disclosure: any agent turn in the window saying it is an AI, an
 *    automated interviewer, or not a person.
 *  - Ask: any agent turn in the window that mentions recording with a
 *    question or a request.
 *  - Grant: any subject turn after the ask that is not an explicit refusal,
 *    including a turn that simply answers the first question. "No problem"
 *    and "no worries" are a yes.
 *  - Refusal: an explicit no to recording. The only thing that stops the piece.
 *  - Missing disclosure or ask is a notice, not a block: the published agent
 *    carries both in its configuration.
 */
import type { ConsentEvidence, Turn } from "./types.js";
import { normalizeForMatch } from "./util.js";

const WINDOW_SECS = 60;
const WINDOW_TURNS = 6;

const DISCLOSURE_PATTERNS: RegExp[] = [
  /\b(i am|i'm|i’m|this is|you are speaking (to|with)|you're speaking (to|with)|calling as)\b[^.?!]*\b(an? )?(ai|a\.i\.|artificial intelligence|automated (assistant|interviewer|system|caller)|virtual (assistant|interviewer)|ai interviewer|bot|computer)\b/i,
  /\b(not a (person|human|real person)|not human)\b/i,
  /\b(an ai|ai interviewer|automated interviewer)\b/i,
];

const MENTIONS_RECORDING = /\brecord(ing|ed|s)?\b/i;
const ASK_CUE = /\b(okay|ok|all right|alright|fine|permission|mind|may i|can i|could i|is it|would (it|you)|do you|are you|consent|let me know|need to know|agree)\b/i;

/** Idioms that contain "no" or "not" but mean yes. Stripped before the refusal test. */
const YES_IDIOMS =
  /\b(no problem(o|s)?|no worries|not a problem|no issue(s)?|no big deal|no objection(s)?|no trouble|not at all|no doubt|nope, that's fine|no, that's fine|no, go ahead|no, (it's|its|that's|thats) (fine|okay|ok|cool))\b/gi;

/** Explicit refusals to be recorded. */
const REFUSAL_PATTERNS: RegExp[] = [
  /^\s*(no|nope|nah|no thanks|no thank you)\b[\s.,!]*$/i,
  /^\s*(no|nope|nah)\b[\s,]+(?!problem|worries|issue|big deal|objection|trouble)/i,
  /\b(don'?t|do not|please don'?t|please do not|never|cannot|can'?t|shouldn'?t)\s+(record|be record|tape|save)/i,
  /\b(i'?d|i would|we'?d|we would)\s+(rather|prefer)\s+(not|you (didn'?t|did not|not))/i,
  /\b(rather not|prefer not|not comfortable|uncomfortable|not okay with|not ok with|not fine with|no recording|without (a |the )?recording|off the record|stop (the )?record(ing)?|decline|refuse|i do not consent|i don'?t consent|do not have (my )?(permission|consent)|you don'?t have (my )?(permission|consent))\b/i,
  /\b(stop|hang up|end the call)\b[\s.,!]*$/i,
];

export function isExplicitRefusal(subjectText: string): boolean {
  const cleaned = normalizeForMatch(subjectText).replace(YES_IDIOMS, "").trim();
  if (!cleaned) return false; // the whole reply was a yes-idiom
  return REFUSAL_PATTERNS.some((re) => re.test(cleaned));
}

export function detectConsent(turns: Turn[]): ConsentEvidence {
  const evidence = new Set<number>();
  let ai_disclosed = false;
  let recording_permission_asked = false;
  let askPosition = -1;

  // The opening window: first minute or first six turns, whichever is longer.
  const startSecs = turns.length ? turns[0].time_in_call_secs : 0;
  const inWindow = (i: number): boolean => i < WINDOW_TURNS || turns[i].time_in_call_secs - startSecs <= WINDOW_SECS;

  for (let i = 0; i < turns.length && inWindow(i); i++) {
    const turn = turns[i];
    if (turn.speaker !== "agent") continue;
    const text = normalizeForMatch(turn.text);
    if (!ai_disclosed && DISCLOSURE_PATTERNS.some((re) => re.test(text))) {
      ai_disclosed = true;
      evidence.add(turn.index);
    }
    if (!recording_permission_asked && MENTIONS_RECORDING.test(text) && (text.includes("?") || ASK_CUE.test(text))) {
      recording_permission_asked = true;
      askPosition = i;
      evidence.add(turn.index);
    }
  }

  // Grant: the first subject turn after the ask that is not an explicit refusal.
  // If the ask was not found, the first subject turn in the window plays the same role.
  let recording_permission_granted = false;
  let refused = false;
  const from = recording_permission_asked ? askPosition + 1 : 0;
  for (let i = from; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.speaker !== "subject") continue;
    if (!recording_permission_asked && !inWindow(i)) break;
    if (isExplicitRefusal(turn.text)) {
      refused = true;
      evidence.add(turn.index);
    } else {
      recording_permission_granted = true;
      evidence.add(turn.index);
    }
    break;
  }

  const missing: string[] = [];
  if (!ai_disclosed) missing.push("AI disclosure");
  if (!recording_permission_asked) missing.push("the recording ask");
  const notice =
    missing.length && !refused
      ? `${missing.join(" and ")} not found in the opening; the published agent configuration carries ${missing.length > 1 ? "them" : "it"}. Stored with this notice.`
      : undefined;

  return {
    ai_disclosed,
    recording_permission_asked,
    recording_permission_granted: recording_permission_granted && !refused,
    refused,
    evidence_turn_indexes: [...evidence].sort((a, b) => a - b),
    ...(notice ? { notice } : {}),
  };
}

/** A voicemail greeting or an automated announcement, not a person. */
const VOICEMAIL_RE =
  /\b(not available|is unavailable|leave (a|your) (brief )?message|record your message|after the tone|at the tone|voice ?mail|mailbox|cannot take your call|can'?t take your call|please leave|has been forwarded|is not in service|the number you (have )?dialed)\b/i;

/** True when the opening subject turns read as a voicemail system rather than a person. */
export function looksLikeVoicemail(turns: Turn[]): boolean {
  const subject = turns.filter((t) => t.speaker === "subject").slice(0, 2);
  return subject.some((t) => VOICEMAIL_RE.test(normalizeForMatch(t.text)));
}
