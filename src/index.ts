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

/**
 * The fallback writer is registered only for the no-host judge run
 * (`npm run spine` sets INTERLOGUE_ALLOW_FALLBACK=1). Inside Claude the host
 * writes; the fallback must never be selectable there.
 */
const ALLOW_FALLBACK = process.env.INTERLOGUE_ALLOW_FALLBACK === "1";

const TOOLS = [
  brief,
  approveContact,
  runInterview,
  placeCall,
  fetchTranscript,
  draftPiece,
  checkCitations,
  ...(ALLOW_FALLBACK ? [generatePiece] : []),
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
 * Never crash. Every tool callback is wrapped: an exception becomes an error
 * result the host can read, and the process lives on. A timing line per call
 * goes to stderr (tool name, duration, outcome), which hosts capture in their
 * MCP log. No arguments and no subject data are ever logged.
 */
export function withTiming(server: McpServer): void {
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
        const message = e instanceof Error ? e.message : String(e);
        console.error(`interlogue: ${name} threw: ${message}`);
        return {
          content: [
            {
              type: "text",
              text: [
                `INTERNAL ERROR in ${name}: ${message}`,
                "The server is still running. Tell the user something went wrong on our side, then try the step again once; if it fails again, ask them to report it with the brief_id.",
              ].join("\n"),
            },
          ],
          isError: true,
        };
      } finally {
        console.error(`interlogue: ${name} ${Date.now() - started}ms ${outcome}`);
      }
    })) as typeof server.registerTool;
}

/** Process-level backstop: log and keep serving rather than die on a stray error. */
process.on("uncaughtException", (e) => {
  console.error(`interlogue: uncaught exception (kept running): ${e instanceof Error ? e.message : String(e)}`);
});
process.on("unhandledRejection", (e) => {
  console.error(`interlogue: unhandled rejection (kept running): ${e instanceof Error ? e.message : String(e)}`);
});

async function main(): Promise<void> {
  const server = new McpServer({ name: "interlogue", version: packageVersion() });
  withTiming(server);
  for (const tool of TOOLS) tool.register(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`interlogue ${packageVersion()}: MCP server ready on stdio (${TOOLS.length} tools${ALLOW_FALLBACK ? ", fallback writer enabled" : ""})`);
}

// Start only when run directly (not when imported by tests).
const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e: unknown) => {
    console.error(`interlogue: failed to start: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
