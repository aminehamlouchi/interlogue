import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Every tool over every transcript on disk, in-process, without throwing.
 * The server is the real one (src/index registration path is mirrored here),
 * driven over an in-memory MCP transport. Real transcripts under data/ run
 * where they exist; the fixture always runs.
 */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REAL_DATA = path.join(PACKAGE_ROOT, "data");
mkdirSync(REAL_DATA, { recursive: true });
const TEST_DATA_DIR = mkdtempSync(path.join(REAL_DATA, "test-tools-"));
process.env.INTERLOGUE_DATA_DIR = TEST_DATA_DIR;
process.env.INTERLOGUE_ALLOW_FALLBACK = "1";
after(() => rmSync(TEST_DATA_DIR, { recursive: true, force: true }));

const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const store = await import("../src/store/fileStore.js");
const tools = {
  brief: await import("../src/tools/brief.js"),
  approve: await import("../src/tools/approve_contact.js"),
  run: await import("../src/tools/run_interview.js"),
  draft: await import("../src/tools/draft_piece.js"),
  check: await import("../src/tools/check_citations.js"),
  generate: await import("../src/tools/generate_piece.js"),
  status: await import("../src/tools/status.js"),
  place: await import("../src/tools/place_call.js"),
  fetch: await import("../src/tools/fetch_transcript.js"),
};

async function pair() {
  const server = new McpServer({ name: "interlogue-test", version: "0" });
  for (const t of Object.values(tools)) t.register(server);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(ct);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as Array<{ type: string; text?: string }>).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    return { text, isError: r.isError === true };
  };
  return { call, close: () => Promise.all([ct.close(), st.close()]) };
}

/** Copy every real brief that has a transcript into the isolated test data dir. */
function importRealCases(): string[] {
  const ids: string[] = [];
  const tdir = path.join(REAL_DATA, "transcripts");
  if (!existsSync(tdir)) return ids;
  for (const f of readdirSync(tdir)) {
    if (!f.endsWith(".json")) continue;
    const id = f.replace(/\.json$/, "");
    const bf = path.join(REAL_DATA, "briefs", f);
    if (!existsSync(bf)) continue;
    for (const kind of ["briefs", "transcripts", "approvals", "calls"]) {
      const src = path.join(REAL_DATA, kind, f);
      if (existsSync(src)) {
        mkdirSync(path.join(TEST_DATA_DIR, kind), { recursive: true });
        const dst = path.join(TEST_DATA_DIR, kind, f);
        writeFileSync(dst, readFileSync(src, "utf8"));
      }
    }
    ids.push(id);
  }
  return ids;
}

test("a tool that throws returns an error result and the server keeps serving", async () => {
  const server = new McpServer({ name: "boom", version: "0" });
  const { z } = await import("zod");
  // Mirror the production wrapper from src/index.ts on this test server.
  const { withTiming } = await import("../src/index.js").catch(() => ({ withTiming: null as null | ((s: unknown) => void) }));
  if (withTiming) withTiming(server);
  server.registerTool("boom", { description: "throws", inputSchema: { x: z.string().optional() } }, async () => {
    throw new Error("kaboom");
  });
  server.registerTool("fine", { description: "ok", inputSchema: { x: z.string().optional() } }, async () => ({ content: [{ type: "text", text: "fine" }] }));
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(ct);
  const r = await client.callTool({ name: "boom", arguments: {} });
  assert.equal(r.isError, true);
  const text = (r.content as Array<{ text?: string }>)[0]?.text ?? "";
  assert.ok(/kaboom/.test(text) || /Error/.test(text), text);
  const ok = await client.callTool({ name: "fine", arguments: {} });
  assert.equal((ok.content as Array<{ text?: string }>)[0]?.text, "fine");
  await Promise.all([ct.close(), st.close()]);
});

test("the fixture spine runs through the real tools in-process without throwing", async () => {
  const { call, close } = await pair();
  const b = await call("brief", { subject_name: "Marisol Teague", subject_phone: "+1-502-555-0142", about: "founder of Ridgeline Provisions, about switching her order entry to Tallyhook, for Tallyhook's marketing team" });
  assert.equal(b.isError, false, b.text);
  const brief_id = b.text.match(/brf_[a-z0-9]+/)![0];
  assert.match(b.text, /Genre: customer case study/);
  const gate = await call("run_interview", { brief_id, fixture: "founder-case-study" });
  assert.equal(gate.isError, true);
  const a = await call("approve_contact", { brief_id, subject_name: "Marisol Teague", phone: "+1-502-555-0142", approved_by: "Test", consent_basis: "fixture", statement: "yes", confirm: true });
  assert.equal(a.isError, false, a.text);
  const r = await call("run_interview", { brief_id, fixture: "founder-case-study" });
  assert.equal(r.isError, false, r.text);
  const d = await call("draft_piece", { brief_id });
  assert.equal(d.isError, false, d.text);
  assert.match(d.text, /^# Reporter's packet/);
  const g = await call("generate_piece", { brief_id });
  assert.equal(g.isError, false, g.text);
  const piece_id = g.text.match(/"piece_id": "([^"]+)"/)![1];
  const c = await call("check_citations", { piece_id });
  assert.equal(c.isError, false, c.text);
  const s = await call("status", { brief_id });
  assert.equal(s.isError, false, s.text);
  const p = await call("place_call", { brief_id, confirm_dial: true });
  assert.ok(/not configured|ALREADY|REFUSED/.test(p.text), p.text);
  await close();
});

const realIds = importRealCases();
test(`every tool over every real transcript on disk (${realIds.length}) without an internal error`, { skip: realIds.length === 0 && "no real transcripts on this machine" }, async () => {
  const { call, close } = await pair();
  for (const brief_id of realIds) {
    for (const [name, args] of [
      ["status", { brief_id }],
      ["draft_piece", { brief_id }],
      ["generate_piece", { brief_id }],
      ["fetch_transcript", { brief_id, wait_secs: 0 }],
      ["place_call", { brief_id, confirm_dial: true }],
    ] as Array<[string, Record<string, unknown>]>) {
      const r = await call(name, args);
      assert.ok(!/INTERNAL ERROR/.test(r.text), `${name} on ${brief_id}: ${r.text.slice(0, 200)}`);
      if (name === "draft_piece" || name === "status") assert.equal(r.isError, false, `${name} on ${brief_id}: ${r.text.slice(0, 200)}`);
    }
    const g = await call("generate_piece", { brief_id });
    if (!g.isError) {
      const piece_id = g.text.match(/"piece_id": "([^"]+)"/)![1];
      const c = await call("check_citations", { piece_id });
      assert.equal(c.isError, false, `check on ${brief_id}: ${c.text.slice(0, 200)}`);
    }
  }
  await close();
});
