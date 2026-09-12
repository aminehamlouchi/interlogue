import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
mkdirSync(path.join(PACKAGE_ROOT, "data"), { recursive: true });
const TEST_DATA_DIR = mkdtempSync(path.join(PACKAGE_ROOT, "data", "test-phone-"));
process.env.INTERLOGUE_DATA_DIR = TEST_DATA_DIR;
after(() => rmSync(TEST_DATA_DIR, { recursive: true, force: true }));

const el = await import("../src/phone/elevenlabs.js");
const { buildDynamicVariables, normalizeTranscript } = await import("../src/phone/normalize.js");
const { detectConsent } = await import("../src/consent.js");
const { emphasisFromAngle, buildQuestionPlan } = await import("../src/questionBank.js");
const { formatTimestamp } = await import("../src/util.js");
const store = await import("../src/store/fileStore.js");
const { assertDialApproved, GateError } = await import("../src/gate/dialGate.js");

const core = {
  subject: { name: "Marisol Teague", phone: "+1-502-555-0142", role: "founder", company: "Ridgeline Provisions" },
  client: { company: "Tallyhook", product: "Tallyhook" },
  topic: "order entry and fulfillment",
};
const angle = "a two-person team getting its Mondays back from manual, error-prone order entry";
const emphasis = emphasisFromAngle(angle);
const brief = {
  brief_id: "brf_phone_test",
  created_at: new Date().toISOString(),
  genre: "customer_case_study" as const,
  ...core,
  angle,
  content_needed: ["customer case study"],
  emphasis,
  question_plan: buildQuestionPlan(core, emphasis),
};

test("getPhoneConfig reports missing names only and never a value", () => {
  const r = el.getPhoneConfig({});
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.missing, ["ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID", "ELEVENLABS_PHONE_NUMBER_ID"]);
  const ok = el.getPhoneConfig({ ELEVENLABS_API_KEY: "secret-value-x", ELEVENLABS_AGENT_ID: "a", ELEVENLABS_PHONE_NUMBER_ID: "p" });
  assert.equal(ok.ok, true);
  assert.ok(!JSON.stringify(r).includes("secret-value-x"));
});

test("the six dynamic variables come from the brief, question plan numbered", () => {
  const v = buildDynamicVariables(brief);
  assert.deepEqual(Object.keys(v).sort(), ["angle", "client_name", "genre", "question_plan", "subject_name", "subject_role"]);
  assert.equal(v.subject_name, "Marisol Teague");
  assert.equal(v.client_name, "Tallyhook");
  assert.equal(v.genre, "customer case study");
  assert.ok(v.question_plan.startsWith("1. "));
  assert.equal(v.question_plan.split("\n").length, brief.question_plan.length);
});

test("placeOutboundCall sends the verified payload and header, and never logs", async () => {
  const seen: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch: typeof el.placeOutboundCall extends (c: infer _C, p: infer _P, f?: infer F) => unknown ? F : never = async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ success: true, message: "ok", conversation_id: "conv_1", callSid: "CA1" }), { status: 200 });
  };
  const cfg = { apiKey: "secret-key", agentId: "agent_1", phoneNumberId: "pn_1", baseUrl: "https://example.test" };
  const res = await el.placeOutboundCall(cfg, { toNumber: "+15025550142", dynamicVariables: buildDynamicVariables(brief) }, fakeFetch);
  assert.equal(res.conversation_id, "conv_1");
  assert.equal(seen[0].url, "https://example.test/v1/convai/twilio/outbound-call");
  const headers = seen[0].init!.headers as Record<string, string>;
  assert.equal(headers["xi-api-key"], "secret-key");
  const body = JSON.parse(String(seen[0].init!.body));
  assert.equal(body.agent_id, "agent_1");
  assert.equal(body.agent_phone_number_id, "pn_1");
  assert.equal(body.to_number, "+15025550142");
  assert.equal(body.conversation_initiation_client_data.dynamic_variables.subject_name, "Marisol Teague");
});

test("a non-2xx from ElevenLabs becomes an ElevenLabsError carrying status and scrubbed detail", async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ detail: { status: "quota_exceeded", message: "no credits for +1 502 555 0142" } }), { status: 401 });
  const cfg = { apiKey: "k", agentId: "a", phoneNumberId: "p", baseUrl: "https://example.test" };
  await assert.rejects(
    () => el.placeOutboundCall(cfg, { toNumber: "+15025550142", dynamicVariables: {} }, fakeFetch as never),
    (e: unknown) => e instanceof el.ElevenLabsError && e.status === 401 && /quota_exceeded/.test(e.detail) && !e.detail.includes("555 0142"),
  );
});

test("normalizeTranscript maps roles, drops empty messages, keeps real timestamps, and the consent check runs on it", () => {
  const details = {
    conversation_id: "conv_1",
    status: "done" as const,
    transcript: [
      { role: "agent" as const, message: "Hi, this is the InterLogue interviewer calling for Tallyhook. I'm an AI, not a person, and I'd like to record this call. Is that okay with you?", time_in_call_secs: 0 },
      { role: "user" as const, message: "Yes, that's fine.", time_in_call_secs: 9 },
      { role: "agent" as const, message: null, time_in_call_secs: 10 },
      { role: "agent" as const, message: "Great. Tell me about the business.", time_in_call_secs: 11 },
      { role: "user" as const, message: "  We sell   cheese. ", time_in_call_secs: 15 },
    ],
    metadata: { start_time_unix_secs: 1757600000, call_duration_secs: 20, cost: 12, cost_fiat: 0.05 },
  };
  const raw = normalizeTranscript(details);
  assert.equal(raw.length, 4);
  assert.deepEqual(raw.map((t) => t.speaker), ["agent", "subject", "agent", "subject"]);
  assert.equal(raw[3].text, "We sell cheese.");
  const turns = raw.map((t, index) => ({ index, ...t, timestamp: formatTimestamp(t.time_in_call_secs) }));
  assert.equal(turns[1].timestamp, "00:09");
  const c = detectConsent(turns);
  assert.equal(c.ai_disclosed, true);
  assert.equal(c.recording_permission_asked, true);
  assert.equal(c.recording_permission_granted, true);
});

test("the phone path is behind the same gate: no approval, no dial", async () => {
  await store.saveBrief(brief);
  await assert.rejects(() => assertDialApproved(brief.brief_id), (e: unknown) => e instanceof GateError);
  await store.saveApproval({ brief_id: brief.brief_id, subject_name: "Marisol Teague", phone: "+1 (502) 555-0142", approved_by: "Tester", approved_at: new Date().toISOString(), consent_basis: "test", statement: "approved" });
  const a = await assertDialApproved(brief.brief_id);
  assert.equal(a.approved_by, "Tester");
});

test("call records hold only the last four digits", async () => {
  await store.saveCall({
    brief_id: brief.brief_id,
    conversation_id: "conv_1",
    call_sid: null,
    to_number_last4: "0142",
    placed_at: new Date().toISOString(),
    placed_under_approval: { approved_by: "Tester", approved_at: new Date().toISOString() },
    dynamic_variables: buildDynamicVariables(brief),
    status: "placed",
  });
  const rec = await store.loadCall(brief.brief_id);
  assert.ok(rec);
  assert.ok(!JSON.stringify(rec).includes("5550142"));
  assert.equal(rec!.to_number_last4, "0142");
});

const { stripStageTags } = await import("../src/phone/normalize.js");
const { waitForConversation } = await import("../src/phone/waitForConversation.js");

test("stage-direction tags are stripped from agent turns only, using real tagged turns from tonight", () => {
  const real = "[surprised] I'm sorry, but I need to stop you there. [serious] My very first words must be the recording consent request, ...";
  assert.equal(stripStageTags(real), "I'm sorry, but I need to stop you there. My very first words must be the recording consent request, ...");
  assert.equal(stripStageTags("[professional] Great, thank you Amine. To start, can you tell me a little about InterLogue and what you do there?"), "Great, thank you Amine. To start, can you tell me a little about InterLogue and what you do there?");
  const details = {
    conversation_id: "c",
    status: "done" as const,
    transcript: [
      { role: "agent" as const, message: "[patient] No problem at all, I'll hold while you check.", time_in_call_secs: 6 },
      { role: "user" as const, message: "[laughs] I said [the usual] and he knew.", time_in_call_secs: 9 },
    ],
  };
  const turns = normalizeTranscript(details);
  assert.equal(turns[0].text, "No problem at all, I'll hold while you check.");
  assert.equal(turns[1].text, "[laughs] I said [the usual] and he knew.", "subject turns are never touched");
});

test("waitForConversation returns within the bound, reports progress, and stops on abort", async () => {
  let calls = 0;
  const pending = { conversation_id: "c", status: "in-progress" as const, transcript: [] };
  const done = { conversation_id: "c", status: "done" as const, transcript: [] };
  const progress: number[] = [];
  const t0 = Date.now();
  const r1 = await waitForConversation({ getDetails: async () => (++calls, pending), waitMs: 700, pollMs: 200, onProgress: (e) => void progress.push(e) });
  const took = Date.now() - t0;
  assert.equal(r1.details, null);
  assert.equal(r1.aborted, false);
  assert.ok(took < 1100, `bounded wait overran: ${took}ms`);
  assert.ok(progress.length >= 2, "progress should be reported on each poll");
  calls = 0;
  const r2 = await waitForConversation({ getDetails: async () => (++calls >= 2 ? done : pending), waitMs: 5000, pollMs: 50 });
  assert.equal(r2.details?.status, "done");
  assert.equal(r2.polls, 2);
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 120);
  const t1 = Date.now();
  const r3 = await waitForConversation({ getDetails: async () => pending, waitMs: 5000, pollMs: 2000, signal: ac.signal });
  assert.equal(r3.aborted, true);
  assert.ok(Date.now() - t1 < 1000, "abort should end the wait immediately");
});
