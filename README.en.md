# dsh-host-adapter-client · DSH Client Adapter (single source for service / event names)

> Browser bundles (`window.__ModuleLoader__.load({id, factory})`) **cannot physically import**
> the server-side `lib/host-adapter.mjs`. So client bundles had to write `ctx` service names
> (`webServer` / `settings` / `sessions` …) and event names (`connection/reset` …) as bare literals —
> every upstream upgrade then spreads edit points across the whole ecosystem.
>
> This package gives the browser side a **`require()`-able constants module**: `SVC` (service names)
> + `EV` (event names) + version, **generated** from the single server-side source
> `lib/host-adapter.mjs` (never hand-copied), with a `sourceSha256` header, idempotent regeneration
> and a same-source verifier.

---

## Read this first

1. **This is a DSH plugin package, not a CLI tool.** After installing into the web profile the host
   cordis loader loads it; a **patch insert is required** (`cordis.patch.yml` `insert` entry),
   otherwise the client half never enters the boot graph. `deploy.mjs` does that automatically
   (and supports a read-only `--verify`).
2. **The registration id equals the package name: `@kira905/dsh-host-adapter-client`.**
   Historical lesson: when `__ModuleLoader__.load({id})`'s id differs from the package name you get
   **HTTP 200 but the plugin never mounts** (the host indexes client modules by package name).
3. **`lib/host-adapter.js` and `lib/host-adapter.d.ts` are generated — do not edit by hand.**
   The next `sync-client-host-adapter.mjs` run overwrites them and `--verify` fails.
4. Unknown-argument handling differs: `deploy.mjs` has a **strict allow-list** (unknown ⇒ exit 2,
   nothing written); `sync-client-host-adapter.mjs` ignores unknown flags but only writes this
   repo's two generated files. Both implement `-h` / `--help`.

---

## 1. What it solves

Upstream DSH event/service names change between versions. Spreading literals across N packages makes
each upgrade expensive. This package collapses that into:

- **Single source**: `lib/host-adapter.mjs` (pure functions, zero dependencies, zero IO;
  `SVC` + `EV` + `HOST_ADAPTER_VERSION`)
- **Generated artefacts**: `lib/host-adapter.js` (browser bundle) + `lib/host-adapter.d.ts`
- **Generator**: `sync-client-host-adapter.mjs` (idempotent, `sourceSha256` header)
- **Deployer**: `deploy.mjs` (installs into the web profile, adds the `cordis.patch.yml` insert,
  three gates)

Consumer side (other client bundles):

```js
const A = require('@kira905/dsh-host-adapter-client')
const inject = [A.SVC.slots, A.SVC.locale]
ctx.on(A.EV.CONNECTION_RESET, handler)
```

> The consumer's `package.json` must declare this package under `dsh.client.external` so the host
> orders the boot graph (dependency registers first); otherwise the synchronous `require()` misses.

---

## 2. Repository layout

```
dsh-host-adapter-client/
├── deploy.mjs                     # install into the web profile (idempotent; 3 gates)
├── sync-client-host-adapter.mjs   # generator: single source -> host-adapter.js + .d.ts
├── lib/
│   ├── index.js                   # host half: inert plugin (inject=[] / apply(){})
│   ├── host-adapter.js            # generated: browser bundle (loader id = package name)
│   ├── host-adapter.d.ts          # generated: type declarations
│   ├── host-adapter.mjs           # SINGLE SOURCE: SVC / EV / version (pure, zero deps)
│   ├── dsh-home.mjs               # DSH home / web profile resolution
│   └── deploy-guard.mjs           # shared deploy gates (arg allow-list, escaping imports, smoke import)
├── README.md / README.en.md / CHANGELOG.md / LICENSE / package.json
├── .gitignore / .gitattributes
```

---

## 3. Installation (two ways, **both need the patch insert**)

### 3.1 Recommended: `deploy.mjs`

```powershell
node deploy.mjs --verify     # read-only: on-disk entity vs sources
node deploy.mjs --dry-run    # print the plan, write nothing
node deploy.mjs              # install (backs up the three profile declaration files first)
```

What it does:

1. Backs up the profile's `package.json` / `.package-map.json` / `cordis.patch.yml` (+ any existing
   entity directory).
2. Copies `package.json` + `lib/{index.js,host-adapter.js,host-adapter.d.ts}` into
   `<DSH_HOME>/profiles/web/node_modules/@kira905/dsh-host-adapter-client/`.
3. Adds the `.package-map.json` entry and appends the `cordis.patch.yml` `insert`
   (`- id: "@kira905/dsh-host-adapter-client"`; skipped if present).

It **never** touches `profile.bundles` or `profile.dependencies` — a client plugin in `bundles`
breaks with "declares no dsh.bundle".

### 3.2 Manual installation

1. Copy the package directory to
   `<DSH_HOME>/profiles/web/node_modules/@kira905/dsh-host-adapter-client/`.
2. Add to `.package-map.json` → `packages`:
   `"@kira905/dsh-host-adapter-client": { "url": "./@kira905/dsh-host-adapter-client", "dependencies": {} }`.
3. Append to `cordis.patch.yml`:

```yaml
- insert:
    - id: "@kira905/dsh-host-adapter-client"
      name: '@kira905/dsh-host-adapter-client'
```

4. **Restart DSH** (the plugin entry is loaded at boot).

---

## 4. Commands (the authoritative argument table)

| Command | Arguments | Purpose |
|---|---|---|
| `deploy.mjs` | *(none)* · `--dry-run` · `--verify` · `--help`/`-h` | install into the web profile; strict argument allow-list (unknown ⇒ exit 2, nothing written) |
| `sync-client-host-adapter.mjs` | *(none)* · `--dry-run` · `--verify` · `--self-test` · `--help`/`-h` | regenerate or verify the two artefacts |

`deploy.mjs` exit codes: `0` ok · `1` gate failed / deploy failed · `2` usage error.
Gates (all before any write): ① relative imports that escape the plugin directory after resolution;
② generated artefacts match the single source; ③ `node --check` on source files.

---

## 5. Environment

| Variable | Meaning | Default |
|---|---|---|
| `DSH_HOME` | DSH home (`profiles/web/` lives under it) | `~/.dsh` |
| `BUTLER_DSH_HOME` | higher-priority override (test environments) | unset |

---

## 6. Known limitations

- **Constants only** — no behavioural compatibility layer for changed event semantics.
- **`dsh.profile.bundles` is empty on purpose**: client plugins must go through
  `cordis.patch.yml` `insert`.
- **Artefacts must be regenerated** whenever `lib/host-adapter.mjs` changes.
- **Scoped package name** ⇒ the path is `node_modules/@kira905/dsh-host-adapter-client/` (one extra
  directory level).
- **Not verified on a live host** in this release (source + generator only, no runtime mount record).

---

## 7. License

**AGPL-3.0 + commercial license (dual licensing)**, see [LICENSE](./LICENSE).
Personal / study / open-source use: free under AGPL-3.0 (derivatives must stay AGPL-3.0).
Closed-source / commercial use: obtain a commercial license via a repository Issue.

---

## 8. Related repositories

`dsh-butler-archive` · `dsh-diagnostics-extra` · `dsh-quality-toolkit` · `dsh-ops-toolkit` ·
`dsh-board-toolkit` · `dsh-memory-toolkit` · `dsh-imgtmpl` · `dsh-gongwen` ·
`dsh-api-balance-folded` · `dsh-notekit` (same names on GitHub and Gitee).
