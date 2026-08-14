import { readdir, mkdir, rename, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  loadProjects,
  loadChannels,
  saveChannels,
  loadCampaigns,
  saveCampaigns,
  isDue,
  publicRawUrl,
  repoRelativePath,
  inboxRoot,
  postedRoot,
} from './config.js';
import type { ChannelConfig, Campaign } from './config.js';
import { getPublisher } from './publishers/index.js';
import type { PostMedia } from './publishers/types.js';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm']);
const CAPTION_FILENAME = 'caption.txt';
/** Instagram's hard cap on carousel items -- other platforms are more lenient, this is the binding one. */
const MAX_CAROUSEL_ITEMS = 10;

/** Picks the oldest post folder (still chronologically sortable by name) waiting in a channel's inbox. */
async function nextPostFolder(projectId: string, channelId: string): Promise<string | null> {
  const dir = path.join(inboxRoot(projectId), channelId);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const folders: string[] = [];
  for (const name of entries) {
    if ((await stat(path.join(dir, name))).isDirectory()) folders.push(name);
  }
  folders.sort();
  return folders.length > 0 ? path.join(dir, folders[0]) : null;
}

async function readPostMedia(postDir: string): Promise<PostMedia[]> {
  const files = (await readdir(postDir)).filter((f) => f !== CAPTION_FILENAME).sort();
  const media: PostMedia[] = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const absPath = path.join(postDir, file);
    if (IMAGE_EXTENSIONS.has(ext)) {
      media.push({ type: 'image', url: publicRawUrl(absPath) });
    } else if (VIDEO_EXTENSIONS.has(ext)) {
      media.push({ type: 'video', url: publicRawUrl(absPath) });
    }
  }
  return media;
}

async function resolveCaption(postDir: string, channel: ChannelConfig): Promise<string> {
  try {
    const custom = await readFile(path.join(postDir, CAPTION_FILENAME), 'utf-8');
    return custom.trim();
  } catch {
    return channel.captionTemplate;
  }
}

async function movePosted(postDir: string, projectId: string, channelId: string): Promise<void> {
  const destParent = path.join(postedRoot(projectId), channelId);
  await mkdir(destParent, { recursive: true });
  await rename(postDir, path.join(destParent, path.basename(postDir)));
}

/**
 * If a Campaign slot was linked (by the admin UI) to the post folder that
 * just published, flips it to "posted". Mutates `campaigns` in place and
 * returns whether anything changed, so the caller only writes
 * campaigns.json back when there was actually a match.
 */
function markLinkedCampaignSlotPosted(campaigns: Campaign[], linkedPostPath: string, now: Date): boolean {
  let changed = false;
  for (const campaign of campaigns) {
    for (const slot of campaign.slots) {
      if (slot.linkedPostPath === linkedPostPath && slot.status !== 'posted') {
        slot.status = 'posted';
        slot.postedAt = now.toISOString();
        changed = true;
        console.log(`  -> linked campaign slot "${slot.id}" in campaign "${campaign.name}" marked posted`);
      }
    }
  }
  return changed;
}

async function main() {
  const now = new Date();
  // Set by the admin UI's "Post now" buttons, to scope a run to one project
  // (and optionally force one specific channel within it, ignoring its
  // enabled flag and due-check) instead of the default cron behavior of
  // looping every project.
  const forceProjectId = process.env['FORCE_PROJECT_ID'];
  const forceChannelId = process.env['FORCE_CHANNEL_ID'];

  for (const project of await loadProjects()) {
    if (forceProjectId && forceProjectId !== project.id) continue;

    const channels = await loadChannels(project.id);
    const campaigns = await loadCampaigns(project.id);
    let campaignsDirty = false;

    for (const channel of channels) {
      const forced = forceChannelId === channel.id;
      if (!channel.enabled && !forced) continue;
      if (!forced && !isDue(channel, now)) {
        console.log(`[${project.id}/${channel.id}] not due yet`);
        continue;
      }

      const postDir = await nextPostFolder(project.id, channel.id);
      if (!postDir) {
        console.log(`[${project.id}/${channel.id}] due, but inbox is empty`);
        continue;
      }
      const postName = path.basename(postDir);

      const media = await readPostMedia(postDir);
      if (media.length === 0) {
        // Most likely every file in this post folder tripped sync-drive's
        // size guard. Leave it in place (don't post, don't move/delete) so
        // it's visible to fix by hand, rather than losing it silently.
        console.log(
          `[${project.id}/${channel.id}] post "${postName}" has no media files (likely skipped by the size guard during sync) -- leave it or remove it from inbox/ manually`,
        );
        continue;
      }
      if (media.length > MAX_CAROUSEL_ITEMS) {
        console.log(
          `[${project.id}/${channel.id}] post "${postName}" has ${media.length} items, over Instagram's ${MAX_CAROUSEL_ITEMS}-item carousel cap -- trim it in Drive/inbox manually before it can post`,
        );
        continue;
      }

      const caption = await resolveCaption(postDir, channel);
      const publisherId = channel.publisher ?? 'buffer';
      const publish = getPublisher(publisherId);
      const mediaType = media.length === 1 ? media[0].type : 'carousel';

      console.log(
        `[${project.id}/${channel.id}] posting "${postName}" (${mediaType}, ${media.length} item(s)) to ${channel.platform} via ${publisherId}`,
      );
      await publish({ media, caption, channel });

      const linkedPostPath = repoRelativePath(postDir);
      await movePosted(postDir, project.id, channel.id);
      channel.lastPostedAt = now.toISOString();

      if (markLinkedCampaignSlotPosted(campaigns, linkedPostPath, now)) {
        campaignsDirty = true;
      }
    }

    await saveChannels(project.id, channels);
    if (campaignsDirty) {
      await saveCampaigns(project.id, campaigns);
    }
  }

  console.log('post complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
