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
- Nothing dials in this build. The gate (`src/gate/dialGate.ts`) exists and is
  exercised on every run.
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
```

The fixture under `fixtures/` is fictional and committed. Every name, company and
number in it is invented; the 555-01XX range is reserved for fiction.

## What the phone path needs before it can start

Not part of this build. Nothing here reads or creates an env file.

- [ ] An ElevenLabs account with an Agent created, and its agent id.
- [ ] The ElevenLabs API key.
- [ ] A Twilio account, a purchased number, and the account SID and auth token.
- [ ] The Twilio number imported into ElevenLabs under Phone Numbers, and its
      ElevenLabs phone number id.
- [ ] The agent's first message set to state it is an AI and ask permission to
      record, and its prompt wired to read the brief from dynamic variables.
- [ ] A consenting volunteer, and their name and number recorded with
      `approve_contact` before any dial.
- [ ] Those values placed in `app/.env` by a human, loaded with
      `node --env-file=.env` so no dependency and no code ever prints them.

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
fixtures/                    the fictional text-only fixture
scripts/run-spine.ts         end-to-end fallback runner over stdio
scripts/call-tool.ts         generic one-tool client over stdio
test/                        node:test suite
```
