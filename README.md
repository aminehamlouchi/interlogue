# InterLogue

Brief it like an editor briefs a reporter. It interviews the subject and returns a
published piece with every quote cited to a timestamp in the transcript.

InterLogue is an MCP server that runs inside Claude. The host Claude writes the
piece; InterLogue is the fact-checker. Nothing is published until every quoted
span resolves, verbatim, to a subject turn at the cited timestamp. In this build the
spine runs text-only, with no phone call and no credentials:

```
brief -> approve_contact -> run_interview (text fixture) -> draft_piece -> [Claude writes] -> check_citations
```

The output leads with the story. Pull quotes come second, each with its transcript
timestamp. Per-question answers come third as a secondary view.

## A judge can try it two ways

Requires Node 20 or newer. No env file, no API keys.

### Path 1: one command, no Claude needed (the fallback writer)

```bash
git clone https://github.com/aminehamlouchi/interlogue.git interlogue && cd interlogue && npm install && npm run spine
```

`npm run spine` builds the server, starts it over stdio, and drives the tools in order
with the fictional fixture using the built-in deterministic reporter as the writer. It
prints the generated piece and the citation check, and exits non-zero if any quote
fails to resolve. It also proves the gate: it calls `run_interview` before
`approve_contact` and confirms the refusal.

The deterministic reporter is the fallback. It assembles a quote-led piece with no
model at all, so the spine can be verified alone. The piece it writes is honest but
mechanical. The real writer is the host Claude, in path 2.

```bash
npm test
```

Runs the unit tests: the dial gate, the append-only store, consent detection, the
fallback writer, and the host-piece checker, including tamper tests that alter a
quote, drop a timestamp, assert a number outside a quote, and reorder the sections.

### Path 2: inside Claude, where Claude writes the piece

Claude Desktop: add this to `claude_desktop_config.json` after `npm install && npm run build`
in the cloned folder, then restart Claude Desktop.

```json
{
  "mcpServers": {
    "interlogue": {
      "command": "node",
      "args": ["/absolute/path/to/interlogue/dist/src/index.js"]
    }
  }
}
```

Or let the repo write that entry for you. Claude Desktop rewrites its config from
memory while it is running, so quit it fully first:

```bash
npm run register-desktop
```

It backs up the config, adds or refreshes only the `interlogue` entry (with the
env-file flag when `.env` exists), and leaves every other entry alone. Relaunch
Claude Desktop and the InterLogue tools appear.

Claude Code: the repo ships a `.mcp.json`, so opening the folder registers the
`interlogue` server after `npm run build`.

Paste this brief into Claude:

> Use the InterLogue tools. Brief: subject Marisol Teague, founder of Ridgeline
> Provisions, phone +1-502-555-0142. Client Tallyhook, product Tallyhook. Topic:
> order entry and fulfillment. Angle: a two-person team getting its Mondays back
> from manual, error-prone order entry. I am a human and I approve contacting her
> at that number. Run the interview from the founder-case-study fixture, then get
> the reporter's packet, write the piece yourself following the contract, and
> submit it to check_citations until it passes. Show me the published piece.

The exact sequence of tool calls Claude makes:

1. `brief` with the subject, client, topic and angle. Returns a `brief_id` and the question plan.
2. `approve_contact` with `brief_id`, the same name and number, `approved_by`, `consent_basis`, `statement`, and `confirm: true`. This is the human gate.
3. `run_interview` with `brief_id` and `fixture: "founder-case-study"`. Refused without step 2. Stores the transcript.
4. `draft_piece` with `brief_id`. Returns the reporter's packet: brief, angle, question plan, the writing contract, ranked verbatim quote candidates with timestamps, and the full transcript.
5. Claude writes the piece in markdown: an H1 headline, the story as prose, then `## Pull quotes` with one `> “quote” (MM:SS)` per line.
6. `check_citations` with `brief_id` and `markdown`. A fail returns every failing span with the closest transcript turn, and nothing persists. A pass appends the per-question view verbatim, persists the piece under `data/pieces/`, and returns it.
7. `status` with `brief_id` shows where the brief sits and which pieces exist.

The same sequence from a shell, for anyone without a Claude host, using the generic
client that talks to the server over the real MCP transport:

```bash
npm run tool -- brief '{"subject_name":"Marisol Teague","subject_phone":"+1-502-555-0142","subject_role":"founder","subject_company":"Ridgeline Provisions","client_company":"Tallyhook","client_product":"Tallyhook","topic":"order entry and fulfillment","angle":"a two-person team getting its Mondays back from manual, error-prone order entry"}'
```

```bash
npm run tool -- approve_contact '{"brief_id":"<brief_id>","subject_name":"Marisol Teague","phone":"+1-502-555-0142","approved_by":"Your Name","consent_basis":"Fictional fixture subject.","statement":"I approve contacting this person at this number.","confirm":true}'
```

```bash
npm run tool -- run_interview '{"brief_id":"<brief_id>","fixture":"founder-case-study"}'
```

```bash
npm run tool -- draft_piece '{"brief_id":"<brief_id>"}'
```

```bash
npm run tool -- check_citations '{"brief_id":"<brief_id>"}' --markdown-file my-piece.md
```

## The writing contract

`draft_piece` hands the writer a contract, and `check_citations` enforces the parts
it can enforce mechanically:

- Order: H1 headline, story as prose, then `## Pull quotes`. The per-question view is appended by the checker verbatim from the transcript.
- Every quoted span is verbatim from a subject turn and is followed by its `(MM:SS)`. A span without a timestamp, or a timestamp without a span, fails. One ellipsis is allowed inside a single turn, in order.
- Connective prose may frame and sequence but may not assert a fact about the subject outside a cited quote. A number outside a quote fails.
- The angle chooses emphasis, never words. More than one sentence starting with "Asked", or "said:" more than once, fails.
- Three to seven pull quotes. Plain, reported voice.

## Tools

| Tool | What it does |
| --- | --- |
| `brief` | Persists the assignment brief and builds the question plan. Genre is fixed to customer case study. The angle marks which beats are high priority; those beats get their follow-up questions and lead the emphasis. |
| `approve_contact` | Records a human's explicit approval of one specific name and one specific number against a brief. Requires `confirm: true`. This record is the only thing that can ever unlock a dial. |
| `run_interview` | Text-only. Takes a fixture name or inline turns, refuses without an approval, refuses a transcript whose opening does not state the agent is an AI and ask permission to record, and stores the transcript append-only. |
| `place_call` | Phone path, step 1. Refused without the approval record. Places one outbound call through the ElevenLabs agent over Twilio with the six dynamic variables from the brief. |
| `fetch_transcript` | Phone path, step 2. Waits for the call to end, fetches and normalizes the transcript with real timestamps, runs the consent check, stores it append-only, records time and cost. |
| `draft_piece` | Returns the reporter's packet for the host writer: brief, angle, question plan, writing contract, ranked verbatim quote candidates with timestamps, full transcript. |
| `check_citations` | The fact-checker. With `brief_id` and `markdown`, validates a host-written piece and persists it only on a clean pass. With `piece_id`, re-checks a stored piece. |
| `generate_piece` | Fallback writer. Assembles the piece deterministically from the transcript, runs the citation check, persists only on a pass. Used by `npm run spine`. |
| `status` | Where a brief sits in the spine and what to call next. |
| `discover_contacts` | Stub. Returns "not in this build". |
| `question_templates` | Stub. Returns "not in this build". |
| `download_recording` | Stub. Returns "not in this build". |

## Guardrails

- Output leads with the story. A Q&A summary is a failure, not a style choice.
- No cold outreach. A human approves the specific person and number before any dial.
  The agent states it is an AI and asks permission to record at the top of the call.
  `run_interview` refuses a transcript without that opening and the subject's yes.
- No agenda steering. The angle shapes which questions are asked and what is
  emphasized. It never shapes what the subject is portrayed as having said. Every
  quote links to a timestamp. The angle is stored on the brief and is not printed in
  the piece.
- Transcripts are append-only. A piece is regenerated from its transcript, never the
  other way round.
- One gate for every dial. `place_call` and the text path call the same
  `assertDialApproved` in `src/gate/dialGate.ts`; there is no other way to reach the
  outbound-call request.
- Known limit: the approval is a record, not an identity check. There is no login,
  so `confirm: true` and `approved_by` are whatever the caller types. In the demo a
  human types them. A real deployment needs a human-only approval surface.

## Where data lives

Everything runtime goes under `data/`, which is gitignored, so subject names and
numbers never enter git:

```
data/briefs/<brief_id>.json
data/approvals/<brief_id>.json
data/transcripts/<brief_id>.json      (append-only)
data/pieces/<brief_id>_pc_<id>.json
data/calls/<brief_id>.json            (conversation id, timing, cost, last four digits only)
```

The fixture under `fixtures/` is fictional and committed. Every name, company and
number in it is invented; the 555-01XX range is reserved for fiction.

## The phone path

The phone path places a real call through an ElevenLabs agent over the native
Twilio integration. It is two tools, because a live call outlasts one MCP tool call:

1. `place_call` with `brief_id` and `confirm_dial: true`. Refused unless the same
   dial gate as the text path finds a recorded approval for the brief's exact name
   and number. It triggers the outbound call, passing six dynamic variables built
   from the brief (`subject_name`, `subject_role`, `client_name`, `genre`, `angle`,
   `question_plan`), records the conversation id under `data/calls/`, and returns.
2. `fetch_transcript` with `brief_id`. Waits for the call to end, fetches the
   conversation, normalizes it to one timestamped turn per entry, runs the consent
   check on the real opening, and stores the transcript append-only. It records
   wall-clock time from dial to transcript, call duration, and the cost ElevenLabs
   reports. If the opening fails the consent check, it reports the opening verbatim
   and stores nothing. Each call waits up to about three minutes and answers
   STILL IN PROGRESS if the interview is still running; the host calls it again,
   so a ten-minute interview needs about four calls. If a host cancels a wait early,
   the next call for that brief automatically stays under that limit.

From there the spine is the same: `draft_piece`, the host writes, `check_citations`.

Credentials are read from the process environment only, never from a file by this
code, and never printed. Put three values in `app/.env` and start the server with
Node's built-in flag:

```
ELEVENLABS_API_KEY=...
ELEVENLABS_AGENT_ID=...
ELEVENLABS_PHONE_NUMBER_ID=...
```

```bash
npm run start:phone
```

That runs `node --env-file=.env dist/src/index.js`. For Claude Desktop, use the same
two arguments with absolute paths:

```json
{
  "mcpServers": {
    "interlogue": {
      "command": "/absolute/path/to/node",
      "args": [
        "--env-file=/absolute/path/to/interlogue/.env",
        "/absolute/path/to/interlogue/dist/src/index.js"
      ]
    }
  }
}
```

The agent itself is configured in ElevenLabs: its first message must state that it is
an AI and ask permission to record, its prompt reads the six dynamic variables, and
the Twilio number is imported under Phone Numbers. From a shell, the phone tools run
through `npm run tool:phone -- <tool> '<json>'`, which loads the env file into the
client and forwards only the ElevenLabs variables to the server.

Endpoints used, verified against the ElevenLabs API reference:
`POST /v1/convai/twilio/outbound-call` and `GET /v1/convai/conversations/{id}`,
authenticated with the `xi-api-key` header.

## Layout

```
src/index.ts                 MCP server entry, stdio
src/tools/*.ts               one tool per file
src/gate/dialGate.ts         the only unlock for a dial
src/store/fileStore.ts       JSON persistence under data/
src/generate/packet.ts       the reporter's packet for the host writer
src/generate/contract.ts     the writing contract
src/generate/markdownPiece.ts the host-piece checker and assembler
src/generate/reporter.ts     the deterministic fallback writer
src/generate/citations.ts    the citation rule and re-check
src/questionBank.ts          case-study question bank and angle weighting
src/consent.ts               AI disclosure and recording-permission detection
src/phone/elevenlabs.ts      ElevenLabs REST client (outbound call, conversation fetch)
src/phone/normalize.ts       brief -> dynamic variables; conversation -> timestamped turns
fixtures/                    the fictional text-only fixture
scripts/run-spine.ts         end-to-end fallback runner over stdio
scripts/call-tool.ts         generic one-tool client over stdio
test/                        node:test suite
```
