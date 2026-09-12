#!/usr/bin/env node
/**
 * InterLogue MCP server entry point. The only entry point.
 *
 * Registers every tool under src/tools/ and serves them over stdio.
 * stdout belongs to the transport: nothing else may write to it. The single
 * startup line goes to stderr and carries no subject data.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as approveContact from "./tools/approve_contact.js";
import * as brief from "./tools/brief.js";
import * as checkCitations from "./tools/check_citations.js";
import * as discoverContacts from "./tools/discover_contacts.js";
import * as draftPiece from "./tools/draft_piece.js";
import * as downloadRecording from "./tools/download_recording.js";
import * as fetchTranscript from "./tools/fetch_transcript.js";
import * as generatePiece from "./tools/generate_piece.js";
import * as placeCall from "./tools/place_call.js";
import * as questionTemplates from "./tools/question_templates.js";
import * as runInterview from "./tools/run_interview.js";
import * as status from "./tools/status.js";

const TOOLS = [
  brief,
  approveContact,
  runInterview,
  placeCall,
  fetchTranscript,
  draftPiece,
  checkCitations,
  generatePiece,
  status,
  discoverContacts,
  questionTemplates,
  downloadRecording,
];

/** Version from package.json (two levels up from dist/src/index.js), else 0.1.0. */
function packageVersion(): string {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : "0.1.0";
  } catch {
    return "0.1.0";
  }
}

/**
 * Timing line per tool call on stderr: tool name, duration, ok/error. Hosts
 * such as Claude Desktop capture stderr in their MCP log, which is how the
 * longest single call is measured against the host's timeout. No arguments
 * and no subject data are ever logged.
 */
function withTiming(server: McpServer): void {
  const original = server.registerTool.bind(server);
  // The generic signature is preserved by the cast; only the callback is wrapped.
  (server as unknown as { registerTool: unknown }).registerTool = ((name: string, config: unknown, cb: (...a: unknown[]) => Promise<unknown>) =>
    (original as unknown as (n: string, c: unknown, f: unknown) => unknown)(name, config, async (...args: unknown[]) => {
      const started = Date.now();
      let outcome = "ok";
      try {
        const result = (await cb(...args)) as { isError?: boolean };
        if (result && result.isError) outcome = "refused";
        return result;
      } catch (e) {
        outcome = "error";
        throw e;
      } finally {
        console.error(`interlogue: ${name} ${Date.now() - started}ms ${outcome}`);
      }
    })) as typeof server.registerTool;
}

async function main(): Promise<void> {
  const server = new McpServer({ name: "interlogue", version: packageVersion() });
  withTiming(server);
  for (const tool of TOOLS) tool.register(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`interlogue ${packageVersion()}: MCP server ready on stdio (${TOOLS.length} tools)`);
}

main().catch((e: unknown) => {
  console.error(`interlogue: failed to start: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
