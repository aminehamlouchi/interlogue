/**
 * Split a transcript into question blocks: one agent question followed by
 * the subject's answer turns. Each block is classified into a story beat
 * using the brief's question plan, with the beat lexicon as a fallback.
 * The blocks are the per-question view of the piece and the raw material
 * for the story.
 */
import { classifyByLexicon } from "../questionBank.js";
import type { Beat, Brief, QABlock, Transcript, Turn } from "../types.js";
import { overlap, tokenize } from "../util.js";

const MATCH_THRESHOLD = 0.35;
const RECORD_RE = /\brecord(ing|ed)?\b/i;
const AI_RE = /\b(an? )?(ai|artificial intelligence|automated (assistant|interviewer|system)|virtual (assistant|interviewer))\b|\bnot a (person|human)\b/i;

interface PlanMatch {
  id: string;
  beat: Beat;
  score: number;
}

function bestPlanMatch(agentText: string, brief: Brief): PlanMatch | null {
  const agentTokens = tokenize(agentText);
  let best: PlanMatch | null = null;
  for (const q of brief.question_plan) {
    const planTokens = tokenize(q.text);
    const score = Math.max(overlap(planTokens, agentTokens), overlap(agentTokens, planTokens));
    if (!best || score > best.score) best = { id: q.id, beat: q.beat, score };
  }
  return best && best.score >= MATCH_THRESHOLD ? best : null;
}

function makeBlock(question: Turn, answers: Turn[], brief: Brief): QABlock {
  const match = bestPlanMatch(question.text, brief);
  let beat: QABlock["beat"];
  if (match) {
    beat = match.beat;
  } else if (RECORD_RE.test(question.text) && AI_RE.test(question.text)) {
    beat = "consent";
  } else {
    beat = classifyByLexicon(question.text, 2) ?? "other";
  }
  return {
    beat,
    question: question.text,
    question_turn_index: question.index,
    question_timestamp: question.timestamp,
    answer: answers.map((a) => a.text).join(" "),
    answer_turn_indexes: answers.map((a) => a.index),
    answer_timestamps: answers.map((a) => a.timestamp),
    ...(match ? { planned_question_id: match.id } : {}),
  };
}

export function segmentTranscript(transcript: Transcript, brief: Brief): QABlock[] {
  const turns = transcript.turns;
  const blocks: QABlock[] = [];
  let i = 0;
  while (i < turns.length) {
    const t = turns[i];
    if (t.speaker !== "agent") {
      i++;
      continue;
    }
    const answers: Turn[] = [];
    let j = i + 1;
    while (j < turns.length && turns[j].speaker === "subject") {
      answers.push(turns[j]);
      j++;
    }
    if (answers.length > 0) blocks.push(makeBlock(t, answers, brief));
    i = j;
  }
  return blocks;
}
