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
        "Cut-list stub. Automated contact discovery is not implemented and will not find, suggest or look up anyone. Explains what to do instead.",
      inputSchema: { query: z.string().describe("Ignored. Kept so the tool has a stable shape.") },
    },
    async () => reply([TEXT]),
  );
}
