# dearlavion-social-media-manager

Automates posting to Instagram, TikTok, and Facebook across multiple **projects** (e.g. separate brands). Media is dropped into a Google Drive folder — a loose image/video becomes a single post, a subfolder becomes a carousel — and a GitHub Actions workflow syncs it into this repo. Another workflow posts the oldest un-posted item for each enabled channel via [Buffer](https://buffer.com), which holds the actual OAuth connection to each platform. A small admin UI (hosted on GitHub Pages) manages which projects and channels exist and shows a **Content Queue** of what's waiting to go out.

No server to host: everything runs as scheduled GitHub Actions workflows.

Each project keeps its own brand voice/content guide at `brand/<projectId>/voice.md` — e.g. [`brand/travel-besty/voice.md`](brand/travel-besty/voice.md). Read the relevant one before writing a post's `caption.txt` or any future caption-generation step for that project.

## How it works

1. **Projects**: `config/projects.json` lists every project as `{id, name}`. Each project has its own `config/<projectId>/channels.json`, `inbox/<projectId>/<channelId>/`, and `posted/<projectId>/<channelId>/` — fully separate on disk, so different projects can use different Drive folders and Buffer channels without colliding.
2. **Sync** (`.github/workflows/sync-drive.yml`, hourly): for every project, for each of its enabled channels, lists new top-level entries in its configured Google Drive folder. A loose image/video file becomes one post; a **subfolder** becomes a carousel post from everything inside it (up to Instagram's 10-item cap). Each becomes its own post folder — `inbox/<projectId>/<channelId>/<postId>/<file(s)>` — committed into the repo. Any single file over ~90MB is skipped (logged clearly) to stay under GitHub's 100MB push limit.
3. **Post** (`.github/workflows/post.yml`, hourly, offset 15 min after sync): for every project, for each enabled channel, posts the oldest post folder in `inbox/<projectId>/<channelId>/` — single image, video, or carousel, inferred from how many media files are in it — via that channel's **posting tool** (`publisher` field — Buffer is the only one implemented today; see `automation/src/publishers/`), then moves the whole folder to `posted/<projectId>/<channelId>/` and updates `lastPostedAt`. Skips any folder reserved by a not-yet-due scheduled post (see below), and does nothing if the inbox is empty.
4. **Scheduled posts** (`.github/workflows/scheduled-posts.yml`, every 5 min): publishes a campaign slot's linked media at its own target date+time, independent of the channel's regular FIFO queue — see [Scheduled posts](#scheduled-posts).
5. **Admin UI** (`admin-ui/`, https://dearlavion.github.io/dearlavion-social-media-manager/): load a project first, then add/edit/enable its channels — platform, Drive folder, Buffer channel — by editing that project's `channels.json` directly on GitHub through your browser. The **Content Queue** view shows what's waiting in `inbox/` per channel before it posts; **Campaigns** plans an ordered sequence of posts and tracks each one against that plan.

### Why Buffer instead of each platform's API directly

Integrating Instagram/TikTok/Facebook's APIs directly means registering a separate developer app with each of them — real setup friction, and TikTok in particular gates public posting behind app review. Buffer's already done that OAuth registration for all of them: you connect each account once inside Buffer's own UI, and this repo only needs a single Buffer API token. Trade-off: Buffer's **free plan caps you at 3 connected channels** (across all projects combined), and API access requires that a Buffer account exists at all. Paid plans start at $5/channel/mo if you want more.

The posting backend is pluggable per channel via its `publisher` field (**Posting tool** in the admin UI) — `automation/src/publishers/` is a small registry (`getPublisher(id)`), and `buffer` is the only one implemented so far. Adding a direct-platform integration (or another free tool) later means writing one new module matching the `PublishFn` signature and registering it — no other code changes, and existing channels keep working unchanged since `publisher` defaults to `"buffer"` when absent.

## One-time setup

### 1. Push this repo to GitHub

Already done — pushed to `dearlavion/dearlavion-social-media-manager`.

**Important:** Buffer's `createPost` only accepts a publicly-fetchable image URL (`raw.githubusercontent.com/...`), not a binary upload — so this repo needs to stay **public**, or posting will fail for every channel in every project.

### 2. Google Drive — image source

1. In Google Cloud Console, create a project (or reuse one), enable the **Google Drive API**.
2. Create a **service account** (no IAM project role needed — Drive access comes from sharing the folder, not from a project role), generate a JSON key.
3. Share each Drive folder you'll use as an image source with that service account's email (Viewer access is enough). One service account can be shared across as many projects/folders as you like.
4. Add the full JSON key as a GitHub repo secret named `GDRIVE_SERVICE_ACCOUNT_JSON` (Settings → Secrets and variables → Actions).

### 3. Buffer — connects to Instagram, TikTok, and Facebook

1. Create a free account at [buffer.com](https://buffer.com) if you don't have one, and connect the accounts for each project to it from Buffer's own dashboard (that's where the real OAuth happens — nothing to register yourself).
2. Get a personal API key: Buffer account → **Settings → API** ([buffer.com/settings/api](https://publish.buffer.com/settings/api)) → create a personal API key.
3. Add it as a GitHub repo secret named `BUFFER_ACCESS_TOKEN` (shared across all projects).
4. For each connected account, find its **Buffer channel ID** — query Buffer's GraphQL API (`https://api.buffer.com`) with your token:
   ```graphql
   query { account { organizations { id } } }
   ```
   then, using that organization id:
   ```graphql
   query { channels(input: { organizationId: "YOUR_ORG_ID" }) { id name service } }
   ```
   Match `service` (instagram/tiktok/facebook) to the right channel and copy its `id` — that's the `bufferChannelId` you'll enter in the admin UI per channel.

### 4. Add a project and configure its channels

Open the admin UI: **https://dearlavion.github.io/dearlavion-social-media-manager/**

Loading works with no token at all, since the repo is public. To **Save** or create a project on **Set Up**, paste a **fine-grained GitHub PAT** scoped to this repo with `Contents: read and write` permissions (kept only in this browser tab's session storage — never sent anywhere but `api.github.com`). Add `Actions: read and write` too if you'll use **Settings**' Trigger now / cron editing.

1. On the **Dashboard**, **Load projects**, then select an existing one — or go to **Set Up** (left menu) to create a new one (an id like `travel-besty` and a display name), which creates its `config/<id>/channels.json` and switches you back to the Dashboard with it selected. Set Up is also where the posting-tool connection instructions (Buffer today) live.
2. Back on the Dashboard, **Load channels.json** for that project, then add/edit channels: a unique `id`, `platform` (label only, for your own reference), **Posting tool** (which backend actually publishes — only Buffer is implemented, see `automation/src/publishers/`), `driveFolderId`, and `bufferChannelId`.

**Media type is set by how you organize the Drive folder**, not a separate field: a loose image or video file at the top level becomes a single-item post; a **subfolder** becomes a carousel post from every image/video inside it (up to 10 items, Instagram's cap). **Captions come only from a per-post `caption.txt`** — add one directly to that post's folder on GitHub (`inbox/<projectId>/<channelId>/<postId>/caption.txt`, after `sync-drive` has created it — Drive sync only picks up image/video files, so this one's added on the GitHub side, not from Drive) — it moves along with the rest of that post once published. A post folder with no `caption.txt` publishes with an empty caption.

The Dashboard just edits `channels.json` — enable/disable a channel, add/remove one, tweak its posting-tool fields. It reads from what's already saved on GitHub, not unsaved edits in the page — **Save to GitHub** first if you just changed something.

If you ever want to run the admin UI locally instead: `cd admin-ui && npm install && npm start`, then open http://localhost:4201. (It redeploys to GitHub Pages automatically via `.github/workflows/deploy-admin-ui.yml` on every push to `main` that touches `admin-ui/`.)

### 5. Turn it on

Workflows run on their cron schedule automatically (tunable per-workflow on the **Settings** page) — across every project in `config/projects.json` — once secrets are set and at least one channel has `"enabled": true`. To test without waiting for the schedule, use **Trigger now** on Settings (or trigger manually from the Actions tab), optionally passing `project_id`/`channel_id` inputs to scope/force a single run.

## Content Queue

**Content Queue** (admin UI, left menu) has two sections per channel:

- **Synced** — what's sitting in `inbox/<projectId>/<channelId>/` for the currently loaded project, oldest first — media type (single/carousel ×N/video) with thumbnails, whether a post has a custom `caption.txt`, and its position in that channel's FIFO queue (the oldest is tagged "Posts next run," since an enabled channel's oldest queued item goes out every time `post.yml` runs). It fetches the whole `inbox/` subtree in one Git Trees API call rather than one request per post folder, to stay well under GitHub's 60/hr unauthenticated rate limit.
- **Planned (ongoing campaigns)** — a lightweight content-planning checklist, sourced from every campaign whose **status is `ongoing`** (loaded alongside the tree). Add a planned post directly here (pick which ongoing campaign it belongs to, a stage, guidance, and an optional **target date + time**), edit or remove it, and toggle a **todo / done** prep-status chip tracking whether you've actually created that content yet — independent of whether it's synced or posted. The target-date dropdown is generated from that post's campaign's start/end dates (or the next 30 days if unset).
  - **Date only** stays a pure planning label (shown as a `📅` badge) — doesn't affect when anything posts.
  - **Date + time** turns the slot into a real scheduled post — see [Scheduled posts](#scheduled-posts) below.

Requires a project's channels to already be loaded on the Dashboard.

**Connected to Campaigns**: each Synced post shows either a `🎯 <campaign> — <stage>` badge (already linked to a slot) or a **Link to "…"** button per open slot it could fulfil; each unlinked Planned row, symmetrically, shows a **Link media: "…"** button per currently-synced post it could claim. Same underlying link Campaigns' own detail view creates — reachable from whichever side you're looking at.

## Campaigns

**Campaigns** (admin UI, left menu) plans a marketing push as an ordered sequence of post "slots" — each tagged with a funnel stage (awareness/consideration/conversion/loyalty, or a custom label), a channel, and guidance text on what that post should actually be — then tracks where each one really is, so campaign execution doesn't depend on memory.

- **Build one**: name + goal, pick which channel(s) it runs on, then add slots in order (quick-pick a stage for sensible default guidance, or write your own). Reorder with the ↑/↓ buttons. Optionally set a **per-channel post-count goal** in the same step (e.g. "5 posts on `travel-besty-instagram`") — a live counter shows how many slots you've drafted toward it as you build. Saved to `config/<projectId>/campaigns.json`.
- **Track it**: the campaign's detail view always surfaces a **"What to do next"** callout — the first slot that isn't posted yet, with its guidance. Once something matching that slot is synced from Drive, link it from the Content Queue's list of currently-queued posts (fetched the same way Content Queue does, via one Git Trees API call) — the slot flips to `queued`.
- **Auto-completion**: when `post.yml` actually publishes a post whose folder is linked to a slot, `post.ts` flips that slot to `posted` and records the timestamp automatically — no manual bookkeeping once a post is linked. If a per-channel goal was set, the detail view shows actual posted count against it (e.g. "3/5 posted toward goal") — a progress readout only, nothing enforces it. Goals can be added, changed, or cleared later from the same detail view (**Set goal** / **Edit goal** next to each channel) — not just at creation time; setting a goal to 0 removes it. The detail view also has a **Status** dropdown (`open` / `ongoing` / `done`, shown on the campaign's card in the list too), an **Edit dates** control for start/end, and a **Rename** control for the campaign's name — all purely descriptive, set by hand, not read by automation. **Delete campaign** removes it entirely (with a confirmation step, and a heads-up if any of its slots are `queued`/`posted`, since deleting drops their campaign link — the actual synced/posted media in `inbox/`/`posted/` is untouched either way).

This is a planning/tracking layer on top of the existing posting engine — for a slot with no target time, campaigns don't gate or reorder what actually posts; each channel's `enabled` flag still decides that. A slot *with* a target date+time is the one exception — see below.

**Known limitation:** if a linked post is deleted or moved out of `inbox/` by hand instead of through the normal sync → post flow, its slot stays stuck on `queued` — nothing currently detects and clears a broken link.

## Scheduled posts

Setting **both** a target date and a target time on a Planned post (Content Queue) turns it into a real scheduled post, handled by `.github/workflows/scheduled-posts.yml` (every 5 minutes, unlike the other hourly workflows). Once that date+time has passed:

- **Media linked** (`status: "queued"`) — `scheduled-posts.ts` publishes that specific post immediately, via the same publish pipeline `post.ts` uses, then marks the slot `posted`. This bypasses the channel's usual oldest-file-first queue entirely — it's not "wait your turn," it's "go now."
- **Not linked, but an `expectedFileName` is set** — before giving up, `scheduled-posts.ts` looks for a file with that *exact* name: first among this channel's already-synced-but-unclaimed `inbox/` folders, then (if not found there) live in the channel's Drive folder itself, downloading it directly if found. Either way, once matched it links and publishes immediately, same as above. This is how you can name a file when planning the post, upload it to Drive whenever, and have it get picked up and posted automatically at the scheduled time without ever touching Content Queue again.
- **No media linked, and no match** (`status: "planned"`) — same notification mechanism as [Scheduler](#scheduler-personal-reminders): logs the message (naming the expected filename if one was set), opens a **GitHub issue** with the full detail (project, campaign, stage, channel, reason), and marks it notified (so it doesn't repeat every run). The run only fails (triggering GitHub's "workflow run failed" email) as a **backup**, specifically if that issue itself couldn't be opened — see [Post notifications](#post-notifications). Link media (or upload the expected file) before the target time to avoid this.

**Filename matching is exact and case-sensitive** — `IMG_1234.jpg` won't match `img_1234.jpg` or a Drive auto-rename like `IMG_1234 (1).jpg`. It's also single-file only; carousels (a Drive subfolder) aren't matched by name.

**File type is checked up front, against the expected filename's extension** — `.jpg`/`.jpeg`/`.png`/`.webp` for images, `.mp4`/`.mov`/`.webm` for video (case-insensitive). If `expectedFileName` doesn't have one of these, `scheduled-posts.ts` doesn't even look for it — it notifies immediately with a clear "unsupported extension" message, rather than searching, downloading, and then failing later with a confusing "no media" notification for a file that actually exists.

**Why the regular hourly `post.yml` won't "steal" a scheduled post early:** a post folder linked to a slot with a future target time is treated as reserved — `post.ts`'s normal oldest-file-first pick skips it and falls through to the next unreserved folder (or does nothing, if that was the only one waiting). Once the target time passes, the reservation lifts and it becomes fair game for the regular flow too, in case `scheduled-posts.yml` missed it for some reason.

**Precision:** unlike the other workflows (hourly), `scheduled-posts.yml` runs every 5 minutes — a target time is acted on (published, or notified as missing media) within a few minutes of passing, not up to an hour late. GitHub's own failure-email notification fires immediately once that check run actually fails, so the only real delay is the up-to-~5-minute wait for the next check itself.

## Post notifications

Every actual publish attempt — from `post.ts`'s regular FIFO queue or `scheduled-posts.ts`'s time-scheduled slots — opens a GitHub issue either way:

- **Success** — a `✅ Posted: ...` issue is opened and immediately closed, so it still shows up in GitHub's normal issue notifications without piling up in your open-issues list over time.
- **Failure** (the publisher call throws — a Buffer error, a missing token, etc.) — a `❌ Post failed: ...` issue is opened and left open, with the actual error in the body. The post folder is left in place in `inbox/` (or the scheduled slot stays `queued`) rather than being moved/marked, so it's automatically retried on the workflow's next run. The run only ends up marked failed — triggering GitHub's built-in "workflow run failed" email — as a **backup**, specifically if *that failure issue itself* couldn't be opened; a normal run where the issue opens fine stays green even though a post failed, since the issue already told you.

**One channel's failure doesn't block the others** — each channel's post attempt is individually wrapped, so if channel A's post fails, channel B still gets its turn in the same run instead of the whole run aborting. The "commit posted state" step in both workflows runs with `if: always()` for the same reason: whatever *did* succeed this run should still get committed even if something else in the same run failed.

## Scheduler (personal reminders)

**Scheduler** (admin UI, left menu) is a calendar for personal reminders, unrelated to any project — click a day, add a time and a message, **Save to GitHub**. `.github/workflows/reminders.yml` runs hourly; for any reminder whose date/time has passed and hasn't fired yet, it logs the message, opens a **GitHub issue** titled with the reminder text, marks it notified, and commits `config/reminders.json` — no external email service, no new secret, no new API key (issue creation reuses the auto-generated `GITHUB_TOKEN` every Actions run already gets, scoped via each workflow's `permissions: issues: write`).

The GitHub issue is the primary notification — it exists specifically to work around GitHub's own limitation on a workflow-failure email: it can only link to the run, not carry a custom body, so the actual message would otherwise only be visible by digging into a log. The issue puts the real text (message, project, campaign, reason) somewhere you'd naturally see it via GitHub's normal issue notifications — close it once you've handled it. **The run only deliberately fails — triggering GitHub's built-in "workflow run failed" email — as a backup, specifically when the issue itself couldn't be opened** (a permissions problem, an API hiccup): a normal run where the issue opens fine ends clean, no failure email. See [Post notifications](#post-notifications) for the same pattern applied to actual publish attempts.

The calendar also shows a second dot for any day with Content Queue **Planned** posts — every `ongoing` campaign's `planned` slots with a `targetDate`, across every project, loaded alongside reminders. It's read-only here (no editing or linking); use Content Queue or Campaigns for that.

Check **[github.com/settings/notifications](https://github.com/settings/notifications)**: GitHub notifies you for issues and for Actions failures under *separate* settings, and issue notifications additionally depend on the repo's own **Watch** level (top of the repo page) — the default "Participating and @mentions" won't notify you for an issue opened by `github-actions[bot]` unless you switch it to **All Activity**.

## Settings (workflow schedules)

**Settings** (admin UI, left menu) edits how often `sync-drive.yml`, `post.yml`, `reminders.yml`, and `scheduled-posts.yml` actually run — no need to hand-edit YAML in the repo. There's no separate API for a workflow's cron; the schedule lives in a `cron:` line inside each workflow file on `main`, so **Save schedule** reads that file's raw text, swaps in the new cron expression, and commits it straight back via the same GitHub Contents API every other Save button in this app uses.

**GitHub Actions cron has no seconds field** — one minute is the finest granularity possible here, full stop, regardless of what this page offers.

Each workflow's **Schedule type** dropdown picks between three shapes, freely switchable per workflow — nothing is locked to one pattern:
- **Every hour, at a specific minute** (0–59) — the default for `sync-drive`/`post`/`reminders`, intentionally offset from each other (`:00`/`:15`/`:30`) so their auto-commits don't land in the same push and race each other.
- **Every N minutes** (1/5/10/15/20/30/60) — what `scheduled-posts.yml` uses by default, since it polls rather than firing once an hour — see [Scheduled posts](#scheduled-posts).
- **On specific days, at a specific time** — an hour (0–23) + minute (0–59), plus a day-of-week picker with **Every day**/**Weekdays**/**Weekends** presets or individual day checkboxes. Useful for something that should only run, say, weekday mornings rather than every hour around the clock.

Setting two workflows to the same minute (whichever pattern each is using) shows a non-blocking heads-up, not a hard block — auto-commits landing in the same push can occasionally collide. **Trigger now** runs a workflow immediately (same as "Run workflow" on the Actions tab) without touching its schedule. If a workflow's `cron:` line were ever hand-edited into some other shape than these three (a day-of-month restriction, a month restriction, an hour range), its card falls back to a read-only display of the raw expression rather than risk mangling something this page doesn't understand. **Save schedule** needs the same **Contents: read and write** token as any other Save button here; **Trigger now** additionally needs **Actions: read and write**.

## Local development / dry runs

Both automation scripts respect `DRY_RUN=true`, which logs what would happen instead of calling Google Drive or Buffer — useful for checking the enabled/file-picking logic without live credentials. They loop over every project in `config/projects.json` unless scoped:

```bash
cd automation
npm install
DRY_RUN=true GITHUB_REPOSITORY=dearlavion/dearlavion-social-media-manager npm run sync-drive
DRY_RUN=true GITHUB_REPOSITORY=dearlavion/dearlavion-social-media-manager npm run post

# scoped to one project (still respects each channel's enabled flag):
DRY_RUN=true GITHUB_REPOSITORY=dearlavion/dearlavion-social-media-manager FORCE_PROJECT_ID=travel-besty npm run post

# force one specific channel within a project, ignoring its enabled flag:
DRY_RUN=true GITHUB_REPOSITORY=dearlavion/dearlavion-social-media-manager FORCE_PROJECT_ID=travel-besty FORCE_CHANNEL_ID=travel-besty-instagram npm run post
```

## Repo layout

```
.github/workflows/            sync-drive.yml, post.yml, scheduled-posts.yml, reminders.yml, deploy-admin-ui.yml
automation/                   Node/TS scripts the workflows run (config, drive.ts, drive-sync-helpers.ts, post-helpers.ts, publishers/, scheduled-posts.ts, reminders.ts, github-issues.ts)
config/projects.json          registry of every project -- [{id, name}]
config/<projectId>/channels.json   that project's channels -- id, platform, enabled, Drive folder, Buffer channel, caption
config/<projectId>/campaigns.json  that project's campaigns -- [{id, name, goal, slots: [{stage, channelId, status, linkedPostPath, ...}]}] (absent if none created yet)
config/reminders.json         personal reminders for the Scheduler -- [{id, date, time, dueAt, message, notifiedAt}]
brand/<projectId>/voice.md    that project's brand voice/content guide
inbox/<projectId>/<channelId>/<postId>/    media synced from Drive, one folder per post (1 file = single/video, 2+ = carousel), waiting to be posted
posted/<projectId>/<channelId>/<postId>/   the same, moved here after a successful post
admin-ui/                     Angular app (hosted on GitHub Pages) for editing projects/channels/reminders via the GitHub API
```
