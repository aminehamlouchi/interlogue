/**
 * Tool: discover_contacts. Cut-list stub.
 * Automated contact discovery is not in this build and is not partially
 * implemented here. A human finds the subject and records consent.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { reply } from "../respond.js";

const TEXT =
  "Not in this build. Automated contact discovery is on the cut list. In this build a human finds the subject, gets their consent, and records it with approve_contact. Nothing is dialed without that record.";

export function register(server: McpServer): void {
  server.registerTool(
    "discover_contacts",
    {
      title: "Discover contacts (not in this build)",
      description:
        "Do not call this to find anyone; it cannot. Automated contact discovery is not part of InterLogue: the user names the person, and a human approves the number. If the user asks you to find someone to interview, explain that and ask who they have in mind.",
      inputSchema: { query: z.string().describe("Ignored. Kept so the tool has a stable shape.") },
    },
    async () => reply([TEXT]),
  );
}
