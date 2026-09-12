# One-click bundle for Claude Desktop

`docs/interlogue.mcpb` is an MCP Bundle (manifest version 0.3) of the text-only
InterLogue server: the built server, the fictional fixture, and production
dependencies. No credentials are inside it, and the phone path answers
"phone path not configured" until a `.env` is provided to a source install.
Claude Desktop ships its own Node runtime, so nothing else is needed.

Install: download `interlogue.mcpb`, open it with Claude Desktop (double-click on
macOS or Windows), and confirm the install dialog. The InterLogue tools appear
in the tools menu.

Rebuild it from a clean checkout:

```bash
npm ci && npm run build
mkdir -p /tmp/interlogue-stage && cp -R dist fixtures package.json package-lock.json README.md docs/bundle/manifest.json /tmp/interlogue-stage/
rm -rf /tmp/interlogue-stage/dist/test /tmp/interlogue-stage/dist/scripts
(cd /tmp/interlogue-stage && npm ci --omit=dev --ignore-scripts && npx -y @anthropic-ai/mcpb validate manifest.json && npx -y @anthropic-ai/mcpb pack . ../interlogue.mcpb)
```

Verified on Sep 12 2026 by extracting the bundle to a fresh directory and running
the spine from it with no environment: 12 tools listed, the dial gate refused
before approval, the fixture interview stored, draft_piece returned the packet,
the fallback writer passed the citation check, and place_call refused for lack
of credentials.
