# junyuchen.ai

The first Standard Website homepage, built with Astro and TypeScript. Its visual
direction is Editorial Home, with a focused studio-style treatment for the
featured project. `/universe/` is a separate experimental spatial prototype.
Project principles are in
[DESIGN.md](DESIGN.md).

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

- `src/pages/index.astro`: the homepage at `/`, with in-page navigation.
- `src/data/home.ts`: existing public biography, research interests and project
  descriptions, kept separate from the page layout. IDs are stable.
- `src/styles/global.css`: responsive editorial layout, visual tokens, keyboard
  focus states and reduced-motion support. System fonts require no downloads.
- `public/images/search-tree.svg`: an illustrative MCTS search tree, explicitly
  captioned as a conceptual sketch rather than actual project output.
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

- The first visual homepage uses typography rather than an empty portrait slot.
  It does not request an avatar or invent a portrait.
- The CV destination remains **`/CV.pdf`**, including its capitalization. Until
  the real `public/CV.pdf` is supplied, the CV control opens an availability note
  and email contact instead of a broken link. Rebuild after adding the PDF; the
  control then becomes a normal PDF link. No substitute document is generated.
- There is no custom favicon yet. An empty data URL prevents a request for a
  nonexistent browser icon.

## Production deployment

The Pages workflow builds Node 24 with npm ci and npm run build (including type
checks), then publishes only dist/. Pushes to main deploy automatically; a
manual run on main can retry deployment. Development branches cannot deploy.

For the first cutover, record the current live main SHA and Pages source,
branch/path, domain and HTTPS setting. After approval, push the reviewed changes
to redesign-v2 and prepare the PR. In Settings → Pages, retain junyuchen.ai and
select GitHub Actions **before merging**: branch publishing cannot serve the
Astro source tree. Allow the official actions and permit main in the github-pages
environment. Merge the PR, monitor both jobs, then verify all four HTTPS routes,
an old root fragment, assets and a missing URL. No DNS changes are expected.

For a failed workflow, fix the cause and rerun on main. For rollback to the
original static site, restore the recorded known-good static tree (including its
root index.html and CNAME) through a reviewed revert, then restore the recorded
branch publishing source. Do not select branch publishing against Astro sources.
For later Astro releases revert to the last working Astro revision and redeploy.

## Personal Universe — spatial study 01

**Checkpoint status:** This is a technical prototype. Semantic zoom, spatial
hierarchy, camera navigation and isolated loading have been validated. Its current
visual appearance is not the final direction. The next phase will focus on
reworking the grand-scale universe visuals, sense of scale and rendering quality;
this checkpoint does not extend or polish the current visuals.

Open `/universe/` for the first desktop spatial prototype. The Standard Website
has no Universe import, navigation change, Three.js dependency in its page bundle,
or render loop. No portal or deployment change is part of this study.

- **Content:** `src/data/home.ts` remains the shared source. The adapter in
  `src/universe/semantic.ts` adds reading links and explicit editorial groupings;
  related interests do not imply completed research or implemented capabilities.
- **Spatial mapping:** `src/universe/spatial.ts` references those IDs and owns
  positions, illustrative scales, colors, camera offsets and local placements.
  A content record can be placed in multiple systems without duplicating its text.
- **Rendering:** `src/universe/scene.ts` uses Three.js directly. All transitions
  happen inside one 3D coordinate space. Labels, ambient density, local bodies,
  orbits and reading detail resolve at different approach distances.
- **Loading:** `src/universe/entry.ts` imports the renderer only on a desktop-sized,
  fine-pointer device. Small/coarse-pointer devices use a server-rendered reading
  view of the same content. Missing JavaScript, failed WebGL initialization and
  context loss also retain a direct reading path.

Click a spatial label or object to focus. Scroll down to approach the hovered
(or nearest) target, up to retreat. Back / Escape returns one level; Overview
returns to the beginning. The canvas also accepts Enter / + to approach, - to
retreat, and Home for overview. Standard Website is always directly accessible.
Pause motion stops the ambient movement; reduced-motion disables parallax and
ambient animation and uses brief focus transitions. These are controlled camera
moves, not free-flight controls. Positions and orbit scales are illustrative.

The prototype targets 30 fps, caps pixel ratio at 1.5, creates 8,100 ambient points
plus 180 points per local system (only the focused local system is rendered),
shares sphere geometry and one 64px glow texture, and uses no postprocessing,
external textures, physics, WebGPU or shader framework. Offscreen geometry is
frustum-culled. Animation suspends in hidden tabs; buffers, materials, listeners
and rendering are disposed on departure, compact-view switching and hot reload.
In development only, the hidden `#universe-metrics` output reports observed fps,
CPU render-submission time, draw calls, primitives and allocated resources; it is
not a GPU timing benchmark. Temporary browser viewport changes can restart the
view when they cross the compact breakpoint.

The scene is a navigation/scale study, not a complete information atlas. It has
two regions, eight local systems, ten unique shared content records, and no
invented papers, products or experiences. AlphaZero remains in progress. The
semantic grouping and spatial metaphors are intentionally revisable.
