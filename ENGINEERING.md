# Develop Link Check

Use Node 22, pnpm 12.8.1 and `pnpm install --frozen-lockfile`. TypeScript 6.0.3, Wrangler 4.143.1, Prettier 3.9.10 and the existing Effect/parser/image libraries are pinned. No Bun or GitHub Actions are required.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Generate local identity, check/emit source, then start Wrangler on port 4330. |
| `pnpm source:write` | Generate local identity, strictly check Worker/browser source and regenerate committed readable distributions. |
| `pnpm check:types` | Generate identity, check separate Worker/DOM programs and reject stale generated output. |
| `pnpm lint` | TypeScript unused-local/parameter checks over maintained Worker/browser code; this scoped semantic lint is not an ESLint claim. |
| `pnpm format:check` / `pnpm format` | Check/format the explicit maintained-source and gate list in `scripts/format-source.mjs`. |
| `pnpm test` | Fictional bounded-fetch, metadata, report/history, UI-data-contract and release-source regressions. |
| `pnpm build` | Type/parity gate and credential-free Wrangler dry run using root config/default environment. |
| `pnpm check` | Types, generated parity, semantic lint, formatting and tests. |
| `pnpm deploy` | Exact clean pushed main, check/build, final source/identity/config recheck, upload and live verification. |

`src/browser/app.ts` owns inspection/cancellation, report rendering, previews, findings filters, export and copy fallback. `report-format.ts` owns the 64 KiB portable export. `navigation-draft.ts` owns bounded tab-history drafts and report recovery; it never stores HTML or reruns an inspection. `inspection-report.ts` checks the data shapes used by the renderer and its image/link controls. Large valid reports still render/export when the smaller history quota refuses retention; raw relative canonical values remain observed text. `src/publisher.mts` emits its implementation and declaration together, so an unchecked implementation cannot silently drift from its declaration.

`scripts/source-map.json` maps every emitted output. Edit typed source, run `pnpm source:write`, and commit reviewed source and readable outputs together. Checks compile in memory without changing those committed outputs. The former `node scripts/browser-assets.mjs --check|--write` command remains a compatibility entry into this same complete source gate. Worker globals and DOM globals stay in separate compiler programs.

`src/build.ts` is intentionally ignored, generated from actual Git HEAD, imported by the Worker and checked by normal commands. Deployment validates all tracked source before executing its identity generator, then also checks this generated module's exact expected bytes before upload. The release guard rechecks main/HEAD/origin-main, origin URL, clean status, config and actual tracked bytes/types, including assume-unchanged/skip-worktree edits. Mutation/ref movement and a changed ignored identity module cannot reach provider upload in the fictional regression fixtures.

Exceptions are explicit: small Node build/test tools remain JavaScript, the empty `public/navigation.js` compatibility entry has no application logic, and shared launcher/sharing/performance assets plus licensed web-vitals retain their independent copied-source/provenance boundaries. Public markup/CSS and backend network/host/rate-limit contracts stay app-owned. There is no runtime Composer dependency or automatic upstream update.

Browser fixtures use fictional reports and local app renderers, with no external inspection replay. A type pass, source fixture, public screenshot or dry-run build does not establish deployed-source, physical-device, platform-unfurl or indexing acceptance. Release and Composer source-pin changes are separate work.
