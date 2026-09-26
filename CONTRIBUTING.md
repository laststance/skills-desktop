# Contributing

Thank you for helping make Skills Desktop a clearer window into the skills your AI agents share.

## Before changing behavior

Search [existing issues](https://github.com/laststance/skills-desktop/issues) first. A bug report should include the Skills Desktop version or commit, macOS version and architecture, reproduction steps, expected behavior and actual behavior. Never include credentials, private skill contents or other personal data. For vulnerabilities, use [SECURITY.md](SECURITY.md) instead of a public issue.

Read the product and domain notes that apply to your change:

- [SPEC.md](SPEC.md): product behavior.
- [CONTEXT.md](CONTEXT.md) and [docs/adr/](docs/adr/): domain language and recorded decisions.
- [ARCHITECTURE.md](ARCHITECTURE.md): process and package boundaries.
- [DESIGN.md](DESIGN.md): the visual source of truth for UI, layout, motion and design-token changes.

## Local setup

The app and its E2E suite run on macOS only. Install Node.js 24.20.0 (see [`.node-version`](.node-version)) and the pnpm version pinned in the root `package.json` `packageManager` field. Follow [pnpm's installation guide](https://pnpm.io/installation) or run `corepack enable`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` launches the Electron app with hot reload and exposes Chrome DevTools Protocol on port 9222. If a previous run died uncleanly, free the port with `kill-port 9222` first.

## Workspace layout

This repository is a pnpm workspace with one root lockfile:

| Package                             | Path                         | Purpose                                                    |
| ----------------------------------- | ---------------------------- | ---------------------------------------------------------- |
| `skills-desktop`                    | `apps/desktop`               | The Electron app (main, preload, renderer) and E2E suite   |
| `skills-desktop-website`            | `apps/website`               | The Next.js site and the Unsplash oRPC proxy on Vercel     |
| `@skills-desktop/unsplash-contract` | `packages/unsplash-contract` | The oRPC contract and limits shared by desktop and website |

Run package scripts from the repository root. The root `package.json` delegates with `pnpm --filter`, so `pnpm test`, `pnpm lint` and `pnpm typecheck` target the desktop app. The contract package has `test:contract`, `lint:contract` and `typecheck:contract`. Website commands use `pnpm --filter skills-desktop-website <script>`.

### Dependencies

- A dependency used by more than one package is declared once in the `catalog:` section of [`pnpm-workspace.yaml`](pnpm-workspace.yaml). Each package then references it as `"catalog:"`. `catalogMode: strict` makes pnpm reject a direct version for a cataloged dependency.
- [sherif](https://github.com/QuiiBz/sherif) runs in the Lint workflow and fails on mismatched versions or misplaced dependencies across the workspace.
- Workspace packages ship TypeScript source. The desktop app lists them as **devDependencies**, so electron-vite bundles them into `out/main`. If one moves to `dependencies`, electron-vite externalizes it and the packaged app cannot resolve it. `pnpm check:bundled-workspace` guards this after `pnpm build`.
- The workspace keeps a minimum release age for new versions. Only add a `minimumReleaseAgeExclude` entry with a reason.

## Make a change

1. Create a focused branch from `main`.
2. Add or update a regression test for the observable behavior.
3. Update the user documentation when configuration, supported behavior or installation changes.
4. Run the quality gates in this order:

   ```sh
   pnpm validate
   pnpm test:e2e
   ```

   `pnpm validate` runs sherif, lint, unit and browser tests, type checks, the website checks, Fallow and the Storybook build in parallel. On a slower machine, bound it the same way hosted CI does: `VITEST_MAX_WORKERS=1 pnpm validate --max-parallel 1`. Run the Electron E2E suite only after `validate` passes.

5. Open a pull request that fills in the template's Test Plan and Security Checklist.

## Style

- Code and documentation use English.
- Prettier uses `singleQuote: true` and `semi: false`. `pnpm format:check` runs in CI; the pre-commit hook formats staged files.
- ESLint builds on `eslint-config-ts-prefixer`. Lint runs with `--max-warnings 0`.
- Never access `fs` from the renderer. Context isolation is on, so renderer code goes through the typed preload IPC bridge.
- Explain non-obvious functions with JSDoc covering why the function exists and when it runs. Refer to project symbols as `{@link Symbol}`.
- UI changes follow [DESIGN.md](DESIGN.md).

## Tests

- Name tests with `test`, not `it`, and describe the observable behavior that breaks when they fail.
- Compare against hard-coded expected values. Prefer independent, readable procedures over shared helpers, with `// Arrange`, `// Act` and `// Assert` comments.
- Use `toBeVisible()` to assert that something is displayed on screen.
- `*.browser.test.tsx` files run in real Chromium through Vitest browser mode. Other `*.test.ts(x)` files run in Node.
- E2E specs live in `apps/desktop/e2e/spec/*.e2e.ts` and launch the built Electron app with an isolated `HOME`. See [apps/desktop/e2e/README.md](apps/desktop/e2e/README.md).

## Releases

Maintainers release from `main` with a single pipeline. It bumps the version in `apps/desktop/package.json`, builds and notarizes the macOS app, publishes the GitHub release that auto-update reads, and updates the website download links. Do not bump the version, create GitHub releases or edit download URLs in a pull request.

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.
