# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Automates posting to Instagram, TikTok, and Facebook, each on its own schedule, across multiple **projects** (e.g. separate brands) — entirely as scheduled GitHub Actions workflows, no server to host. Media is dropped into a Google Drive folder (a loose file = single post, a subfolder = carousel), synced into this repo, then posted via [Buffer](https://buffer.com) (which holds the actual OAuth connection to each platform). A small Angular admin UI, hosted on GitHub Pages, edits everything by writing directly to this repo through the GitHub Contents API from the browser — there is no backend API of its own.

Two independent npm packages, no shared tooling or root `package.json`:
- **`automation/`** — Node/TypeScript scripts the GitHub Actions workflows run (Drive sync, posting, scheduled posts, reminders).
- **`admin-ui/`** — an Angular 20 app that edits this repo's own JSON/YAML config files via the GitHub API.

Each project keeps its own brand voice/content guide at `brand/<projectId>/voice.md` — read the relevant one before writing a post's `caption.txt` or any caption-generation logic for that project.

## Commands

### `automation/`
```bash
cd automation
npm install
npm run typecheck      # tsc --noEmit
npm run sync-drive      # tsx src/sync-drive.ts
npm run post             # tsx src/post.ts
npm run scheduled-posts  # tsx src/scheduled-posts.ts
npm run reminders        # tsx src/reminders.ts
```
No test framework is configured — verification has been done via `DRY_RUN=true` runs against real or scratch-directory fixture data (see below), plus `npm run typecheck`. There's no `lint` script either.

All four scripts loop over every project in `config/projects.json` unless scoped with env vars:
```bash
DRY_RUN=true GITHUB_REPOSITORY=dearlavion/dearlavion-social-media-manager npm run post
DRY_RUN=true GITHUB_REPOSITORY=dearlavion/dearlavion-social-media-manager FORCE_PROJECT_ID=travel-besty npm run post
DRY_RUN=true GITHUB_REPOSITORY=dearlavion/dearlavion-social-media-manager FORCE_PROJECT_ID=travel-besty FORCE_CHANNEL_ID=travel-besty-instagram npm run post
```
`DRY_RUN=true` logs what would happen instead of calling Google Drive or Buffer — use it to check due-check/file-picking logic without live credentials. `GITHUB_REPOSITORY` is required (normally injected by Actions); `FORCE_PROJECT_ID`/`FORCE_CHANNEL_ID` scope or force a run the same way the admin UI's `workflow_dispatch` inputs do.

### `admin-ui/`
```bash
cd admin-ui
npm install
npm start    # ng serve, http://localhost:4201 (see angular.json — not the CLI default 4200)
npm run build   # ng build
```
No test script configured here either. Local dev works against the real public repo with no GitHub token (reads only); a fine-grained PAT (`Contents: read and write` + `Actions: read and write`) is needed in the UI's own connection form to Save or trigger workflows.

## Architecture

### Everything hinges on the repo being public

Buffer's `createPost` only accepts a publicly-fetchable image URL (`raw.githubusercontent.com/...`), not a binary upload. This repo must stay **public** or posting breaks for every channel in every project — keep this in mind before ever suggesting it be made private.

### Multi-project isolation, all on disk

`config/projects.json` is the registry (`[{id, name}]`). Everything else is namespaced under `<projectId>` so projects never collide:
- `config/<projectId>/channels.json` — that project's channels (platform, `enabled`, `driveFolderId`, `bufferChannelId`, `publisher`, `lastPostedAt`, `syncedDriveFileIds`).
- `config/<projectId>/campaigns.json` — that project's campaigns (absent until one is created).
- `inbox/<projectId>/<channelId>/<postId>/` — media synced from Drive, one folder per post, waiting to be posted.
- `posted/<projectId>/<channelId>/<postId>/` — the same, moved here after a successful post.
- `brand/<projectId>/voice.md` — that project's brand voice guide.

`config/reminders.json` is the one config file that is *not* project-scoped (personal reminders, unrelated to any project).

### The pipeline: four cron-scheduled GitHub Actions workflows

All four live in `.github/workflows/`, all `working-directory: automation`, all end with `stefanzweifel/git-auto-commit-action` committing whatever they changed. Their cron minutes are deliberately offset so their auto-commits don't collide, and are user-editable from the admin UI's **Settings** page (see below) rather than only by hand-editing YAML. **`post.yml` and `scheduled-posts.yml`'s commit steps both need `add_options: '-A'`** -- this action's default `git add <file_pattern>` only stages new/modified files, never deletions, so without it `movePosted()`'s `inbox/` → `posted/` rename never gets its `inbox/`-side deletion committed (the old blob stays tracked and comes back on the next checkout even though it's gone from disk) — this caused several real duplicate Buffer posts before being caught. Any future workflow step that deletes/moves files needs the same flag.

**Duplicate-post history, two more causes (both fixed):** (1) `movePosted()`'s destination path (`postFolderName`, derived from the source Drive file's own metadata) is deterministic, so reusing the *same* Drive file for a second, later post produces the identical `posted/` folder name as the first -- a plain `rename()` onto that already-occupied, non-empty destination throws `ENOTEMPTY`, silently caught, leaving the file stuck in `inbox/` where it's still "fair game" for the next FIFO run. `movePosted` now `rm -rf`s any stale destination before renaming. (2) `post.yml` and `scheduled-posts.yml` share a `concurrency: {group: automation-publish, cancel-in-progress: false}` so a GitHub-delayed hourly `post.yml` run can never land seconds after `scheduled-posts.yml` just published+archived the same folder and re-publish it against a stale checkout -- queuing forces it to see the latest commit first.

**Drive-side cleanup on publish**: `sync-drive.ts` and `scheduled-posts.ts`'s live Drive lookup both write a `.drive-source-id` marker (`writeDriveSourceId`/`readDriveSourceId` in `post-helpers.ts`, excluded from `readPostMedia`'s file listing same as `caption.txt`) into each synced post folder, recording which Drive file/folder it came from. On a successful publish, `post.ts`/`scheduled-posts.ts` read that marker (before `movePosted` relocates the folder) and call `moveToPostedFolder()` (`drive.ts`) to relocate the *source* file in the user's own Drive into an auto-created `_posted` subfolder -- keeps it out of future `sync-drive.ts` sweeps and `expectedFileName` lookups without renaming it (renaming would break intentionally reusing the same file across multiple posts, which is exactly what triggered the `ENOTEMPTY` bug above). Requires the Drive OAuth scope to be `drive` (not `drive.readonly`) *and* the folder actually shared as Editor with the service account -- both required, independently, or this fails with a 403 that's caught and logged as a warning, never blocking the post itself. **`listNewEntries()` explicitly excludes `_posted` by name from its query** -- without that, the archive folder itself shows up as "new" content on the very next sync (it's a top-level entry of the channel's Drive folder, same as anything else), re-downloading and re-publishing whatever's inside it. Confirmed live once before this exclusion was added. Two channels sharing the same `driveFolderId` (as `travel-besty-instagram`/`travel-besty-tiktok` do) both see the same `_posted` folder, so a gap here hits every channel on that folder, not just one.

1. **`sync-drive.yml`** (`0 * * * *`) — for every enabled channel in every project, lists new top-level Drive entries. A loose file becomes one post folder; a subfolder becomes a carousel (capped at Instagram's 10 items). Files over ~90MB are skipped to stay under GitHub's 100MB push limit. Logic in `automation/src/sync-drive.ts` + `drive-sync-helpers.ts` (`sanitize`/`postFolderName`/`downloadEntry`/size guard — extracted so they can be imported without triggering `sync-drive.ts`'s self-invoking `main()`).
2. **`post.yml`** (`15 * * * *`) — for every enabled channel, posts its oldest post folder in `inbox/` (FIFO, one item per channel per run — no per-channel interval, just this workflow's own cron), then moves it to `posted/` and stamps `lastPostedAt` (informational only now). Skips any folder reserved by a not-yet-due scheduled post. Logic in `automation/src/post.ts` + `post-helpers.ts` (shared with `scheduled-posts.ts`: media reading, caption resolution, `movePosted`, carousel cap, `findSlotByLinkedPath`).
3. **`reminders.yml`** (`30 * * * *`) — checks `config/reminders.json` for anything due; if so, opens a GitHub Issue per due reminder via `automation/src/github-issues.ts` (this is the actual notification -- watch the repo at "All Activity" to get it). Only if opening that issue itself fails does the run deliberately fail its last step, so GitHub's own "workflow run failed" email fires as a backup (no external email service).
4. **`scheduled-posts.yml`** (`*/5 * * * *`, the one workflow that isn't hourly) — publishes a campaign slot's linked media at its own target date+time, independent of the channel's regular interval. Opens (and auto-closes) a GitHub Issue on publish success, opens a persistent one on failure, same issue-first/email-only-as-backup pattern as reminders. See [README.md § Scheduled posts](README.md#scheduled-posts) for the full two-tier filename-matching logic (inbox-first, then live Drive lookup) and the extension-guard that rejects unsupported file types before searching.

`post.ts` follows the same issue-first/email-backup notification pattern per channel (try/catch around each `publish()` call so one channel's failure doesn't abort the others in the same run).

`post.yml` and `sync-drive.yml` also accept `workflow_dispatch` inputs `project_id`/`channel_id` to scope or force a single run -- trigger either from the admin UI's **Settings** page ("Trigger now") or the Actions tab.

### Posting backend is pluggable per channel

`automation/src/publishers/` is a small registry (`getPublisher(id)` in `index.ts`, `PublishFn` signature in `types.ts`). `buffer.ts` is the only implementation today. A channel's `publisher` field (**Posting tool** in the admin UI) selects it, defaulting to `"buffer"` when absent so existing channels keep working unchanged. Adding a direct-platform integration means writing one new module matching `PublishFn` and registering it — no other code changes needed.

### Campaigns: a planning/tracking layer, not a scheduler (mostly)

`CampaignSlot` (in both `automation/src/config.ts` and `admin-ui/src/app/campaign.model.ts` — kept in sync by hand, no shared types package) tracks a stage/channel/guidance plus `status` (`planned`/`queued`/`posted`), `linkedPostPath`, and optionally `targetDate`/`targetTime`/`targetDueAt`/`expectedFileName`/`scheduledNotifiedAt`. For a slot with no target time, campaigns are purely descriptive — the channel's `enabled` flag still decides what actually posts, and `post.ts` auto-flips a slot to `posted` when it publishes something linked to it. A slot **with** a target date+time is the one case that bypasses the regular queue entirely — that's what `scheduled-posts.ts` acts on. `Campaign.channelIds` (also both packages) is the membership list of which channels the campaign involves, separate from `channelTargets` (per-channel goals, optional) and from slots themselves -- lets the admin UI add a channel to a campaign before it has any slots or a goal (Campaigns detail view's **Add channel**/**Remove channel**).

### Admin UI talks straight to the GitHub API, no backend

`admin-ui/src/app/github.service.ts` is the single point of contact with GitHub: JSON config read/write (`getFile`/`getFileOrDefault`/`putFile`, used for projects/channels/campaigns/reminders), raw-text read/write for workflow YAML (`loadRawFile`/`saveRawFile`, used only by Settings), `loadTree()` (one Git Trees API call for the whole `inbox/` subtree — keeps Content Queue well under GitHub's 60/hr unauthenticated rate limit instead of one request per post folder), and `triggerWorkflow` (`workflow_dispatch`, used by Settings' "Trigger now"). A `GithubConnection` (owner/repo/branch/token) is held in the root `AppComponent` and passed down as an `@Input` to every view; the token lives only in that browser tab's `sessionStorage`, never sent anywhere but `api.github.com`. Loading works with no token since the repo is public; writing (Save, Trigger now) needs a fine-grained PAT with `Contents: read and write` (+ `Actions: read and write` for anything that dispatches a workflow).

Each top-level view is a standalone component taking `connection` (and usually `project`/`channels`) as `@Input()`s, switched via a `view` union type in `app.component.ts` (`dashboard`/`wiki`/`setup`/`scheduler`/`queue`/`campaigns`/`settings`) rather than a router — see the `@if`/`@else if` chain in `app.component.html`. Zoneless change detection is not in use here (this is a plain Angular 20 CLI app, not the zoneless setup used in `dearlavion-web-ui`).

- **Content Queue** (`queue.component.ts`) — "Synced" (what's actually in `inbox/`, from `loadTree()`) and "Planned" (a checklist sourced from every `ongoing` campaign's slots, editable inline including target date/time and `expectedFileName`). Linked bidirectionally with Campaigns via shared badges/buttons.
- **Campaigns** (`campaign.component.ts`) — list/builder/detail modes for `campaigns.json`.
- **Scheduler** (`scheduler.component.ts`) — the personal-reminders calendar, backed by `config/reminders.json`.
- **Settings** (`settings.component.ts`) — reads each workflow file's raw YAML, extracts/edits its `cron:` line via `workflow-schedule.model.ts` (`parseCron`/`buildCron`/`extractCronFromYaml`/`replaceCronInYaml` — regex-based on purpose, not a full YAML parser, and recognizes only the two cron shapes actually used here; anything else falls back to a read-only display), and writes it back with `saveRawFile`.
- **Wiki** (`wiki.component.ts`/`.html`) — a static in-app usage guide; keep it in sync with README.md when behavior changes, since both exist and can drift.

### Media uploads never touch the admin UI directly

There is no upload feature in the admin UI — media only ever arrives via Google Drive → `sync-drive.yml`, or (for `expectedFileName` slots) a direct live Drive lookup from `scheduled-posts.ts`. The admin UI only ever reads/links/schedules against what's already in `inbox/`.

## Deployment

`.github/workflows/deploy-admin-ui.yml` builds `admin-ui/` (`ng build --base-href /dearlavion-social-media-manager/`) and deploys to GitHub Pages on every push to `main` touching `admin-ui/**` — **https://dearlavion.github.io/dearlavion-social-media-manager/**. No staging environment; this is the only deployed instance.
