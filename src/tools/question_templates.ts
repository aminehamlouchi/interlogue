/**
 * Tool: question_templates. Cut-list stub.
 * Multi-genre question templates are not in this build. The single genre,
 * customer case study, gets its question plan from the brief tool.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { reply } from "../respond.js";

const TEXT =
  "Not in this build. Multi-genre question templates are on the cut list. This build asks one genre, customer case study, and the brief tool builds its question plan from the angle.";

export function register(server: McpServer): void {
  server.registerTool(
    "question_templates",
    {
      title: "Question templates by genre (not in this build)",
      description:
        "Do not call this to get questions; the brief tool already builds the question plan from the user's sentence, as a customer case study or a founder story. It only explains that other genres are not in this build.",
      inputSchema: { genre: z.string().describe("Ignored. Kept so the tool has a stable shape.") },
    },
    async () => reply([TEXT]),
  );
}
