/**
 * End-to-end proof of the text-only spine over the real MCP transport.
 *
 * Spawns the server (dist/src/index.js), then calls in order:
 *   brief -> [gate check] -> approve_contact -> run_interview -> generate_piece -> check_citations
 * using fixtures/founder-case-study.*.json. No phone call is placed.
 * Exits 1 if any step returns isError, or if run_interview is NOT refused
 * before approval.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

// This file compiles to dist/scripts/run-spine.js.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..", "..");
const SERVER = path.resolve(HERE, "..", "src", "index.js");
const FIXTURE = "founder-case-study";
const STEPS = 5;

interface BriefFixture {
  subject_name: string;
  subject_phone: string;
  subject_role: string;
  subject_company: string;
  client_company: string;
  client_product: string;
  topic: string;
  angle: string;
  content_needed: string[];
  approval: { approved_by: string; consent_basis: string; statement: string };
}

interface Result {
  text: string;
  isError: boolean;
}

class StepFailed extends Error {}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<Result> {
  const res = await client.callTool({ name, arguments: args });
  const content = (res.content ?? []) as Array<{ type: string; text?: string }>;
  const text = content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
  return { text, isError: res.isError === true };
}

function pickLine(text: string, key: string): string {
  const m = text.match(new RegExp(`^${key}:\\s*(\\S+)`, "m"));
  if (!m) throw new StepFailed(`Could not find "${key}:" in the tool output:\n${text}`);
  return m[1];
}

function pickJson(text: string, key: string): string {
  const m = text.match(new RegExp(`"${key}":\\s*"([^"]+)"`));
  if (!m) throw new StepFailed(`Could not find "${key}" in the tool output:\n${text}`);
  return m[1];
}

async function main(): Promise<number> {
  const fixture = JSON.parse(
    readFileSync(path.join(PACKAGE_ROOT, "fixtures", `${FIXTURE}.brief.json`), "utf8"),
  ) as BriefFixture;

  // Give the server only the SDK's safe default environment plus the data dir override.
  // Nothing else from this shell reaches the child.
  const env: Record<string, string> = { ...getDefaultEnvironment() };
  if (process.env.INTERLOGUE_DATA_DIR) env.INTERLOGUE_DATA_DIR = process.env.INTERLOGUE_DATA_DIR;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env,
    stderr: "inherit",
  });
  const client = new Client({ name: "interlogue-spine", version: "0.1.0" });
  await client.connect(transport);

  let failed = false;
  const step = async (n: number, name: string, args: Record<string, unknown>): Promise<Result> => {
    const r = await call(client, name, args);
    if (r.isError) {
      failed = true;
      console.log(`[${n}/${STEPS}] ${name} -> ERROR`);
      console.log(r.text);
      throw new StepFailed(`${name} returned isError`);
    }
    return r;
  };

  try {
    // 1. brief
    const b = await step(1, "brief", {
      subject_name: fixture.subject_name,
      subject_phone: fixture.subject_phone,
      subject_role: fixture.subject_role,
      subject_company: fixture.subject_company,
      client_company: fixture.client_company,
      client_product: fixture.client_product,
      topic: fixture.topic,
      angle: fixture.angle,
      content_needed: fixture.content_needed,
    });
    const brief_id = pickLine(b.text, "brief_id");
    console.log(`[1/${STEPS}] brief -> ${brief_id}`);

    // Gate demonstration: run_interview must be refused before any approval exists.
    const gate = await call(client, "run_interview", { brief_id, fixture: FIXTURE });
    if (gate.isError) {
      console.log("[gate] run_interview refused before approval: OK");
    } else {
      failed = true;
      console.log("[gate] run_interview was NOT refused before approval: FAIL");
      console.log(gate.text);
      throw new StepFailed("gate did not hold");
    }

    // 2. approve_contact
    const a = await step(2, "approve_contact", {
      brief_id,
      subject_name: fixture.subject_name,
      phone: fixture.subject_phone,
      approved_by: fixture.approval.approved_by,
      consent_basis: fixture.approval.consent_basis,
      statement: fixture.approval.statement,
      confirm: true,
    });
    console.log(`[2/${STEPS}] approve_contact -> ${a.text.split("\n")[0]}`);

    // 3. run_interview (text-only, from the fixture)
    const r = await step(3, "run_interview", { brief_id, fixture: FIXTURE });
    const transcript_id = pickLine(r.text, "transcript_id");
    console.log(`[3/${STEPS}] run_interview -> ${transcript_id}`);

    // 4. generate_piece
    const g = await step(4, "generate_piece", { brief_id });
    const piece_id = pickJson(g.text, "piece_id");
    console.log(`[4/${STEPS}] generate_piece -> ${piece_id}`);
    console.log("");
    console.log(g.text);
    console.log("");

    // 5. check_citations
    const c = await step(5, "check_citations", { piece_id });
    console.log(`[5/${STEPS}] check_citations -> ${c.text.split("\n")[0]}`);
    console.log("");
    console.log(c.text);
  } catch (e) {
    failed = true;
    if (!(e instanceof StepFailed)) console.error(`spine: ${e instanceof Error ? e.message : String(e)}`);
    else if (!e.message.endsWith("returned isError") && e.message !== "gate did not hold") console.error(`spine: ${e.message}`);
  } finally {
    await client.close();
  }

  console.log(failed ? "SPINE: FAILED" : "SPINE: OK (no call was placed)");
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`spine: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
