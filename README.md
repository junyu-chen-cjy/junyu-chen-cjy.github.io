# junyuchen.ai

The existing single-page homepage, migrated to Astro and TypeScript. This is a
technical migration: the original copy and CSS are retained, without the planned
visual redesign or new sections. Project principles are in [DESIGN.md](DESIGN.md).

## Local development

Use Node.js **24 LTS** (see `.nvmrc`) and npm. Run all commands from the repository
root. If using nvm, run `nvm install` and `nvm use` first.

On macOS with Homebrew's `node@24`, make its executables available in the current
terminal before running npm (no shell configuration changes are required):

```sh
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
```

On Intel Macs, use `/usr/local/opt/node@24/bin` instead.

```sh
npm ci
npm run dev
```

Open the local URL printed by Astro, normally `http://localhost:4321/`.
Astro runs its local servers in the background. Stop them when finished:

```sh
npm run dev -- stop
npm run preview -- stop
```

```sh
npm run check    # Check Astro and TypeScript files
npm run build    # Type-check, then generate the static site in dist/
npm run preview  # Serve the production build locally
```

## Files

- `src/pages/index.astro`: the existing homepage, still served at `/`.
- `src/styles/global.css`: the original global styles, extracted from `index.html`.
- `astro.config.ts`: static output and `site: 'https://junyuchen.ai'`; no repository
  path prefix is used for the custom domain.
- `public/`: files copied unchanged to the root of `dist/`.
- Root `CNAME`: retained unchanged to protect the existing domain configuration.
- `public/CNAME`: same domain file, copied by Astro to `dist/CNAME`. Keep both
  CNAME files identical if a domain change is explicitly approved in the future.
- `public/.nojekyll`: copied to `dist/.nojekyll` so static artifacts can also be
  published without Jekyll processing (including any `_astro/` assets).
- `package-lock.json`: locked dependency resolution for reproducible installs.
  `node_modules/`, `.astro/` and `dist/` are generated and ignored by Git.

## Existing missing assets

The original repository contains neither `avatar.jpg` nor `CV.pdf`.

- The homepage retains the portrait's 160px space and its existing alternative
  text without requesting a missing image. To use a real portrait, add
  `public/avatar.jpg` and restart the dev server or rebuild.
- The CV link remains **`/CV.pdf`**, including its capitalization. Add the real
  document as `public/CV.pdf` to make it available at that address. Until then,
  following the link returns 404; no substitute document has been invented.
- There is no custom favicon yet. An empty data URL prevents a request for a
  nonexistent browser icon.

## Deployment boundary

This migration does **not** change GitHub Pages settings, DNS, the custom domain,
or the online publishing workflow. No deployment workflow is added here.

The deployment artifact is **`dist/`**, not the repository root. Its root contains
`index.html`, `CNAME`, `.nojekyll`, and any generated assets. Astro does not need a
server at runtime for this site.

The existing branch-based Pages process does not build Astro. Do not merge this
migration into the live publishing branch until a separate deployment change has
been reviewed: it must install the locked dependencies, run `npm run build`, and
publish **only `dist/`**. Publishing the source tree directly after this migration
would omit the built homepage and could expose source or documentation files.

Before that future deployment, verify `dist/CNAME` contains `junyuchen.ai`, the CV
asset (when supplied) remains `/CV.pdf`, and resource paths work at the domain
root. Preserve the existing domain/DNS configuration. HTTPS enforcement and the
missing CV remain separate issues recorded by the original audit.
