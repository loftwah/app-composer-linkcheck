# Contributing

Questions, documentation, accessibility reports, design improvements and code are welcome. Start with an existing issue or describe the observed problem. No experience with the whole system is required. App Composer #50 owns this mini-app.

Follow [README](README.md) for `pnpm install` and `pnpm dev`. Use `pnpm check` and a short focused group: `pnpm test:metadata`, `pnpm test:fetch` or `pnpm test:identity`. Tests use fictional local fixtures and make no live network calls. Full tests/build remain required by the production deploy guard.

Forks deploy into their own Cloudflare accounts and configure an exact public hostname list. Never copy production keys or turn the inspector into an arbitrary private-network proxy. Preserve request/response size limits, redirect checks and the whole-inspection timeout.

For UI changes include phone/desktop and dark/light evidence, visible focus and keyboard operation, real error/loading states and actual image behavior. Imported reports and fetched metadata are untrusted data. Generated artwork has source/prompt provenance; do not manufacture acceptance evidence.

Open a small pull request with the problem, resulting behavior and actual validation. Maintainers review before guarded deployment. No GitHub Actions. See [Code of Conduct](CODE_OF_CONDUCT.md), [Security](SECURITY.md) and [Accessibility](ACCESSIBILITY.md).
