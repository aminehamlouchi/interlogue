/**
 * Tool: brief. Step 1 of the spine.
 *
 * One sentence in. Required: the subject's name, their phone number, and one
 * free-text sentence about who they are and what the piece is about. Role,
 * company, client, product, topic, angle and genre are inferred from the
 * sentence with sensible defaults, and every default is named in the result.
 * When the subject's company is the client or the product, the plan becomes
 * a founder story; otherwise a customer case study.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectGenre, genreLabel } from "../generate/briefRules.js";
import { inferBrief } from "../generate/inferBrief.js";
import { buildQuestionPlan, emphasisFromAngle, questionLimitFrom } from "../questionBank.js";
import { errorMessage, lastFour, refuse, reply } from "../respond.js";
import { saveBrief } from "../store/fileStore.js";
import { BEAT_ORDER, type Brief } from "../types.js";
import { newId, nowIso, tokenize } from "../util.js";

const inputSchema = {
  subject_name: z.string().min(1).describe("The person to interview, full name."),
  subject_phone: z.string().min(4).describe("Their phone number, with country code if you have it. Stored only in the brief and the approval; never echoed in full."),
  about: z
    .string()
    .min(3)
    .describe(
      "One sentence in the user's words about who this person is and what the piece is about, e.g. \"founder of Ridgeline Provisions, about switching her order entry to Tallyhook, for Tallyhook's marketing team\". Everything else is inferred from it.",
    ),
  subject_role: z.string().min(1).optional().describe("Optional. Inferred from the sentence if absent."),
  subject_company: z.string().min(1).optional().describe("Optional. Inferred from the sentence if absent."),
  client_company: z.string().min(1).optional().describe("Optional. Who the piece is for. If absent, the subject's own company, which makes it a founder story."),
  client_product: z.string().min(1).optional().describe("Optional. The product the case study is about. Defaults to the client name."),
  topic: z.string().min(1).optional().describe("Optional. The subject matter as a noun phrase. Inferred from the sentence if absent."),
  angle: z.string().min(1).optional().describe("Optional. What to emphasize. Defaults to the sentence itself."),
  content_needed: z.array(z.string().min(1)).default(["case study", "pull quotes"]).describe("Optional. What the user needs back."),
};

export function register(server: McpServer): void {
  server.registerTool(
    "brief",
    {
      title: "Brief the interview",
      description:
        "Call this first whenever the user wants someone interviewed, written up, or turned into a case study or story. " +
        "It needs only the person's name, their phone number, and the user's one sentence about who they are and what the piece is about. " +
        "Do not ask the user for role, company, client, product, topic, angle or genre: pass the sentence, and the tool infers them or picks a default and says which. If the sentence says how many questions to ask, for example \"three questions\", the plan is cut to that. " +
        "Nobody is contacted at this step. When it returns, tell the user in one or two lines what was understood (genre, who for, topic) and that the next step is their approval to contact this person.",
      inputSchema,
    },
    async (input) => {
      const inferred = inferBrief({
        subject_name: input.subject_name,
        about: input.about,
        subject_role: input.subject_role,
        subject_company: input.subject_company,
        client_company: input.client_company,
        client_product: input.client_product,
        topic: input.topic,
        angle: input.angle,
      });
      const genre = detectGenre({
        subject_company: inferred.subject_company,
        client_company: inferred.client_company,
        client_product: inferred.client_product,
      });
      const emphasis = emphasisFromAngle(inferred.angle);
      const brief: Brief = {
        brief_id: newId("brf"),
        created_at: nowIso(),
        genre,
        subject: { name: input.subject_name, phone: input.subject_phone, role: inferred.subject_role, company: inferred.subject_company },
        client: { company: inferred.client_company, product: inferred.client_product },
        topic: inferred.topic,
        angle: inferred.angle,
        about: input.about,
        content_needed: input.content_needed,
        emphasis: emphasis,
        question_plan: [],
      };
      const limit = questionLimitFrom(input.about);
      brief.question_plan = buildQuestionPlan(brief, emphasis, genre, limit);

      try {
        await saveBrief(brief);
      } catch (e) {
        return refuse(["BRIEF NOT SAVED", errorMessage(e), "Next: fix the input and call brief again."]);
      }

      const productTokens = new Set(tokenize(brief.client.product));
      const topicHitsProduct = genre === "customer_case_study" && tokenize(brief.topic).some((t) => productTokens.has(t));
      const topicNote = topicHitsProduct
        ? `WARNING: the topic mentions the product, so the question "Before ${brief.client.product}, how did ${brief.subject.company} handle ${brief.topic}?" may sound odd on the call. A topic that names the process itself reads better. This is advice; the brief is saved.`
        : "";
      const emphasisLine = BEAT_ORDER.map((b) => `${b} ${emphasis[b].toFixed(2)}`).join(", ");
      const planLines = brief.question_plan.map((q, i) => `  ${i + 1}. [${q.beat}, ${q.priority}${q.follow_up ? ", follow-up" : ""}] ${q.text}`);

      return reply([
        `BRIEF SAVED: ${brief.brief_id}`,
        `brief_id: ${brief.brief_id}`,
        `Genre: ${genreLabel(genre)}${genre === "founder_story" ? " (the subject's company is the client, so the plan asks about what they built)" : ""}`,
        `Subject: ${brief.subject.name}, ${brief.subject.role}, ${brief.subject.company} (phone ${lastFour(brief.subject.phone)})`,
        `For: ${brief.client.company}${brief.client.product !== brief.client.company ? ` / product ${brief.client.product}` : ""}`,
        `Topic: ${brief.topic}`,
        `Angle: ${brief.angle}`,
        inferred.chosen.length ? `Chosen for you: ${inferred.chosen.join("; ")}.` : "All fields were given explicitly.",
        topicNote,
        "",
        `Emphasis (angle weight per beat): ${emphasisLine}`,
        limit ? `Short interview: the sentence asked for ${limit} question${limit === 1 ? "" : "s"}, so the plan keeps the ${brief.question_plan.length} that matter most for the angle. Expect a call of about a minute.` : "",
        `Question plan (${brief.question_plan.length} questions; follow-ups on the emphasized beats):`,
        ...planLines,
        "",
        "The angle shapes which questions get asked and what gets emphasized. It never shapes what the subject is portrayed as having said; every quote in the piece is cited to a transcript timestamp.",
        "",
        `Next: approve_contact with brief_id ${brief.brief_id}. Ask the user to confirm, in their own words, that InterLogue may contact this person at this number; pass that as the statement with confirm: true.`,
      ]);
    },
  );
}
