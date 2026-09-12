/**
 * Brief validation for the one genre in this build.
 *
 * A customer case study's subject is a customer: a user of the product at a
 * company that is not the client. When the subject's company is the client
 * or the product, the interview is the company talking about itself, which
 * is a founder story, a different genre that is not in this build. The
 * question plan would also ask "Before <product>, how did <product> handle
 * ..." which is absurd on a call.
 */
import { normalizeWhitespace } from "../util.js";

export interface BriefIdentity {
  subject_company: string;
  client_company: string;
  client_product: string;
}

function key(s: string): string {
  return normalizeWhitespace(s)
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|co|corp|corporation|company|the)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sameOrContains(a: string, b: string): boolean {
  const ka = key(a);
  const kb = key(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const shorter = ka.length <= kb.length ? ka : kb;
  const longer = shorter === ka ? kb : ka;
  return shorter.length >= 4 && longer.split(" ").join(" ").includes(shorter);
}

/** Returns the refusal lines, or null when the brief is a valid customer case study. */
export function refuseCaseStudyBrief(b: BriefIdentity): string[] | null {
  const hitsCompany = sameOrContains(b.subject_company, b.client_company);
  const hitsProduct = sameOrContains(b.subject_company, b.client_product);
  if (!hitsCompany && !hitsProduct) return null;
  const what = hitsCompany ? `the client company "${b.client_company}"` : `the product "${b.client_product}"`;
  return [
    "BRIEF REFUSED: the subject's company is the client.",
    `Subject company "${b.subject_company}" matches ${what}. A customer case study's subject must be a customer: a user of the product at a different company, whose story is about using it.`,
    `Interviewing ${b.client_company}'s own founder or team about ${b.client_product} is a founder story. That is a different genre and it is not in this build (see question_templates).`,
    `Fix: name a customer of ${b.client_product} as the subject, with their own company, and keep ${b.client_company} as the client. Nothing was saved.`,
    "Next: brief again with a customer as the subject.",
  ];
}
