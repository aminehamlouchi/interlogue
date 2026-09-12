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
import * as downloadRecording from "./tools/download_recording.js";
import * as generatePiece from "./tools/generate_piece.js";
import * as questionTemplates from "./tools/question_templates.js";
import * as runInterview from "./tools/run_interview.js";
import * as status from "./tools/status.js";

const TOOLS = [
  brief,
  approveContact,
  runInterview,
  generatePiece,
  checkCitations,
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

async function main(): Promise<void> {
  const server = new McpServer({ name: "interlogue", version: packageVersion() });
  for (const tool of TOOLS) tool.register(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`interlogue ${packageVersion()}: MCP server ready on stdio (${TOOLS.length} tools)`);
}

main().catch((e: unknown) => {
  console.error(`interlogue: failed to start: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
