# Open Brain

> **Project status: abandoned (2026-05-20).** Open Brain set out to be a
> fully local, browser-only second brain with chat over an in-browser LLM.
> The notebook half shipped; the chat half hit the capability ceiling of
> 1–3B parameter WebLLM-class models. See the [postmortem](docs/POSTMORTEM-2026-05-20.md)
> for the full reasoning, lessons learned, and recommended alternatives
> (TL;DR: [Obsidian](https://obsidian.md/) + [Local LLM Helper](https://community.obsidian.md/plugins/local-llm-helper) + [Ollama](https://ollama.com/) covers the same intent on a mature substrate).

A local-first, browser-only personal second brain: notes in GitHub,
retrieval over on-device embeddings, chat through an in-browser WebLLM
model. No server, no telemetry, no account beyond your GitHub login.

The code is preserved as-is at the final commit. No further development planned.

## Docs

Start here:

- **[Postmortem (2026-05-20)](docs/POSTMORTEM-2026-05-20.md)** — why the project ended, what was learned, where to go instead.
- [Phases completed (archive)](docs/PHASES-COMPLETED-2026-04-17.md) — full task lists + exit criteria for everything that shipped.
- [Implementation plan](docs/IMPLEMENTATION-PLAN-2026-04-17.md) — active-plan record at the final commit; mostly archive stubs by the end.

Reference docs from the project (still accurate as of final commit):

- [Constraints](docs/CONSTRAINTS-2026-04-17.md)
- [Tech stack](docs/TECH-STACK-2026-04-17.md)
- [Architecture](docs/ARCHITECTURE-2026-04-17.md)
- [Design](docs/DESIGN-2026-04-17.md)
- [Post-MVP plans](docs/POST-MVP-PLANS-2026-05-11.md) — items deliberately out of MVP scope.
- [Conversational note-ops research](docs/RESEARCH-2026-05-09-conversational-note-ops.md) — frozen Phase 5.5 research notes.
- [Cloudflare Pages deploy](docs/DEPLOY-CLOUDFLARE-PAGES.md)

## Develop

```sh
nvm use          # pins the LTS Node from .nvmrc
npm install
npm run dev      # http://localhost:5173
npm run check    # types + lint + format + tests
```

At the time of project wind-down: 446 tests across 53 files, all green.
