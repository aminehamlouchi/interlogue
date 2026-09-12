import assert from "node:assert/strict";
import test from "node:test";
import { detectGenre } from "../src/generate/briefRules.js";
import { inferBrief } from "../src/generate/inferBrief.js";
import { buildQuestionPlan, emphasisFromAngle } from "../src/questionBank.js";

test("one sentence with a client becomes a customer case study with the right fields", () => {
  const r = inferBrief({ subject_name: "Marisol Teague", about: "founder of Ridgeline Provisions, about switching her order entry to Tallyhook, for Tallyhook's marketing team" });
  assert.equal(r.subject_role, "founder");
  assert.equal(r.subject_company, "Ridgeline Provisions");
  assert.equal(r.client_company, "Tallyhook");
  assert.equal(r.client_product, "Tallyhook");
  assert.match(r.topic, /switching her order entry to Tallyhook/);
  assert.equal(detectGenre({ subject_company: r.subject_company, client_company: r.client_company, client_product: r.client_product }), "customer_case_study");
  assert.ok(r.chosen.some((c) => c.startsWith("client:")));
});

test("one sentence with no client becomes a founder story with stated defaults", () => {
  const r = inferBrief({ subject_name: "Jane Doe", about: "who runs a small bakery in Louisville, about how she started it" });
  assert.equal(r.subject_role, "founder");
  assert.equal(r.subject_company, "a small bakery in Louisville");
  assert.equal(r.client_company, r.subject_company);
  assert.equal(detectGenre({ subject_company: r.subject_company, client_company: r.client_company, client_product: r.client_product }), "founder_story");
  assert.ok(r.chosen.some((c) => c.includes("founder story")));
  assert.ok(r.angle.length > 0);
});

test("a bare sentence still yields a complete brief with every default named", () => {
  const r = inferBrief({ subject_name: "Sam Park", about: "the hackathon" });
  assert.equal(r.subject_role, "the subject");
  assert.equal(r.subject_company, "Sam Park's organization");
  assert.equal(r.client_company, r.subject_company);
  assert.equal(r.client_product, r.client_company);
  assert.ok(r.topic.length > 0);
  assert.ok(r.chosen.length >= 5, r.chosen.join(" | "));
});

test("explicit fields win over inference", () => {
  const r = inferBrief({ subject_name: "X", about: "founder of A, for B", subject_company: "C", client_company: "D", topic: "T", angle: "G" });
  assert.equal(r.subject_company, "C");
  assert.equal(r.client_company, "D");
  assert.equal(r.topic, "T");
  assert.equal(r.angle, "G");
});

test("the founder-story plan keeps the seven beats and asks about what they built", () => {
  const core = { subject: { name: "Jane Doe", phone: "+15025550100", role: "founder", company: "Bakery" }, client: { company: "Bakery", product: "Bakery" }, topic: "how she started" };
  const plan = buildQuestionPlan(core, emphasisFromAngle("how she started and what changed"), "founder_story");
  const beats = new Set(plan.map((q) => q.beat));
  for (const b of ["context", "problem", "search", "decision", "implementation", "results", "reflection"]) assert.ok(beats.has(b as never), b);
  assert.ok(plan.some((q) => /What did you build/.test(q.text)));
  assert.ok(plan.every((q) => !/Before .* how did/.test(q.text)));
});

test("a sentence that says how many questions cuts the plan to the beats the angle weights most, context first", async () => {
  const { questionLimitFrom } = await import("../src/questionBank.js");
  assert.equal(questionLimitFrom("about the hackathon build, three questions, and call him now"), 3);
  assert.equal(questionLimitFrom("2 questions only"), 2);
  assert.equal(questionLimitFrom("no count here"), undefined);
  const core = { subject: { name: "A", phone: "+15025550100", role: "founder", company: "Co" }, client: { company: "X", product: "X" }, topic: "results" };
  const emphasis = emphasisFromAngle("what changed and the results since");
  const plan = buildQuestionPlan(core, emphasis, "customer_case_study", 3);
  assert.equal(plan.length, 3);
  assert.equal(plan[0].beat, "context");
  assert.ok(plan.some((q) => q.beat === "results"));
  assert.ok(plan.every((q) => !q.follow_up));
});

test("question counts and call instructions do not leak into topic or angle, and business roles are recognised", async () => {
  const r = inferBrief({ subject_name: "Ahmed Khalifa", about: "business development at InterLogue, about the hackathon build, three questions, and call him now" });
  assert.equal(r.subject_role, "business development");
  assert.equal(r.subject_company, "InterLogue");
  assert.equal(r.topic, "the hackathon build");
  assert.ok(!/questions|call him/.test(r.angle), r.angle);
});
