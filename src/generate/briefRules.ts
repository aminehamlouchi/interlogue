/**
 * Genre detection for a brief.
 *
 * A customer case study's subject is a customer: a user of the product at a
 * company that is not the client. When the subject's company is the client
 * or the product, the interview is the company talking about itself: a
 * founder story, with its own question plan. Nothing is refused; the plan
 * changes so the call never asks "Before <product>, how did <product> ...".
 */
import type { Genre } from "../types.js";
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

/** True when the subject's company is the client company or the product. */
export function subjectIsClient(b: BriefIdentity): boolean {
  return sameOrContains(b.subject_company, b.client_company) || sameOrContains(b.subject_company, b.client_product);
}

/**
 * The genre switch. A customer case study needs a customer at another
 * company; when the subject's company is the client or the product, the
 * piece is a founder story and gets the founder-story question plan.
 */
export function detectGenre(b: BriefIdentity): Genre {
  return subjectIsClient(b) ? "founder_story" : "customer_case_study";
}

export function genreLabel(g: Genre): string {
  return g === "founder_story" ? "founder story" : "customer case study";
}
