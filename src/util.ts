import { randomBytes } from "node:crypto";

/** Short, sortable id: prefix + base36 time + 6 random chars. */
export function newId(prefix: string): string {
  const t = Date.now().toString(36);
  const r = randomBytes(4).toString("hex").slice(0, 6);
  return `${prefix}_${t}${r}`;
}

/** Seconds into call -> "MM:SS" (or "H:MM:SS" past an hour). */
export function formatTimestamp(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(r).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Collapse whitespace runs and trim. Used before every substring comparison. */
export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Straighten curly quotes so a quote copied from prose still matches the transcript. */
export function normalizeQuotes(s: string): string {
  return s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"');
}

export function normalizeForMatch(s: string): string {
  return normalizeWhitespace(normalizeQuotes(s));
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "at", "by",
  "from", "is", "are", "was", "were", "be", "been", "it", "its", "this", "that",
  "as", "we", "our", "you", "your", "they", "their", "i", "my", "me", "us", "so",
  "do", "did", "does", "have", "has", "had", "not", "no", "yes", "but", "if",
  "then", "than", "what", "how", "why", "when", "where", "who", "can", "could",
  "would", "should", "will", "just", "about", "into", "out", "up", "down", "over",
  "there", "here", "them", "him", "her", "his", "he", "she", "one", "any", "some",
  "all", "very", "really", "like", "get", "got", "go", "went", "thing", "things",
]);

/** Lowercase word tokens, punctuation stripped, stopwords removed, light stemming. */
export function tokenize(s: string): string[] {
  return normalizeQuotes(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

/** Very light stemmer: enough to make "spreadsheets" meet "spreadsheet" and "saving" meet "save". */
export function stem(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("es") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Fraction of `a`'s distinct tokens that also appear in `b`. 0 when `a` is empty. */
export function overlap(a: string[], b: string[]): number {
  const A = new Set(a);
  if (A.size === 0) return 0;
  const B = new Set(b);
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / A.size;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Last word of a name, used for second-reference attribution ("Teague said"). */
export function lastName(fullName: string): string {
  const parts = normalizeWhitespace(fullName).split(" ");
  return parts[parts.length - 1] ?? fullName;
}
