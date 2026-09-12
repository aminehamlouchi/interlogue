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
        "Cut-list stub. There is one genre, customer case study, and its questions come from the brief tool's angle-driven plan. Any genre passed here gets the same answer.",
      inputSchema: { genre: z.string().describe("Ignored. Kept so the tool has a stable shape.") },
    },
    async () => reply([TEXT]),
  );
}
