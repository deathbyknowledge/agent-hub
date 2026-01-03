# Repository Guidelines

## Project Structure & Module Organization
- `hub/agents`, `hub/tools`, `hub/plugins`: agent blueprints, tool definitions, and runtime plugins. These are auto‑discovered by `vite-plugin-agents.ts` and compiled into `_generated.ts`.
- `lib/runtime`: core AgentHub runtime (Workers entrypoint, agent loop, planning, tool wiring).
- `lib/client`: HTTP/WS client library for interacting with the runtime.
- `examples/ui`: React UI example (Wouter routing). Components live in `examples/ui/src/components`, hooks in `examples/ui/src/hooks`.
- Root configs: `vite.config.ts`, `tsconfig.json`, `wrangler.jsonc`, `index.html`.

## Architecture Intent
- Treat `lib/**` as a stable core (future library); prefer additive changes, avoid churn.
- Grow features in `hub/agents`, `hub/tools`, and `hub/plugins`.

## Build, Test, and Development Commands
- `npm i`: install dependencies.
- `npm run dev`: start the Vite dev server for the runtime; changes under `hub/**` regenerate `_generated.ts` automatically.
- `npm run build`: create a production build.
- `npm run preview`: serve the production build locally.
- `npm run tsc`: run strict TypeScript type‑checking (no emit).
- `npm run test`: run unit tests with Node's type-stripping test runner.

## Coding Style & Naming Conventions
- TypeScript/TSX, ES modules, `strict` TS config.
- Indentation: 2 spaces. Use double quotes and semicolons; keep trailing commas where already used.
- Files/folders: kebab-case. Types/classes: PascalCase. Functions/vars: camelCase.
- Keep code in the correct layer (hub vs runtime vs examples).

## Code Hygiene
- Add comments only when they clarify non‑obvious intent; avoid boilerplate or inconsistent commentary.
- Don’t introduce defensive checks or `try/catch` unless the surrounding code expects it or inputs are untrusted.
- Never use `any` casts to bypass type errors; fix the types or refactor instead.
- Match the existing file’s patterns (ordering, naming, error handling) over personal preference.

## Testing Guidelines
- Unit tests live under `tests/`. Validate via `npm run test`, `npm run tsc`, and manual checks in `npm run dev`.
- If adding tests, add a corresponding `package.json` script and use `*.test.ts` / `*.test.tsx` naming.

## Commit & Pull Request Guidelines
- Commit messages are short, imperative, and lowercase (e.g., “add template plugin”, “use vars in comms tool”).
- PRs should describe the change, link related issues, and note manual test steps. Include screenshots/gifs for UI changes.

## Security & Configuration Tips
- Never commit secrets. Use `.dev.vars` for local `LLM_API_KEY` / `LLM_API_BASE`; set deployment secrets via Wrangler.
- Avoid logging or persisting sensitive data in agent prompts, tool outputs, or UI.
