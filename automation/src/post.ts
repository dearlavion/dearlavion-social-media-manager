import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  loadProjects,
  loadChannels,
  saveChannels,
  loadCampaigns,
  saveCampaigns,
  repoRelativePath,
  inboxRoot,
} from './config.js';
import type { Campaign, Project } from './config.js';
import { getPublisher } from './publishers/index.js';
import { MAX_CAROUSEL_ITEMS, readPostMedia, resolveCaption, movePosted, findSlotByLinkedPath } from './post-helpers.js';
import { openNotificationIssue, openAndCloseNotificationIssue } from './github-issues.js';

/**
 * Picks the oldest post folder (still chronologically sortable by name)
 * waiting in a channel's inbox, skipping any folder "reserved" by a
 * campaign slot with a future targetDueAt -- that one is scheduled-posts.ts's
 * job to publish at its own time, not this FIFO's to grab early. A folder
 * with no reservation, or one whose reserved time has already passed
 * (scheduled-posts.ts missed it, or it's simply overdue), is fair game as
 * normal.
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

function postOutcomeBody(project: Project, channel: { id: string; platform: string }, postName: string, mediaType: string, itemCount: number, publisherId: string, extra?: string): string {
  return [
    `**Project:** ${project.name}`,
    `**Channel:** ${channel.id} (${channel.platform})`,
    `**Post:** ${postName} (${mediaType}, ${itemCount} item(s))`,
    `**Publisher:** ${publisherId}`,
    ...(extra ? ['', extra] : []),
  ].join('\n');
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
  // enabled flag) instead of the default cron behavior of looping every
  // project.
  const forceProjectId = process.env['FORCE_PROJECT_ID'];
  const forceChannelId = process.env['FORCE_CHANNEL_ID'];
  let anyIssueFailed = false; // only set when the failure-notification issue itself couldn't be opened -- that's what makes the run exit non-zero now

  for (const project of await loadProjects()) {
    if (forceProjectId && forceProjectId !== project.id) continue;

    const channels = await loadChannels(project.id);
    const campaigns = await loadCampaigns(project.id);
    let campaignsDirty = false;

    for (const channel of channels) {
      const forced = forceChannelId === channel.id;
      if (!channel.enabled && !forced) continue;

      const postDir = await nextPostFolder(project.id, channel.id, campaigns, now);
      if (!postDir) {
        console.log(`[${project.id}/${channel.id}] inbox is empty (or everything in it is reserved for a scheduled post)`);
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

      const caption = await resolveCaption(postDir);
      const publisherId = channel.publisher ?? 'buffer';
      const publish = getPublisher(publisherId);
      const mediaType = media.length === 1 ? media[0].type : 'carousel';
      // A regular synced post isn't necessarily linked to a campaign slot -- falls through to buffer.ts's own "post" default when there's no slot (or the slot didn't set one).
      const linkedSlot = findSlotByLinkedPath(campaigns, repoRelativePath(postDir));

      console.log(
        `[${project.id}/${channel.id}] posting "${postName}" (${mediaType}, ${media.length} item(s)) to ${channel.platform} via ${publisherId}`,
      );

      try {
        await publish({ media, caption, channel, instagramPostType: linkedSlot?.instagramPostType });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`::error::[${project.id}/${channel.id}] FAILED to post "${postName}": ${message}`);
        const issueOpened = await openNotificationIssue(
          `❌ Post failed: ${project.name} / ${channel.id}`,
          postOutcomeBody(project, channel, postName, mediaType, media.length, publisherId, `**Error:** ${message}\n\n_Left in place in inbox/ -- nothing was moved, so this will be retried on the next run. Close this once handled._`),
          ['post-failure'],
        );
        if (!issueOpened) anyIssueFailed = true;
        continue; // don't abort the rest of this channel's turn or the other channels -- try again next run
      }

      // Buffer already accepted the post -- from here on, nothing may throw uncaught, or a housekeeping
      // failure (e.g. movePosted's rename) would crash the script before this gets saved, aborting every
      // remaining channel in this run too. Mark posted first, then best-effort the rest.
      const linkedPostPath = repoRelativePath(postDir);
      channel.lastPostedAt = now.toISOString();
      if (markLinkedCampaignSlotPosted(campaigns, linkedPostPath, now)) {
        campaignsDirty = true;
      }

      try {
        await movePosted(postDir, project.id, channel.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`::warning::[${project.id}/${channel.id}] posted successfully, but failed to move "${postName}" to posted/: ${message}`);
      }

      try {
        await openAndCloseNotificationIssue(
          `✅ Posted: ${project.name} / ${channel.id}`,
          postOutcomeBody(project, channel, postName, mediaType, media.length, publisherId),
          ['post-success'],
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`::warning::[${project.id}/${channel.id}] posted successfully, but the success notification failed: ${message}`);
      }
    }

    await saveChannels(project.id, channels);
    if (campaignsDirty) {
      await saveCampaigns(project.id, campaigns);
    }
  }

  console.log('post complete');
  if (anyIssueFailed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
