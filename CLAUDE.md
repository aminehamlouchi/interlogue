# InterLogue — build rules (Claude Code)

Venture context is inherited from ../CLAUDE.md — do not duplicate it here.

## Stack
TypeScript on Node 20. MCP server built on @modelcontextprotocol/sdk over
the stdio transport, with zod for tool input schemas. Native fetch for all
HTTP. ElevenLabs Agents runs the live interview, reached over the
ElevenLabs REST API, with outbound telephony via the ElevenLabs native
Twilio integration. Transcripts and generated pieces persist as JSON files
under app/data/. No database, no web framework, no bundler beyond tsc.

## Hard rules
- Plan mode first for anything structural; show the plan before building.
- Security review before any feature touching real personal data goes live.
  There is no user auth and no database in this build. The personal data
  that matters is interview subjects' names, phone numbers and recorded
  voices. Those live only in app/data/ and in the ElevenLabs conversation
  history, and no subject record is ever written outside app/.
- No deploys, force-pushes, or major dependency bumps without explicit
  approval in the prompt.
- Delegate scoped work to the subagents in .claude/agents/; keep
  orchestration in this session.

## Conventions
- src/index.ts is the MCP server entry point. One tool per file under
  src/tools/.
- Credentials are read from process.env only, loaded from app/.env. That
  file is never read, printed, logged, echoed into a report, or committed.
- Every pull quote carries the transcript timestamp it came from. A quote
  without a timestamp is a bug, not a style issue.
- Transcript JSON is append-only. Regenerate a piece from its transcript;
  never edit a transcript to fix a piece.
- Keep the cut list stubbed. Automated contact discovery, multi-genre
  question templates and recording download each return an explicit "not in
  this build" response rather than a partial implementation.
- The dial path is gated. No code path may place a call without a recorded
  human approval of that specific person and number.

## Messaging protocol (compact copy — canonical version lives in the InterLogue Project instructions; if they conflict, the Project instructions win and this file is due a sync)
Every message that crosses Amine opens with an ID line and a from/to header:
```
ID: ILOG-NNN
From: [Name] ([Role]) → To: [Name] ([Role])
```
- Your ID is the incoming message's ID plus one — arithmetic, not a
  counter. IDs attach only to messages that cross Amine; subagent
  delegation gets none.
- Every such message ends in exactly one of two ways: one clear question
  for Amine, or one labeled pass-along block naming its recipient. Never
  both, never zero, never two.
- Reports going up are briefings: what was done, what worked, what went
  sideways, the plan from here — including what was delegated to
  subagents.

## Definition of done
Builds clean · the spine runs end to end on a text-only fixture with no
phone call, and every pull quote in the output resolves to a real timestamp
in the source transcript · verified against the BRING BACK items in the
hand-off.
