# SSH XL Auto-Apply

A Violentmonkey userscript for sshxl.nl. It applies to the most urgent
listings before their reaction window closes, remembers what you already
applied to, and lets you withdraw reactions in bulk.

## Install

Use Violentmonkey (Chrome/Edge or Firefox).

1. Install Violentmonkey.
2. Open the script on GreasyFork:
   https://greasyfork.org/en/scripts/551142-ssh-xl-auto-responder-urgent-room-opener
3. Click Install this script.
4. Open https://www.sshxl.nl/nl/aanbod. A status pill shows up bottom-right.

The script updates itself from GreasyFork.

## How to use

The blue pill bottom-right shows your reaction slots, for example 3 used, 4
free. The limit is SSH's 7 active reactions. Click the pill, or press
Alt+Shift+S, to open the panel. It keeps your open/closed state and the tab
you were on across pages and reloads.

### Apply

Hit Fill free slots to start a run. The script goes through the most urgent
eligible listings one at a time (Reageer, then Bevestigen) until your slots
are full or nothing is left to apply to. If slots stay free it keeps going on
its own.

The pick list shows what is next. Rooms you already applied to, got refused
for, or failed are skipped. Expired reactions free their slot automatically.

### Settings

A matching funnel at the top shows how many available listings pass each
filter, so you can tell which setting is cutting things down.

Cities, dwelling types, contract types and allocation are picked from the
site's own dropdowns. Max rent counts after huurtoeslag. You can also set a
minimum surface and require huurtoeslag. Streets are one list with a toggle:
Whitelist (only these) or Blacklist (never these).

The profile section shows what the script knows about you, scraped from
mijn-profiel, and has a reset button.

### Reactions

Your open reactions with their queue positions. Tick some and click Withdraw
selected to unreact in bulk, which frees slots for new applications.

On the listings page, rooms you applied to, got refused, or failed are badged
on their cards.

### Notes

Everything is stored in your browser (Violentmonkey's storage). No data
leaves your machine and the script makes no external requests.

---

## For developers

### Prerequisites

- Node.js >= 20.19
- pnpm >= 11 (corepack enable, or npm i -g pnpm)

### Build and install from source

```
pnpm install
pnpm build        # writes dist/sshxl-autoapply.user.js
```

To install the built file in Violentmonkey: open the dashboard, add a new
script, paste the contents of dist/sshxl-autoapply.user.js, and save. Or drag
the file onto a Chrome window.

### Development workflow

`pnpm dev` runs Vite in serve mode. See the
[vite-plugin-monkey](https://github.com/lisonge/vite-plugin-monkey) and
[Violentmonkey editor-tracking](https://violentmonkey.github.io/posts/how-to-edit-scripts-with-your-favorite-editor/)
docs.

1. Run `pnpm dev`. Vite serves your source at
   http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js
2. Violentmonkey shows an install prompt. Click Track external edits (tick
   make default) and optionally enable Reload tab.
3. Keep the installer tab open. Every save is live, no rebuild needed.
4. Open https://www.sshxl.nl/nl/aanbod and the panel reflects your edits.

Caveats:

- The dev install is named `server:SSH XL Auto-Apply`. It coexists with a
  production install. Disable one to avoid duplicate UI.
- On Firefox, keep the installer tab open. Firefox throttles `file://` change
  detection.
- If sshxl.nl's CSP blocks the dev module, use `pnpm dev:watch` with a
  production install instead.

### Production build

```
pnpm build
```

### @match patterns

Edit `userscript.meta.json` (the metadata block is generated from it at build
time), then rebuild:

```json
"match": [
  "https://www.sshxl.nl/nl/aanbod*",
  "https://www.sshxl.nl/nl/mijn-ssh/reacties*",
  "https://www.sshxl.nl/nl/mijn-ssh/mijn-profiel*"
]
```

Keep @match patterns narrow.

### GM_* API

Only GM_getValue and GM_setValue are granted, with a localStorage fallback
when not under a userscript manager (tests). No cross-origin requests, no
clipboard, no unsafeWindow.

### Scripts

| Command             | Purpose                             |
| ------------------- | ----------------------------------- |
| `pnpm dev`          | watch-build the userscript          |
| `pnpm build`        | production build                    |
| `pnpm test`         | unit tests (scrapers, state, flows) |
| `pnpm lint`         | ESLint                              |
| `pnpm format`       | Prettier write                      |
| `pnpm format:check` | Prettier check                      |
| `pnpm typecheck`    | `tsc --noEmit`                      |
| `pnpm smoke`        | fixture server for the smoke test   |

### Tests

Two tiers, both local:

- Unit tests (`pnpm test`, vitest + happy-dom, no browser). Scrapers run
  against real markup saved in `tests/fixtures/`, so changes to the site's
  markup fail here first. State, merge and plan rules, plus the applier and
  unreact flows with the site's behavior mocked in-process, are covered here.
- Browser smoke (`pnpm smoke` then `pnpm exec node tests/browser/drive.mjs`).
  Runs the built userscript headless against fixtures served under real site
  paths: the apply flow, room-detail merge, reacties slot reconciliation,
  profile scrape, overview badges, SPA remount and persistence.

### Updating dependencies

```
pnpm exec taze          # show available updates
pnpm exec taze minor    # apply patch/minor updates, then pnpm install
pnpm exec taze major    # apply major bumps, then pnpm install + full verify
```

TypeScript is pinned to `~6.x`; typescript-eslint does not support TS 7 yet
([tracking issue](https://github.com/typescript-eslint/typescript-eslint/issues/10940)).

### How it works

- Overview (/nl/aanbod): parses every `.card--property` card, turns each
  countdown ("Er kan nog 2 dagen en 10 uur gereageerd worden.") into an
  absolute deadline (rounded up so nothing expires early), ranks by urgency,
  and badges applied/refused/failed rooms. The overview sync never changes
  application status; that belongs to the reacties page and our own runs.
- Run: fills the free slots (quota minus active reactions) by loading rooms in
  the same tab, so popup blockers can't interfere. State survives reloads. It
  refills when slots remain and ends on the reacties page.
- Reacties: that page is the only authority on which reactions are open. A
  visit reconciles the tracked set and frees expired slots.

### Project layout

```
src/
  main.tsx          entry point, SPA routing (core/router), console/test hook
  core/             runtime behavior: applier, unreact, router, progress, logger, dom
  data/             scraping + state: scrapers, listings (DB + field-level merge),
                    planner, reactions (slot tracking), preferences, filters, page, storage
  ui/               Preact components: global hub (pill + tabs) + editors
tests/
  *.test.ts         unit tests (scrapers, state, flows) - vitest + happy-dom
  fixtures/         real-markup fragments mined from sshxl.nl/ (unit tests)
  browser/          browser smoke harness: serve.cjs + drive.mjs + served fixtures
userscript.meta.json   userscript metadata block (single source of truth)
dist/                  build output (sshxl-autoapply.user.js)
```

## License

MIT
