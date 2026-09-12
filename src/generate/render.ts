/**
 * Render a piece as markdown in the mandated order and no other:
 * story, then pull quotes, then per-question answers as a secondary view.
 */
import type { CitationReport, Piece, QABlock } from "../types.js";

export function renderMarkdown(p: Omit<Piece, "markdown">, subjectName: string): string {
  const out: string[] = [];
  out.push(`# ${p.story.headline}`);
  out.push(`*${p.story.dek}*`);
  out.push(p.story.byline);
  out.push("");
  for (const para of p.story.paragraphs) {
    out.push(para.text);
    out.push("");
  }

  out.push("## Pull quotes");
  out.push("");
  for (const q of p.pull_quotes) {
    out.push(`> “${q.quote}” (${subjectName}, ${q.timestamp})`);
    out.push("");
  }

  out.push(renderQASection(p.qa, subjectName));
  out.push(renderFooter(p.citation_check));
  return out.join("\n");
}

/** The per-question view, verbatim from the transcript. Always the third section. */
export function renderQASection(qa: QABlock[], subjectName: string): string {
  const out: string[] = [];
  out.push("## Per-question answers (secondary view)");
  out.push("");
  const consent = qa.filter((b) => b.beat === "consent");
  const rest = qa.filter((b) => b.beat !== "consent");
  for (const b of rest) {
    out.push(`**${b.question}** (${b.question_timestamp})`);
    out.push("");
    out.push(b.answer);
    out.push("");
    out.push(`Answer at ${b.answer_timestamps.join(", ")}`);
    out.push("");
  }
  if (consent.length > 0) {
    out.push("**Consent**");
    out.push("");
    for (const b of consent) {
      out.push(`Agent (${b.question_timestamp}): ${b.question}`);
      out.push("");
      out.push(`${subjectName} (${b.answer_timestamps.join(", ")}): ${b.answer}`);
      out.push("");
    }
  }

  return out.join("\n");
}

export function renderFooter(cc: CitationReport): string {
  const line = cc.ok
    ? `Citation check: OK, ${cc.resolved.length} quotes resolved to transcript timestamps.`
    : `Citation check: FAILED (${cc.failures.length} failures).`;
  return `---\n${line}\n`;
}
