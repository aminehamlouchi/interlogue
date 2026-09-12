# InterLogue

Brief it like an editor briefs a reporter. It interviews the subject and returns a
published piece with every quote cited to a timestamp in the transcript.

InterLogue is an MCP server. In this build the spine runs text-only, with no phone
call and no credentials:

```
brief -> approve_contact -> run_interview (text fixture) -> generate_piece -> check_citations
```

The output leads with the story. Pull quotes come second, each with its transcript
timestamp. Per-question answers come third as a secondary view.

## Try it alone in two minutes

Requires Node 20 or newer. No env file, no API keys.

```bash
git clone <this repo> interlogue && cd interlogue && npm install && npm run spine
```

`npm run spine` builds the server, starts it over stdio, and drives the five tools in
order with the fictional fixture. It prints the generated piece and the citation check,
and exits non-zero if any quote fails to resolve. It also proves the gate: it calls
`run_interview` before `approve_contact` and confirms the refusal.

```bash
npm test
```

Runs the unit tests: the dial gate refuses without a matching approval, the transcript
store refuses truncation, consent detection, and two tamper tests that break a quote
and confirm the citation check fails loudly.

## Use it from Claude

Claude Code: this repo ships a `.mcp.json`, so opening the folder in Claude Code
registers the `interlogue` server. Run `npm run build` first.

Claude Desktop: add to `claude_desktop_config.json`:

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

Then, in Claude, brief it:

> Use InterLogue. Subject Marisol Teague, founder of Ridgeline Provisions, phone
> +1-502-555-0142. Client Tallyhook, product Tallyhook. Topic: order entry and
> fulfillment. Angle: a two-person team getting its Mondays back from manual,
> error-prone order entry. I approve contacting her. Run the interview from the
> founder-case-study fixture and generate the piece.

## Tools

| Tool | What it does |
| --- | --- |
| `brief` | Persists the assignment brief and builds the question plan. Genre is fixed to customer case study. The angle marks which beats are high priority; those beats get their follow-up questions and lead the emphasis in the piece. |
| `approve_contact` | Records a human's explicit approval of one specific name and one specific number against a brief. Requires `confirm: true`. This record is the only thing that can ever unlock a dial. |
| `run_interview` | Text-only. Takes a fixture name or inline turns, refuses without an approval, refuses a transcript whose opening does not state the agent is an AI and ask permission to record, and stores the transcript append-only. |
| `generate_piece` | Story first, pull quotes second, per-question answers third. Runs the citation check before persisting. Fails loudly and persists nothing if any quote does not resolve. |
| `check_citations` | Re-runs the citation check on a stored piece. |
| `status` | Where a brief sits in the spine and what to call next. |
| `discover_contacts` | Stub. Returns "not in this build". |
| `question_templates` | Stub. Returns "not in this build". |
| `download_recording` | Stub. Returns "not in this build". |

## How the prose is written without an LLM

The writer is a deterministic reporter. It segments the transcript into question
blocks, classifies each block into a case-study beat using the brief's question plan,
ranks the subject's sentences for quotability (angle overlap, concrete numbers, length,
completeness), and assembles a fixed arc: who they are, the problem, the search, the
decision, the rollout, the results, the reflection.

The angle changes emphasis, never content: it picks which beat supplies the headline
quote and how many quotes each beat carries. Every factual sentence in the story is a
verbatim quote from the subject with attribution and a timestamp. The connective
sentences say only what was asked. The trade-off is that the piece reads like a
quote-led trade report rather than magazine prose, and in exchange it cannot invent a
claim. The writer sits behind a small interface (`src/types.ts`, `Writer`) so an LLM
writer can be added later behind the same citation gate.

## Guardrails

- Output leads with the story. A Q&A summary is a failure, not a style choice.
- No cold outreach. A human approves the specific person and number before any dial.
  The agent states it is an AI and asks permission to record at the top of the call.
  `run_interview` refuses a transcript without that opening.
- No agenda steering. The angle shapes which questions are asked and what is
  emphasized. It never shapes what the subject is portrayed as having said. Every
  quote links to a timestamp.
- Transcripts are append-only. A piece is regenerated from its transcript, never the
  other way round.
- Nothing dials in this build. The gate (`src/gate/dialGate.ts`) exists and is
  exercised on every run.
- Known limit: the approval is a record, not an identity check. There is no login,
  so `confirm: true` and `approved_by` are whatever the caller types. In the demo a
  human types them. A real deployment needs a human-only approval surface.
- The angle is stored on the brief and drives emphasis. It is not printed in the
  piece, so it cannot be read as something the subject said.

## Where data lives

Everything runtime goes under `data/`, which is gitignored, so subject names and
numbers never enter git:

```
data/briefs/<brief_id>.json
data/approvals/<brief_id>.json
data/transcripts/<brief_id>.json      (append-only)
data/pieces/<brief_id>_pc_<id>.json
```

The fixture under `fixtures/` is fictional and committed.

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
- [ ] Those four values placed in `app/.env` by Amine, loaded with
      `node --env-file=.env` so no dependency and no code ever prints them.

## Layout

```
src/index.ts            MCP server entry, stdio
src/tools/*.ts          one tool per file
src/gate/dialGate.ts    the only unlock for a dial
src/store/fileStore.ts  JSON persistence under data/
src/generate/*.ts       segmentation, deterministic reporter, citation check, render
src/questionBank.ts     case-study question bank and angle weighting
src/consent.ts          AI disclosure and recording-permission detection
fixtures/               the fictional text-only fixture
scripts/run-spine.ts    end-to-end runner over stdio
test/                   node:test suite
```
