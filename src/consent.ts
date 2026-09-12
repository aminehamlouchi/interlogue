/**
 * Consent evidence from the top of a call.
 *
 * The rule: the agent states it is an AI and asks permission to record at
 * the top of the call. This looks at the first two agent turns for the
 * disclosure and the ask, and at the first subject turn after the ask for
 * the grant. It returns the turn indexes that prove each finding so the
 * evidence can be cited like any other claim.
 */
import type { ConsentEvidence, Turn } from "./types.js";
import { normalizeForMatch } from "./util.js";

const DISCLOSURE_PATTERNS: RegExp[] = [
  /\b(i am|i'm|this is)\b[^.?!]*\b(an? )?(ai|artificial intelligence|automated (assistant|interviewer|system)|virtual (assistant|interviewer))\b/i,
  /\bnot a (person|human)\b/i,
];

const MENTIONS_RECORDING = /\brecord(ing|ed|s)?\b/i;
const ASK_CUE = /\b(okay|ok|all right|alright|fine|permission|mind)\b/i;

const GRANT = /\b(yes|yeah|yep|sure|fine|okay|ok|of course|go ahead|that's fine|that is fine|absolutely)\b/i;
const DECLINE = /\b(no|not|don't|do not|rather not)\b/i;

/** How many leading agent turns count as "the top of the call". */
const AGENT_WINDOW = 2;

export function detectConsent(turns: Turn[]): ConsentEvidence {
  const evidence = new Set<number>();
  let ai_disclosed = false;
  let recording_permission_asked = false;
  let recording_permission_granted = false;
  let askPosition = -1;

  let seenAgentTurns = 0;
  for (let i = 0; i < turns.length && seenAgentTurns < AGENT_WINDOW; i++) {
    const turn = turns[i];
    if (turn.speaker !== "agent") continue;
    seenAgentTurns++;
    const text = normalizeForMatch(turn.text);

    if (!ai_disclosed && DISCLOSURE_PATTERNS.some((re) => re.test(text))) {
      ai_disclosed = true;
      evidence.add(turn.index);
    }
    if (
      !recording_permission_asked &&
      MENTIONS_RECORDING.test(text) &&
      (text.includes("?") || ASK_CUE.test(text))
    ) {
      recording_permission_asked = true;
      askPosition = i;
      evidence.add(turn.index);
    }
  }

  if (recording_permission_asked) {
    for (let i = askPosition + 1; i < turns.length; i++) {
      const turn = turns[i];
      if (turn.speaker !== "subject") continue;
      const text = normalizeForMatch(turn.text);
      if (GRANT.test(text) && !DECLINE.test(text)) {
        recording_permission_granted = true;
        evidence.add(turn.index);
      }
      break; // only the first subject turn after the ask counts
    }
  }

  return {
    ai_disclosed,
    recording_permission_asked,
    recording_permission_granted,
    evidence_turn_indexes: [...evidence].sort((a, b) => a - b),
  };
}
