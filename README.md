# Open Brain

A local-first, browser-only personal second brain: notes in GitHub, chat powered by
an in-browser Gemma (WebLLM), retrieval over on-device embeddings. No server, no
telemetry, no account beyond your GitHub login.

## Docs

- [Constraints](docs/CONSTRAINTS-2026-04-17.md)
- [Tech stack](docs/TECH-STACK-2026-04-17.md)
- [Architecture](docs/ARCHITECTURE-2026-04-17.md)
- [Design](docs/DESIGN-2026-04-17.md)
- [Implementation plan](docs/IMPLEMENTATION-PLAN-2026-04-17.md)

## Develop

```sh
nvm use          # pins the LTS Node from .nvmrc
npm install
npm run dev      # http://localhost:5173
npm run check    # types + lint + format + tests; must pass before every commit
```

`npm run check` is the single gate — no task in the implementation plan is
considered done until it passes clean.
