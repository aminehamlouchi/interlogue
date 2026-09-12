/**
 * Shared shape and helpers for MCP tool text responses.
 *
 * Every tool returns readable text: a short heading line, the facts, then a
 * "Next:" line naming the tool to call next. Refusals set isError.
 * Phone numbers are never echoed beyond their last four digits.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** What every tool handler returns. Aliased to the SDK's result type so handlers type-check against registerTool. */
export type ToolText = CallToolResult;

type Line = string | null | undefined | false;

function join(lines: Line[]): string {
  return lines.filter((l): l is string => typeof l === "string").join("\n");
}

/** A normal (non-error) text response. Falsy lines are skipped. */
export function reply(lines: Line[]): ToolText {
  return { content: [{ type: "text", text: join(lines) }] };
}

/** A refusal. Same shape, isError set. */
export function refuse(lines: Line[]): ToolText {
  return { content: [{ type: "text", text: join(lines) }], isError: true };
}

/** Last four digits of a phone number, for messages. Never echo more than this. */
export function lastFour(phone: string): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `ending ${digits.slice(-4)}` : "(no readable digits)";
}

/**
 * Mask phone-shaped digit runs inside free text (an approver's statement,
 * a consent basis) down to their last four digits for display. The stored
 * record is untouched; only what is echoed back is redacted.
 */
export function redactPhones(text: string): string {
  return String(text ?? "").replace(/\+?\d[\d\s().-]{5,}\d/g, (m) => {
    const digits = m.replace(/\D/g, "");
    return digits.length >= 7 ? `[number ending ${digits.slice(-4)}]` : m;
  });
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
