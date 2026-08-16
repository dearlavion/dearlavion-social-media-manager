import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  loadProjects,
  loadChannels,
  saveChannels,
  loadCampaigns,
  saveCampaigns,
  isDue,
  repoRelativePath,
  inboxRoot,
} from './config.js';
import type { Campaign } from './config.js';
import { getPublisher } from './publishers/index.js';
import { MAX_CAROUSEL_ITEMS, readPostMedia, resolveCaption, movePosted, findSlotByLinkedPath } from './post-helpers.js';

/**
 * Picks the oldest post folder (still chronologically sortable by name)
 * waiting in a channel's inbox, skipping any folder "reserved" by a
 * campaign slot with a future targetDueAt -- that one is scheduled-posts.ts's
 * job to publish at its own time, not this interval-based FIFO's to grab
 * early. A folder with no reservation, or one whose reserved time has
 * already passed (scheduled-posts.ts missed it, or it's simply overdue),
 * is fair game as normal.
 */
async function nextPostFolder(projectId: string, channelId: string, campaigns: Campaign[], now: Date): Promise<string | null> {
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

  for (const name of folders) {
    const candidate = path.join(dir, name);
    const slot = findSlotByLinkedPath(campaigns, repoRelativePath(candidate));
    const reserved = slot?.targetDueAt && new Date(slot.targetDueAt).getTime() > now.getTime();
    if (reserved) continue;
    return candidate;
  }
  return null;
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

      const postDir = await nextPostFolder(project.id, channel.id, campaigns, now);
      if (!postDir) {
        console.log(`[${project.id}/${channel.id}] due, but inbox is empty (or everything in it is reserved for a scheduled post)`);
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
