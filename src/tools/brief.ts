/**
 * Tool: brief. Step 1 of the spine.
 * Records the assignment the way an editor briefs a reporter, derives the
 * angle's emphasis and the question plan, and saves the brief.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildQuestionPlan, emphasisFromAngle } from "../questionBank.js";
import { errorMessage, lastFour, refuse, reply } from "../respond.js";
import { tokenize } from "../util.js";
import { refuseCaseStudyBrief } from "../generate/briefRules.js";
import { saveBrief } from "../store/fileStore.js";
import { BEAT_ORDER, type Brief } from "../types.js";
import { newId, normalizeWhitespace, nowIso } from "../util.js";

const inputSchema = {
  subject_name: z.string().min(1).describe("Full name of the person to interview, e.g. the founder or customer."),
  subject_phone: z.string().min(4).describe("The subject's phone number. It is stored only in the brief and approval records and never echoed in full."),
  subject_role: z.string().min(1).describe("The subject's role, e.g. \"founder\" or \"head of operations\"."),
  subject_company: z.string().min(1).describe("The subject's company."),
  client_company: z.string().min(1).describe("Who commissioned the piece (the marketing team's company)."),
  client_product: z.string().min(1).describe("The product the case study is about."),
  topic: z.string().min(1).describe("The subject matter as a noun phrase, e.g. \"order entry and fulfillment\"."),
  angle: z.string().min(1).describe("The editor's angle, e.g. \"a two-person team getting its Mondays back from manual order entry\". Shapes which questions are asked and what is emphasized. Never shapes what the subject is portrayed as having said."),
  content_needed: z.array(z.string().min(1)).default(["customer case study", "pull quotes"]).describe("What the client needs back."),
  genre: z.literal("customer_case_study").default("customer_case_study").describe("Only customer_case_study exists in this build."),
};

export function register(server: McpServer): void {
  server.registerTool(
    "brief",
    {
      title: "Brief the reporter",
      description:
        "Start here. Brief InterLogue the way an editor briefs a reporter: who the subject is, which client and product the case study is for, the topic, and the angle. " +
        "The angle decides which questions get asked and what the piece emphasizes; it never changes what the subject is portrayed as having said. " +
        "Saves the brief and returns a brief_id plus the question plan. Nobody is contacted at this step. Next step: approve_contact.",
      inputSchema,
    },
    async (input) => {
      const refusal = refuseCaseStudyBrief({
        subject_company: input.subject_company,
        client_company: input.client_company,
        client_product: input.client_product,
      });
      if (refusal) return refuse(refusal);
      const emphasis = emphasisFromAngle(input.angle);
      const brief: Brief = {
        brief_id: newId("brf"),
        created_at: nowIso(),
        genre: input.genre,
        subject: {
          name: normalizeWhitespace(input.subject_name),
          phone: input.subject_phone.trim(),
          role: normalizeWhitespace(input.subject_role),
          company: normalizeWhitespace(input.subject_company),
        },
        client: {
          company: normalizeWhitespace(input.client_company),
          product: normalizeWhitespace(input.client_product),
        },
        topic: normalizeWhitespace(input.topic),
        angle: normalizeWhitespace(input.angle),
        content_needed: input.content_needed.map(normalizeWhitespace),
        emphasis,
        question_plan: [],
      };
      brief.question_plan = buildQuestionPlan(brief, emphasis);

      try {
        await saveBrief(brief);
      } catch (e) {
        return refuse(["BRIEF NOT SAVED", errorMessage(e), "Next: fix the input and call brief again."]);
      }

      const emphasisLine = BEAT_ORDER.map((b) => `${b} ${emphasis[b].toFixed(2)}`).join(" · ");
      const planLines = brief.question_plan.map(
        (q, i) => `  ${i + 1}. ${q.id} [${q.beat}, ${q.priority}${q.follow_up ? ", follow-up" : ""}] ${q.text}`,
      );

      const productTokens = new Set(tokenize(brief.client.product));
      const topicHitsProduct = tokenize(brief.topic).some((t) => productTokens.has(t));
      const topicNote = topicHitsProduct
        ? `NOTE: the topic mentions the product, so the question "Before ${brief.client.product}, how did ${brief.subject.company} handle ${brief.topic}?" will sound odd on the call. Prefer a topic that names the process itself, for example "order entry" rather than "order entry with ${brief.client.product}". Re-run brief to change it.`
        : "";

      return reply([
        `BRIEF SAVED: ${brief.brief_id}`,
        topicNote,
        `brief_id: ${brief.brief_id}`,
        `Subject: ${brief.subject.name}, ${brief.subject.role}, ${brief.subject.company} (phone ${lastFour(brief.subject.phone)})`,
        `Client: ${brief.client.company} / product ${brief.client.product}`,
        `Topic: ${brief.topic}`,
        `Angle: ${brief.angle}`,
        `Content needed: ${brief.content_needed.join(", ")}`,
        `Genre: ${brief.genre}`,
        "",
        `Emphasis (angle weight per beat, 0..1): ${emphasisLine}`,
        `Question plan (${brief.question_plan.length} questions; follow-ups only on high-priority beats):`,
        ...planLines,
        "",
        "Reminder: the angle shapes which questions get asked and what gets emphasized. It never shapes what the subject is portrayed as having said; every quote in the piece is cited to a transcript timestamp.",
        "",
        `Next: approve_contact with brief_id ${brief.brief_id}. A human confirms this exact person and number before anything is contacted.`,
      ]);
    },
  );
}
