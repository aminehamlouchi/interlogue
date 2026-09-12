/**
 * Generic client: call one InterLogue tool over the real MCP stdio transport.
 *
 *   node dist/scripts/call-tool.js <tool> '<json args>' [--markdown-file <path>]
 *
 * --markdown-file reads a file and passes its contents as the "markdown"
 * argument, which is how a host-written piece is submitted to check_citations
 * from a shell. Exit code 1 when the tool returns isError.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, "..", "src", "index.js");

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const tool = argv[0];
  if (!tool) {
    console.log("usage: call-tool <tool> '<json args>' [--markdown-file <path>]");
    return 2;
  }
  let args: Record<string, unknown> = {};
  const rest = argv.slice(1);
  const mdIdx = rest.indexOf("--markdown-file");
  if (mdIdx >= 0) {
    const file = rest[mdIdx + 1];
    if (!file) {
      console.log("--markdown-file needs a path");
      return 2;
    }
    args.markdown = readFileSync(file, "utf8");
    rest.splice(mdIdx, 2);
  }
  if (rest[0]) args = { ...JSON.parse(rest[0]), ...args };

  const env: Record<string, string> = { ...getDefaultEnvironment() };
  if (process.env.INTERLOGUE_DATA_DIR) env.INTERLOGUE_DATA_DIR = process.env.INTERLOGUE_DATA_DIR;
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env, stderr: "pipe" });
  const client = new Client({ name: "interlogue-call-tool", version: "0.1.0" });
  await client.connect(transport);
  try {
    const res = await client.callTool({ name: tool, arguments: args });
    const content = (res.content ?? []) as Array<{ type: string; text?: string }>;
    console.log(content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n"));
    return res.isError === true ? 1 : 0;
  } finally {
    await transport.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.log(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
