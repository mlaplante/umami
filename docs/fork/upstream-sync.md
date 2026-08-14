# Keeping this fork in sync with upstream

This fork tracks [umami-software/umami](https://github.com/umami-software/umami),
which lands roughly 150 commits a month. This document explains how syncing
stays cheap and what to do when it isn't.

## What this fork actually changes

Deliberately very little. The whole delta is:

| Path | Why |
| --- | --- |
| `prisma.config.ts` | Points Prisma at `DIRECT_DATABASE_URL`. Migrations run through a pooled connection hang on Netlify. |
| `pnpm-workspace.yaml` | Excludes `tools/**` from the root workspace. |
| `tools/seo-report/` | Standalone SEO reporting CLI + MCP server. |
| `.github/fork-paths.txt`, `.github/workflows/sync-upstream.yml` | The sync machinery itself. |
| `docs/fork/` | This document. |

The list is enforced, not just documented — see "The gates" below.

## Why merges used to be painful

`tools/seo-report` was a member of the root pnpm workspace, so its dependencies
were written into the root `pnpm-lock.yaml`. Upstream rewrites that lockfile
constantly, which meant **every single sync conflicted** in a 30,000-line
generated file.

Excluding `tools/**` from the root workspace and giving `tools/seo-report` its
own `pnpm-workspace.yaml` and `pnpm-lock.yaml` makes the root lockfile
byte-identical to upstream, so it never conflicts again.

The trade: `pnpm-workspace.yaml` is now a fork-local delta on a file upstream
edits occasionally (a few times a year, one line at a time). That is a far
better deal than a guaranteed conflict in a generated lockfile every time.

### Working on `tools/seo-report`

It has its own lockfile, so install from inside the directory:

```sh
cd tools/seo-report && pnpm install
```

Running `pnpm install` at the repo root will not pick it up, by design. If its
dependencies ever appear in the root `pnpm-lock.yaml`, the sync workflow fails
loudly rather than letting the conflicts come back.

The flip side: **nothing in CI ever validates `tools/seo-report/pnpm-lock.yaml`**,
because the sync workflow only installs the root workspace. That lockfile is
only exercised when you run `pnpm install` in the directory by hand.

## Automatic syncing

`.github/workflows/sync-upstream.yml` runs Mondays at 09:00 UTC (and on demand
via **Actions → Sync upstream → Run workflow**). It merges upstream into
`master` and pushes — but only if every gate passes.

### The gates

1. **The merge applies cleanly.** No conflicts.
2. **The fork delta matches `.github/fork-paths.txt` exactly.** Every changed
   path must sit under an allowed prefix, and every allowed prefix must still
   match something. This catches a fork change silently lost in a merge *and*
   an unexpected new delta appearing.
3. **The root lockfile still matches upstream.** Early warning that the
   workspace exclusion has broken.
4. **`pnpm build` succeeds**, using a dummy connection string and
   `SKIP_DB_CHECK=1`.

If any gate fails, **nothing is pushed** and an issue is opened instead. The
deploy is left untouched. Fix it locally:

```sh
git fetch upstream master
git merge upstream/master
# resolve, then
git push origin master
```

### If you add another fork-local change

Add its path prefix to `.github/fork-paths.txt` in the same commit, or the next
sync will fail on gate 2. That failure is the feature working correctly.

The check runs both ways, so a *stale* entry fails too — if you delete a
fork-local file, or upstream adopts one of our changes so it no longer differs,
remove its line from `fork-paths.txt`.

### Two environment gotchas

**Issues must stay enabled.** Forks ship with Issues disabled, which silently
breaks the failure notification — the workflow fails, but no issue is filed.
Issues were enabled on this fork specifically so gate failures are visible.
Re-enable with `gh repo edit mlaplante/umami --enable-issues` if that ever
changes.

**`gh` targets upstream by default in this repo.** Because an `upstream` remote
exists, `gh` resolves the fork's parent, so `gh workflow list` and `gh run list`
show `umami-software/umami` unless you pass `--repo mlaplante/umami`. This is a
good way to convince yourself the sync workflow doesn't exist when it does.

## Two things the workflow deliberately will not do

**It never runs migrations.** `SKIP_DB_CHECK=1` short-circuits
`scripts/check-db.js` before it opens a connection and before
`applyMigration()` would run `prisma migrate deploy`. No production credentials
are available to the workflow. Upstream ships schema changes constantly — this
sync took `21_add_session_link`, `22_add_2fa` and `23_update_session_data` in
one go — and applying those unattended is not something a cron job should
decide to do. **After a sync deploys, check whether upstream added migrations
and apply them yourself.**

**It never force-pushes or rebases.** Syncs are merges, so fork commit SHAs are
never rewritten.

## Open question: is the `prisma.config.ts` change still needed?

Upstream's `scripts/check-db.js` now runs `prisma migrate deploy` with
`DATABASE_URL` overridden to `DIRECT_DATABASE_URL`, which covers the migration
path natively. The fork change is not a no-op though — it points *every* Prisma
invocation at the direct URL, including `prisma generate`, which runs earlier in
`build-db`. Since the original change fixed an observed Netlify build hang, it
should not be removed on the strength of code-reading alone. Worth testing on a
branch; until then it stays.
