# dearlavion-social-media-manager

Automates posting images to Instagram, TikTok, Pinterest, and Facebook, each on its own schedule. Images are dropped into a Google Drive folder; a GitHub Actions workflow syncs them into this repo, and another posts the oldest un-posted image for each due channel. A small local admin UI manages which channels exist and how often they post.

No server to host: everything runs as scheduled GitHub Actions workflows.

## How it works

1. **Sync** (`.github/workflows/sync-drive.yml`, hourly): for each enabled channel, lists new images in its configured Google Drive folder and commits them into `inbox/<channelId>/`.
2. **Post** (`.github/workflows/post.yml`, hourly, offset 15 min after sync): for each enabled channel whose `intervalHours` has elapsed since `lastPostedAt`, posts the oldest image in `inbox/<channelId>/` to that channel's platform, then moves it to `posted/<channelId>/` and updates `lastPostedAt`.
3. **Admin UI** (`admin-ui/`, run locally): add/edit/enable channels — platform, posting interval, Drive folder — by editing `config/channels.json` directly on GitHub through your browser.

## One-time setup

### 1. Push this repo to GitHub

This was scaffolded locally and committed, but not pushed anywhere. Create `dearlavion/dearlavion-social-media-manager` (or wherever you want it) on GitHub and push.

**Important:** Instagram and Pinterest publish from a public image URL (`raw.githubusercontent.com/...`), not a binary upload — so this repo needs to be **public**, or those two platforms won't be able to fetch the image. Facebook and TikTok don't have this requirement.

### 2. Google Drive — image source

1. In Google Cloud Console, create a project (or reuse one), enable the **Google Drive API**.
2. Create a **service account**, generate a JSON key.
3. Share each Drive folder you'll use as an image source with that service account's email (Viewer access is enough).
4. Add the full JSON key as a GitHub repo secret named `GDRIVE_SERVICE_ACCOUNT_JSON` (Settings → Secrets and variables → Actions).

### 3. Facebook — simplest of the four

1. Create a Meta developer app at developers.facebook.com, add the Facebook Login/Pages product.
2. Generate a Page access token for the Page you'll post to (long-lived, `pages_manage_posts` + `pages_read_engagement` scopes).
3. Add secrets: `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`.

### 4. Instagram — needs a Business/Creator account

1. Your Instagram account must be a Business or Creator account, linked to a Facebook Page.
2. In the same (or another) Meta developer app, add the Instagram Graph API product.
3. Get the IG user ID (`GET /{page-id}?fields=instagram_business_account`) and a long-lived access token with `instagram_content_publish` scope.
4. Add secrets: `INSTAGRAM_BUSINESS_ACCOUNT_ID`, `INSTAGRAM_ACCESS_TOKEN`.
5. **Reminder:** requires the repo to be public (see above) so `graph.facebook.com` can fetch the image URL.

### 5. Pinterest

1. Register an app at developers.pinterest.com, complete OAuth to get an access token with `pins:write` scope for the board you'll post to.
2. Add secrets: `PINTEREST_BOARD_ID`, `PINTEREST_ACCESS_TOKEN`.

### 6. TikTok — expect friction

1. Register an app at developers.tiktok.com and request the Content Posting API.
2. **TikTok gates public/direct posting behind app review.** Until your app is approved, `platforms/tiktok.ts` posts with `privacy_level: "SELF_ONLY"` so it only reaches your own account — change that once you're approved for public posting.
3. Add secret: `TIKTOK_ACCESS_TOKEN`.

### 7. Enable/configure channels

**Hosted (recommended):** `.github/workflows/deploy-admin-ui.yml` builds `admin-ui/` and deploys it to GitHub Pages on every push to `main` that touches `admin-ui/`. One-time setup: on GitHub, go to **Settings → Pages → Build and deployment → Source**, and select **GitHub Actions** (this can't be done via git/API, it's a repo-settings toggle only you can make). After that, push once (or run the workflow manually) and the UI is live at:

```
https://dearlavion.github.io/dearlavion-social-media-manager/
```

Note: GitHub Pages needs a public repo unless you're on a paid GitHub plan — which you need anyway for the Instagram/Pinterest public-image-URL requirement above.

**Local (alternative):** run it on your own machine instead:

```bash
cd admin-ui
npm install
npm start
```
Open http://localhost:4201.

Either way: fill in your repo owner/name/branch, paste a **fine-grained GitHub PAT** scoped to this repo with `Contents: read and write` permission (kept only in this browser tab's session storage — never sent anywhere but `api.github.com`), then load, edit, and save `config/channels.json`.

Each channel needs: a unique `id`, `platform`, `intervalHours`, `driveFolderId`, and a default `captionTemplate`. To override the caption for one specific image, drop a `<image-filename>.caption.txt` file next to it in the Drive folder (or directly in `inbox/<channelId>/`) — it's used instead of the template and moved along with the image once posted.

### 8. Turn it on

Workflows run on their cron schedule automatically once secrets are set and at least one channel has `"enabled": true`. To test without waiting for the schedule, trigger either workflow manually from the Actions tab (`workflow_dispatch`).

## Local development / dry runs

Both automation scripts respect `DRY_RUN=true`, which logs what would happen instead of calling Google Drive or the platform APIs — useful for checking the due-check/file-picking logic without live credentials:

```bash
cd automation
npm install
DRY_RUN=true GITHUB_REPOSITORY=dearlavion/dearlavion-social-media-manager npm run sync-drive
DRY_RUN=true GITHUB_REPOSITORY=dearlavion/dearlavion-social-media-manager npm run post
```

## Repo layout

```
.github/workflows/   sync-drive.yml, post.yml — the two scheduled jobs
automation/          Node/TS scripts the workflows run (config, drive sync, per-platform publish)
config/channels.json the list of channels — id, platform, interval, Drive folder, caption
inbox/<channelId>/   images synced from Drive, waiting to be posted
posted/<channelId>/  images after a successful post
admin-ui/            local Angular app for editing config/channels.json via the GitHub API
```
