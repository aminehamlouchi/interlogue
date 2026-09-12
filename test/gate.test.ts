import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

// Fresh data dir BEFORE the store is imported (DATA_DIR is fixed at import time).
// Test data stays inside app/ (data/ is gitignored) so no subject record, even a
// fictional one, is written outside the repo. Removed again when the file finishes.
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
mkdirSync(path.join(PACKAGE_ROOT, "data"), { recursive: true });
const TEST_DATA_DIR = mkdtempSync(path.join(PACKAGE_ROOT, "data", "test-gate-"));
process.env.INTERLOGUE_DATA_DIR = TEST_DATA_DIR;
after(() => rmSync(TEST_DATA_DIR, { recursive: true, force: true }));

const { saveApproval, saveBrief } = await import("../src/store/fileStore.js");
const { GateError, assertDialApproved, normalizePhone } = await import("../src/gate/dialGate.js");
const { buildQuestionPlan, emphasisFromAngle } = await import("../src/questionBank.js");
type Brief = import("../src/types.js").Brief;
type Approval = import("../src/types.js").Approval;

function makeBrief(id: string, phone: string): Brief {
  const angle = "a two-person team getting its Mondays back";
  const emphasis = emphasisFromAngle(angle);
  const base = {
    subject: { name: "Marisol Teague", phone, role: "founder", company: "Ridgeline Provisions" },
    client: { company: "Tallyhook", product: "Tallyhook" },
    topic: "order entry and fulfillment",
  };
  return {
    brief_id: id,
    created_at: new Date().toISOString(),
    genre: "customer_case_study",
    ...base,
    angle,
    content_needed: ["customer case study"],
    emphasis,
    question_plan: buildQuestionPlan(base, emphasis),
  };
}

function makeApproval(briefId: string, name: string, phone: string): Approval {
  return {
    brief_id: briefId,
    subject_name: name,
    phone,
    approved_by: "Amine Hamlouchi",
    approved_at: new Date().toISOString(),
    consent_basis: "test fixture",
    statement: "I approve.",
  };
}

test("normalizePhone keeps digits and a leading plus", () => {
  assert.equal(normalizePhone("+1-502-555-0142"), "+15025550142");
  assert.equal(normalizePhone("(502) 555 0142"), "5025550142");
  assert.equal(normalizePhone("  +1 502.555.0142 "), "+15025550142");
});

test("assertDialApproved throws GateError when there is no approval", async () => {
  await saveBrief(makeBrief("brf_gate_none", "+1-502-555-0142"));
  await assert.rejects(assertDialApproved("brf_gate_none"), (e: unknown) => {
    assert.ok(e instanceof GateError);
    assert.match((e as Error).message, /No human approval/);
    return true;
  });
});

test("assertDialApproved throws GateError when the brief does not exist", async () => {
  await assert.rejects(assertDialApproved("brf_gate_missing"), (e: unknown) => e instanceof GateError);
});

test("assertDialApproved passes after an approval with matching name and phone", async () => {
  await saveBrief(makeBrief("brf_gate_ok", "+1-502-555-0142"));
  // Different formatting and casing of the same person and number must still match.
  await saveApproval(makeApproval("brf_gate_ok", "  marisol   TEAGUE ", "+1 (502) 555-0142"));
  const approval = await assertDialApproved("brf_gate_ok");
  assert.equal(approval.brief_id, "brf_gate_ok");
  assert.equal(approval.approved_by, "Amine Hamlouchi");
});

test("assertDialApproved throws GateError when the phone differs", async () => {
  await saveBrief(makeBrief("brf_gate_phone", "+1-502-555-0142"));
  await saveApproval(makeApproval("brf_gate_phone", "Marisol Teague", "+1-502-555-0199"));
  await assert.rejects(assertDialApproved("brf_gate_phone"), (e: unknown) => {
    assert.ok(e instanceof GateError);
    const msg = (e as Error).message;
    assert.match(msg, /number ending 0199/);
    // Never more than the last four digits in a message.
    assert.doesNotMatch(msg, /555-0199|5550199/);
    return true;
  });
});

test("assertDialApproved throws GateError when the name differs", async () => {
  await saveBrief(makeBrief("brf_gate_name", "+1-502-555-0142"));
  await saveApproval(makeApproval("brf_gate_name", "Someone Else", "+1-502-555-0142"));
  await assert.rejects(assertDialApproved("brf_gate_name"), (e: unknown) => e instanceof GateError);
});
