/**
 * One sentence in, a brief out. The user types who the subject is and what
 * the piece is about; this fills role, company, client, product, topic and
 * angle with what the sentence says, or a sensible default, and reports
 * every choice so the result can say what was chosen. Deterministic, no
 * model.
 */
export interface InferInput {
  subject_name: string;
  about: string;
  subject_role?: string;
  subject_company?: string;
  client_company?: string;
  client_product?: string;
  topic?: string;
  angle?: string;
}

export interface InferredBrief {
  subject_role: string;
  subject_company: string;
  client_company: string;
  client_product: string;
  topic: string;
  angle: string;
  /** One line per field that was inferred or defaulted, for the result text. */
  chosen: string[];
}

const ROLE_WORDS =
  "founder|co-founder|cofounder|ceo|cto|coo|cfo|owner|co-owner|president|director|board member|partner|principal|head of [a-z]+(?: [a-z]+)?|vp of [a-z]+|[a-z]+ manager|manager|engineer|developer|designer|chef|baker|farmer|teacher|nurse|doctor|lawyer|consultant|coach|organizer|student|business development|sales|marketing|operations|growth|product|customer success|support";

/** Instructions to the tool that are not about the person: how many questions, and to call now. */
const CONTROL_PHRASES = [
  /,?\s*\b(?:\d{1,2}|one|two|three|four|five|six)\s+questions?(?:\s+only|\s+max)?\b/gi,
  /,?\s*\b(?:and\s+)?(?:please\s+)?(?:call|phone|ring|dial)\s+(?:him|her|them|me)(?:\s+(?:now|right now|today|live))?\b/gi,
  /,?\s*\b(?:and\s+)?(?:do it|start|go)\s+now\b/gi,
];

export function stripControlPhrases(about: string): string {
  let out = about;
  for (const re of CONTROL_PHRASES) out = out.replace(re, "");
  return out.replace(/\s+,/g, ",").replace(/,\s*,/g, ",").replace(/\s+/g, " ").replace(/[\s,]+$/g, "").trim();
}

const NAMEISH = "[A-Z][\\w&'.-]*(?:\\s+(?:of|the|and|&)\\s+[A-Z][\\w&'.-]*|\\s+[A-Z][\\w&'.-]*)*";

function clean(s: string): string {
  return s.replace(/\s+/g, " ").replace(/[\s,.;:]+$/g, "").trim();
}

export function inferBrief(input: InferInput): InferredBrief {
  const about = clean(stripControlPhrases(input.about));
  const chosen: string[] = [];

  // Role and company: "founder of Ridgeline Provisions", "who runs a bakery", "at Acme".
  let role = input.subject_role ? clean(input.subject_role) : "";
  let company = input.subject_company ? clean(input.subject_company) : "";
  const roleRe = new RegExp(`\\b(${ROLE_WORDS})\\b(?:\\s+(?:of|at|for)\\s+(${NAMEISH}))?`, "i");
  const rm = about.match(roleRe);
  if (!role && rm) {
    role = rm[1].toLowerCase();
    chosen.push(`role: "${role}" (from the sentence)`);
  }
  if (!company && rm && rm[2]) {
    company = clean(rm[2]).replace(/'s$/i, "");
    chosen.push(`company: "${company}" (from the sentence)`);
  }
  if (!company) {
    const runs = about.match(/\bwho\s+(?:runs|owns|leads|started|founded)\s+((?:(?:an?|the)\s+)?[^,.;]+?)(?=[,.;]|\s+(?:about|for|who|and)\b|$)/i);
    if (runs) {
      company = clean(runs[1]);
      if (!role) {
        role = "founder";
        chosen.push(`role: "founder" (the sentence says they run it)`);
      }
      chosen.push(`company: "${company}" (from the sentence)`);
    }
  }
  if (!company) {
    const at = about.match(new RegExp(`\\bat\\s+(${NAMEISH})`));
    if (at) {
      company = clean(at[1]);
      chosen.push(`company: "${company}" (from "at ${company}")`);
    }
  }
  if (!role) {
    role = "the subject";
    chosen.push(`role: not given, using "the subject"`);
  }
  if (!company) {
    company = `${input.subject_name}'s organization`;
    chosen.push(`company: not given, using "${company}"`);
  }

  // Client: "for Tallyhook", "for Tallyhook's marketing team".
  let client = input.client_company ? clean(input.client_company) : "";
  if (!client) {
    const fm = [...about.matchAll(new RegExp(`\\bfor\\s+(${NAMEISH})(?:'s)?`, "g"))];
    const last = fm[fm.length - 1];
    if (last) {
      client = clean(last[1].replace(/'s$/i, "").replace(/\s+(marketing|team|blog|site|website|customers|newsletter|case study)$/i, ""));
      chosen.push(`client: "${client}" (from "for ${client}")`);
    }
  }
  if (!client) {
    client = company;
    chosen.push(`client: not given, using the subject's own company, so this is a founder story`);
  }

  // Product: "switched to Tallyhook", "using Tallyhook"; default the client.
  let product = input.client_product ? clean(input.client_product) : "";
  if (!product) {
    const pm = about.match(new RegExp(`\\b(?:switch(?:ed|ing)?\\s+to|moved\\s+to|adopt(?:ed|ing)?|started\\s+using|using|uses|use|bought|chose)\\s+(${NAMEISH})`));
    if (pm) {
      product = clean(pm[1]);
      chosen.push(`product: "${product}" (from the sentence)`);
    }
  }
  if (!product) {
    product = client;
    chosen.push(`product: not given, using the client name "${product}"`);
  }

  // Topic: after "about", up to " for ".
  let topic = input.topic ? clean(input.topic) : "";
  if (!topic) {
    const tm = about.match(/\babout\s+(.+?)(?=\s+for\s+[A-Z]|$)/i);
    if (tm) {
      topic = clean(tm[1]);
      chosen.push(`topic: "${topic}" (from the sentence)`);
    }
  }
  if (!topic) {
    topic = about.replace(/^(interview|talk to|call|phone)\s+[^,]+,?\s*/i, "") || about;
    topic = clean(topic) || "their work";
    chosen.push(`topic: not given, using "${topic}"`);
  }

  let angle = input.angle ? clean(input.angle) : "";
  if (!angle) {
    angle = about;
    chosen.push("angle: not given, using the sentence itself for emphasis");
  }

  return { subject_role: role, subject_company: company, client_company: client, client_product: product, topic, angle, chosen };
}
