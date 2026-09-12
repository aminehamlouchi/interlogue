/**
 * Tool: download_recording. Cut-list stub.
 * Recording download is not in this build. The timestamped text transcript
 * is the record of the interview.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { reply } from "../respond.js";

const TEXT =
  "Not in this build. Recording download is on the cut list. The text-only transcript with per-turn timestamps is the record of the interview in this build.";

export function register(server: McpServer): void {
  server.registerTool(
    "download_recording",
    {
      title: "Download recording (not in this build)",
      description:
        "Do not call this to get audio; there is none to download. The timestamped transcript is the record of the interview. If the user asks for the recording, tell them the transcript with timestamps is what InterLogue keeps.",
      inputSchema: { transcript_id: z.string().describe("Ignored. Kept so the tool has a stable shape.") },
    },
    async () => reply([TEXT]),
  );
}
