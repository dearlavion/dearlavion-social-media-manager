# dearlavion-social-media-manager

Automates posting images to Instagram, TikTok, and Facebook, each on its own schedule. Images are dropped into a Google Drive folder; a GitHub Actions workflow syncs them into this repo, and another posts the oldest un-posted image for each due channel via [Buffer](https://buffer.com), which holds the actual OAuth connection to each platform. A small admin UI (hosted on GitHub Pages) manages which channels exist and how often they post.

No server to host: everything runs as scheduled GitHub Actions workflows.

## How it works

1. **Sync** (`.github/workflows/sync-drive.yml`, hourly): for each enabled channel, lists new images in its configured Google Drive folder and commits them into `inbox/<channelId>/`.
2. **Post** (`.github/workflows/post.yml`, hourly, offset 15 min after sync): for each enabled channel whose `intervalHours` has elapsed since `lastPostedAt`, posts the oldest image in `inbox/<channelId>/` to that channel's Buffer channel (`shareNow`, published immediately — our cron is what decides *when*, Buffer's own queue isn't used), then moves it to `posted/<channelId>/` and updates `lastPostedAt`.
3. **Admin UI** (`admin-ui/`, https://dearlavion.github.io/dearlavion-social-media-manager/): add/edit/enable channels — platform, posting interval, Drive folder, Buffer channel — by editing `config/channels.json` directly on GitHub through your browser.

### Why Buffer instead of each platform's API directly

Integrating Instagram/TikTok/Facebook's APIs directly means registering a separate developer app with each of them — real setup friction, and TikTok in particular gates public posting behind app review. Buffer's already done that OAuth registration for all of them: you connect each account once inside Buffer's own UI, and this repo only needs a single Buffer API token. Trade-off: Buffer's **free plan caps you at 3 connected channels** (which is exactly Instagram + TikTok + Facebook — why Pinterest was dropped), and API access requires that a Buffer account exists at all. Paid plans start at $5/channel/mo if you want more.

## One-time setup

### 1. Push this repo to GitHub

Already done — pushed to `dearlavion/dearlavion-social-media-manager`.

**Important:** Buffer's `createPost` only accepts a publicly-fetchable image URL (`raw.githubusercontent.com/...`), not a binary upload — so this repo needs to stay **public**, or posting will fail for every channel.

### 2. Google Drive — image source

1. In Google Cloud Console, create a project (or reuse one), enable the **Google Drive API**.
2. Create a **service account** (no IAM project role needed — Drive access comes from sharing the folder, not from a project role), generate a JSON key.
3. Share each Drive folder you'll use as an image source with that service account's email (Viewer access is enough).
4. Add the full JSON key as a GitHub repo secret named `GDRIVE_SERVICE_ACCOUNT_JSON` (Settings → Secrets and variables → Actions).

### 3. Buffer — connects to Instagram, TikTok, and Facebook

1. Create a free account at [buffer.com](https://buffer.com) if you don't have one, and connect your Instagram, TikTok, and Facebook accounts to it from Buffer's own dashboard (that's where the real OAuth happens — nothing to register yourself).
2. Get a personal API key: Buffer account → **Settings → API** ([buffer.com/settings/api](https://publish.buffer.com/settings/api)) → create a personal API key.
3. Add it as a GitHub repo secret named `BUFFER_ACCESS_TOKEN`.
4. For each connected account, find its **Buffer channel ID** — query Buffer's GraphQL API (`https://api.buffer.com`) with your token:
   ```graphql
   query { account { organizations { id } } }
   ```
   then, using that organization id:
   ```graphql
   query { channels(input: { organizationId: "YOUR_ORG_ID" }) { id name service } }
   ```
   Match `service` (instagram/tiktok/facebook) to the right channel and copy its `id` — that's the `bufferChannelId` you'll enter in the admin UI per channel.

### 4. Enable/configure channels

Open the admin UI: **https://dearlavion.github.io/dearlavion-social-media-manager/**

Fill in your repo owner/name/branch (pre-filled by default), paste a **fine-grained GitHub PAT** scoped to this repo with `Contents: read and write` permission (kept only in this browser tab's session storage — never sent anywhere but `api.github.com`), then load, edit, and save `config/channels.json`.

Each channel needs: a unique `id`, `platform` (label only, for your own reference), `intervalHours`, `driveFolderId`, `bufferChannelId`, and a default `captionTemplate`. To override the caption for one specific image, drop a `<image-filename>.caption.txt` file next to it in the Drive folder (or directly in `inbox/<channelId>/`) — it's used instead of the template and moved along with the image once posted.

If you ever want to run the admin UI locally instead: `cd admin-ui && npm install && npm start`, then open http://localhost:4201. (It redeploys to GitHub Pages automatically via `.github/workflows/deploy-admin-ui.yml` on every push to `main` that touches `admin-ui/`.)

### 5. Turn it on

Workflows run on their cron schedule automatically once secrets are set and at least one channel has `"enabled": true`. To test without waiting for the schedule, trigger either workflow manually from the Actions tab (`workflow_dispatch`).

## Local development / dry runs

Both automation scripts respect `DRY_RUN=true`, which logs what would happen instead of calling Google Drive or Buffer — useful for checking the due-check/file-picking logic without live credentials:

```bash
cd automation
npm install
DRY_RUN=true GITHUB_REPOSITORY=dearlavion/dearlavion-social-media-manager npm run sync-drive
DRY_RUN=true GITHUB_REPOSITORY=dearlavion/dearlavion-social-media-manager npm run post
```

## Repo layout

```
.github/workflows/   sync-drive.yml, post.yml, deploy-admin-ui.yml
automation/          Node/TS scripts the workflows run (config, drive sync, buffer.ts publish)
config/channels.json the list of channels — id, platform, interval, Drive folder, Buffer channel, caption
inbox/<channelId>/   images synced from Drive, waiting to be posted
posted/<channelId>/  images after a successful post
admin-ui/            Angular app (hosted on GitHub Pages) for editing config/channels.json via the GitHub API
```
