/**
 * Customer case study question bank and angle weighting.
 *
 * The angle shapes WHICH questions get asked (high-priority beats get their
 * follow-up questions) and WHAT gets emphasized later (the writer uses the
 * same weights to decide which beat supplies the headline quote and how many
 * quotes each beat carries). The angle never changes what the subject said:
 * every quote is a verbatim substring of a transcript turn.
 *
 * Genre is fixed to customer case study in this build. Multi-genre templates
 * are on the cut list and answered by the question_templates stub.
 */
import { BEAT_ORDER, type Beat, type Brief, type PlannedQuestion } from "./types.js";
import { stem, tokenize } from "./util.js";

interface BankEntry {
  id: string;
  beat: Beat;
  follow_up: boolean;
  text: string;
  label: string;
}

/** Placeholders: {company} {product} {client} {topic} {name} */
export const CASE_STUDY_BANK: readonly BankEntry[] = [
  {
    id: "context_1",
    beat: "context",
    follow_up: false,
    text: "To start, can you tell me a little about {company} and what you do there?",
    label: "what {company} does",
  },
  {
    id: "context_2",
    beat: "context",
    follow_up: true,
    text: "How big is the team, and who handles the day-to-day operations?",
    label: "the size of the team",
  },
  {
    id: "problem_1",
    beat: "problem",
    follow_up: false,
    text: "Before {product}, how did {company} handle {topic}? Walk me through what a typical week looked like.",
    label: "what the work looked like before {product}",
  },
  {
    id: "problem_2",
    beat: "problem",
    follow_up: true,
    text: "What did that cost you, in time, money or mistakes?",
    label: "what the old way cost",
  },
  {
    id: "search_1",
    beat: "search",
    follow_up: false,
    text: "What made you start looking for something different, and what else did you consider?",
    label: "what set off the search",
  },
  {
    id: "search_2",
    beat: "search",
    follow_up: true,
    text: "How did you compare the options? What mattered most?",
    label: "how the options were compared",
  },
  {
    id: "decision_1",
    beat: "decision",
    follow_up: false,
    text: "Why did you pick {product} in the end?",
    label: "why {company} chose {product}",
  },
  {
    id: "decision_2",
    beat: "decision",
    follow_up: true,
    text: "Was there anything that almost stopped you from going with it?",
    label: "what nearly stopped the decision",
  },
  {
    id: "implementation_1",
    beat: "implementation",
    follow_up: false,
    text: "What did the first few weeks with {product} actually look like?",
    label: "the first weeks with {product}",
  },
  {
    id: "implementation_2",
    beat: "implementation",
    follow_up: true,
    text: "Did anything about the switch go wrong or surprise you?",
    label: "what went wrong or surprised them in the switch",
  },
  {
    id: "results_1",
    beat: "results",
    follow_up: false,
    text: "What has changed since? If you have numbers, I would love to hear them.",
    label: "what has changed since the switch",
  },
  {
    id: "results_2",
    beat: "results",
    follow_up: true,
    text: "Is there a moment where you noticed the difference?",
    label: "a moment where the difference showed",
  },
  {
    id: "reflection_1",
    beat: "reflection",
    follow_up: false,
    text: "What would you tell another founder in your position who is weighing this?",
    label: "what they would tell another founder",
  },
  {
    id: "reflection_2",
    beat: "reflection",
    follow_up: true,
    text: "What is next for {company}?",
    label: "what is next for {company}",
  },
];

/**
 * Beat lexicon. Stemmed on load so the angle's tokens meet it after tokenize().
 * A word can belong to more than one beat; "hours" is both a cost and a result.
 */
const BEAT_LEXICON: Record<Beat, string[]> = {
  context: ["team", "small", "person", "family", "founder", "founders", "background", "story", "shop", "business", "company"],
  problem: ["manual", "manually", "spreadsheet", "spreadsheets", "before", "pain", "hours", "time", "cost", "error", "errors", "mistake", "mistakes", "slow", "chaos", "bottleneck", "headache", "old", "paper", "phone", "email", "late", "nights", "weekends", "burnout"],
  search: ["alternative", "alternatives", "compare", "comparison", "evaluate", "evaluation", "options", "search", "shortlist", "competitor", "competitors", "versus", "vendors", "demo", "demos", "vendor"],
  decision: ["why", "chose", "choose", "choice", "decision", "decide", "picked", "pick", "switch", "switched", "trust", "price", "pricing", "budget", "risk", "bet"],
  implementation: ["onboarding", "rollout", "setup", "migration", "migrate", "training", "adoption", "integration", "install", "launch", "first", "weeks", "learning", "curve"],
  results: ["result", "results", "outcome", "outcomes", "saved", "save", "savings", "hours", "revenue", "growth", "grew", "numbers", "percent", "faster", "roi", "impact", "back", "mondays", "monday", "week", "weekly", "time", "reclaimed", "freed", "orders", "customers", "throughput", "accuracy"],
  reflection: ["advice", "lesson", "lessons", "next", "future", "founder", "founders", "plan", "plans", "hindsight", "regret", "again"],
};

const STEMMED_LEXICON: Record<Beat, Set<string>> = Object.fromEntries(
  (Object.keys(BEAT_LEXICON) as Beat[]).map((b) => [b, new Set(BEAT_LEXICON[b].map((w) => stem(w.toLowerCase())))]),
) as Record<Beat, Set<string>>;

/** Default emphasis when the angle matches nothing: the classic case-study spine. */
const DEFAULT_HIGH: Beat[] = ["problem", "results"];

/**
 * Angle -> per-beat weight in [0, 1]. The best-matching beat gets 1.0.
 * Beats at or above 0.5 are "high priority" and get their follow-up asked.
 */
export function emphasisFromAngle(angle: string): Record<Beat, number> {
  const tokens = tokenize(angle);
  const raw: Record<Beat, number> = {
    context: 0, problem: 0, search: 0, decision: 0, implementation: 0, results: 0, reflection: 0,
  };
  for (const t of tokens) {
    for (const beat of BEAT_ORDER) {
      if (STEMMED_LEXICON[beat].has(t)) raw[beat] += 1;
    }
  }
  const max = Math.max(...BEAT_ORDER.map((b) => raw[b]));
  if (max === 0) {
    for (const b of DEFAULT_HIGH) raw[b] = 1;
    return raw;
  }
  for (const b of BEAT_ORDER) raw[b] = Math.round((raw[b] / max) * 100) / 100;
  return raw;
}

export function highPriorityBeats(emphasis: Record<Beat, number>): Beat[] {
  return BEAT_ORDER.filter((b) => emphasis[b] >= 0.5);
}

function fill(template: string, brief: Pick<Brief, "subject" | "client" | "topic">): string {
  return template
    .replace(/\{company\}/g, brief.subject.company)
    .replace(/\{name\}/g, brief.subject.name)
    .replace(/\{product\}/g, brief.client.product)
    .replace(/\{client\}/g, brief.client.company)
    .replace(/\{topic\}/g, brief.topic);
}

/**
 * Build the question plan for a brief. Primary questions are always asked, in
 * arc order. Follow-ups are asked only for high-priority beats. This is the
 * concrete sense in which the angle shapes which questions get asked.
 */
export function buildQuestionPlan(
  brief: Pick<Brief, "subject" | "client" | "topic">,
  emphasis: Record<Beat, number>,
): PlannedQuestion[] {
  const high = new Set(highPriorityBeats(emphasis));
  const plan: PlannedQuestion[] = [];
  for (const beat of BEAT_ORDER) {
    for (const q of CASE_STUDY_BANK) {
      if (q.beat !== beat) continue;
      if (q.follow_up && !high.has(beat)) continue;
      plan.push({
        id: q.id,
        beat: q.beat,
        text: fill(q.text, brief),
        label: fill(q.label, brief),
        priority: high.has(beat) ? "high" : "normal",
        follow_up: q.follow_up,
      });
    }
  }
  return plan;
}

/** Keyword classification of an agent turn when it matches no planned question. */
export function classifyByLexicon(text: string, minScore = 1): Beat | null {
  const tokens = tokenize(text);
  let best: Beat | null = null;
  let bestScore = 0;
  for (const beat of BEAT_ORDER) {
    let score = 0;
    for (const t of tokens) if (STEMMED_LEXICON[beat].has(t)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = beat;
    }
  }
  return bestScore >= minScore ? best : null;
}
