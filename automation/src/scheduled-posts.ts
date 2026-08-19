import { appendFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  REPO_ROOT,
  loadProjects,
  loadChannels,
  saveChannels,
  loadCampaigns,
  saveCampaigns,
  inboxRoot,
  repoRelativePath,
} from './config.js';
import type { Campaign, CampaignSlot, Project } from './config.js';
import { getPublisher } from './publishers/index.js';
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, MAX_CAROUSEL_ITEMS, readPostMedia, resolveCaption, movePosted } from './post-helpers.js';
import { findFileByName } from './drive.js';
import { postFolderName, downloadEntry } from './drive-sync-helpers.js';
import { openNotificationIssue, openAndCloseNotificationIssue } from './github-issues.js';

/**
 * Runs alongside (not instead of) post.ts's interval-based FIFO posting.
 * A campaign slot only participates here once it has a `targetDueAt`
 * (admin UI sets this when both a target date *and* time are picked --
 * date-only stays a pure label). Once due:
 *   - "queued" (media already linked): publish that specific folder now,
 *     via the same helpers post.ts uses, then mark the slot posted.
 *   - "planned" with an `expectedFileName`: try to auto-link it first --
 *     check this channel's already-synced-but-unclaimed inbox folders for
 *     a file with that exact name, then (if not found) look it up live in
 *     Drive and download it directly. Either way, once linked it falls
 *     through to publish immediately, same as an already-queued slot.
 *   - "planned" otherwise (nothing linked, no match found): log + notify
 *     once via a GitHub issue (same mechanism as reminders.ts; the
 *     workflow-failure email is only a backup for when the issue itself
 *     fails to open), then stay quiet on later runs so it doesn't repeat
 *     every hour forever.
 */

/** Opens a GitHub issue with the full context for one overdue slot -- see github-issues.ts for why, alongside the ::error:: annotation/failure email. Returns whether the issue was actually created. */
function notifySlotIssue(
  title: string,
  project: Project,
  campaign: Campaign,
  channel: { id: string },
  slot: CampaignSlot,
  reason: string,
): Promise<boolean> {
  const body = [
    `**Project:** ${project.name}`,
    `**Campaign:** ${campaign.name}`,
    `**Stage:** ${slot.stage}`,
    `**Channel:** ${channel.id}`,
    `**Was due:** ${slot.targetDueAt}`,
    `**Reason:** ${reason}`,
    '',
    '_Opened automatically by scheduled-posts.yml -- close this once handled._',
  ].join('\n');
  return openNotificationIssue(title, body, ['scheduled-post']);
}

function publishOutcomeBody(project: Project, channel: { id: string }, linkedPostPath: string, mediaType: string, itemCount: number, publisherId: string, extra?: string): string {
  return [
    `**Project:** ${project.name}`,
    `**Channel:** ${channel.id}`,
    `**Post:** ${linkedPostPath} (${mediaType}, ${itemCount} item(s))`,
    `**Publisher:** ${publisherId}`,
    ...(extra ? ['', extra] : []),
  ].join('\n');
}

/** Every linkedPostPath already claimed by some slot in this project, so filename matching can't steal media reserved for a different post. */
function claimedPaths(campaigns: Campaign[]): Set<string> {
  const claimed = new Set<string>();
  for (const c of campaigns) {
    for (const s of c.slots) {
      if (s.linkedPostPath) claimed.add(s.linkedPostPath);
    }
  }
  return claimed;
}

/** Scans a channel's inbox for an already-synced, unclaimed post folder containing a file with this exact name. */
async function findInInbox(
  projectId: string,
  channelId: string,
  fileName: string,
  claimed: Set<string>,
): Promise<string | null> {
  const dir = path.join(inboxRoot(projectId), channelId);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  for (const name of entries) {
    const postDir = path.join(dir, name);
    if (claimed.has(repoRelativePath(postDir))) continue;
    let files: string[];
    try {
      files = await readdir(postDir);
    } catch {
      continue;
    }
    if (files.includes(fileName)) return postDir;
  }
  return null;
}

async function main() {
  const now = new Date();
  let anyIssueFailed = false; // only set when a notification issue itself failed to open -- that's what triggers the backup failure-email now

  for (const project of await loadProjects()) {
    const channels = await loadChannels(project.id);
    const campaigns = await loadCampaigns(project.id);
    let channelsDirty = false;
    let campaignsDirty = false;
    const claimed = claimedPaths(campaigns);

    for (const campaign of campaigns) {
      for (const slot of campaign.slots) {
        if (!slot.targetDueAt || slot.status === 'posted') continue;
        if (new Date(slot.targetDueAt).getTime() > now.getTime()) continue; // not due yet

        const channel = channels.find((c) => c.id === slot.channelId);
        if (!channel) {
          console.log(`[${project.id}] campaign "${campaign.name}" slot "${slot.id}" targets unknown channel "${slot.channelId}" -- skipping`);
          continue;
        }
        if (!channel.enabled) {
          console.log(`[${project.id}/${channel.id}] campaign "${campaign.name}" slot "${slot.id}" is due but the channel is disabled -- skipping`);
          continue;
        }

        const label = `[${project.id}/${channel.id}] campaign "${campaign.name}" stage "${slot.stage}"`;

        if (slot.status === 'planned' && slot.expectedFileName) {
          const ext = path.extname(slot.expectedFileName).toLowerCase();
          if (!IMAGE_EXTENSIONS.has(ext) && !VIDEO_EXTENSIONS.has(ext)) {
            // Fail fast, before even looking -- a match would just get silently dropped by readPostMedia later,
            // producing a confusing "no media" notification for a file that actually exists.
            if (!slot.scheduledNotifiedAt) {
              const supported = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS].join(', ');
              const reason = `Expected file "${slot.expectedFileName}" has an unsupported extension (need one of ${supported}) -- rename it or pick a supported format.`;
              console.log(`::error::📅 SCHEDULED POST DUE: ${label} was due ${slot.targetDueAt} but ${reason}`);
              const issueOpened = await notifySlotIssue(
                `📅 Scheduled post: unsupported file "${slot.expectedFileName}"`,
                project,
                campaign,
                channel,
                slot,
                reason,
              );
              if (!issueOpened) anyIssueFailed = true;
              slot.scheduledNotifiedAt = now.toISOString();
              campaignsDirty = true;
            }
            continue;
          }

          const inboxHit = await findInInbox(project.id, channel.id, slot.expectedFileName, claimed);
          if (inboxHit) {
            slot.linkedPostPath = repoRelativePath(inboxHit);
            slot.status = 'queued';
            claimed.add(slot.linkedPostPath);
            campaignsDirty = true;
            console.log(`${label}: matched expected file "${slot.expectedFileName}" already synced at "${slot.linkedPostPath}"`);
          } else {
            const driveHit = await findFileByName(channel.driveFolderId, slot.expectedFileName).catch((err) => {
              console.log(`${label}: Drive lookup for "${slot.expectedFileName}" failed -- ${err instanceof Error ? err.message : String(err)}`);
              return null;
            });
            if (driveHit) {
              const postDir = path.join(inboxRoot(project.id), channel.id, postFolderName(driveHit));
              await downloadEntry(driveHit, postDir, label);
              channel.syncedDriveFileIds.push(driveHit.id);
              channelsDirty = true;
              slot.linkedPostPath = repoRelativePath(postDir);
              slot.status = 'queued';
              claimed.add(slot.linkedPostPath);
              campaignsDirty = true;
              console.log(`${label}: found "${slot.expectedFileName}" in Drive, downloaded to "${slot.linkedPostPath}"`);
              // Don't fall through to publish this same run -- the file only exists on local disk right now, not
              // yet on GitHub (the "Commit posted state" step pushes it *after* this script finishes), so Buffer's
              // fetch of the raw.githubusercontent.com URL would fail. Publish next run instead, once it's pushed.
              continue;
            }
          }
        }

        if (slot.status === 'planned') {
          if (!slot.scheduledNotifiedAt) {
            const detail = slot.expectedFileName
              ? `expected file "${slot.expectedFileName}" not found in Drive yet`
              : 'has no media linked';
            const reason = `Slot ${detail} -- link one in Content Queue.`;
            console.log(`::error::📅 SCHEDULED POST DUE: ${label} was due ${slot.targetDueAt} but ${detail} -- link one in Content Queue.`);
            const issueOpened = await notifySlotIssue(`📅 Scheduled post overdue: ${campaign.name} — ${slot.stage}`, project, campaign, channel, slot, reason);
            if (!issueOpened) anyIssueFailed = true;
            slot.scheduledNotifiedAt = now.toISOString();
            campaignsDirty = true;
          }
          continue;
        }

        // status === "queued" -- media linked (by hand earlier, or just now above), publish it now regardless of the channel's own interval/FIFO position.
        if (!slot.linkedPostPath) {
          console.log(`::error::📅 SCHEDULED POST DUE: ${label} is "queued" but has no linkedPostPath (data inconsistency) -- skipping.`);
          continue;
        }

        const postDir = path.join(REPO_ROOT, slot.linkedPostPath);
        const media = await readPostMedia(postDir).catch(() => []); // folder may have been moved/deleted by hand since linking
        if (media.length === 0) {
          if (!slot.scheduledNotifiedAt) {
            const reason = `Linked post "${slot.linkedPostPath}" has no media (missing, moved, or empty) -- relink it in Content Queue.`;
            console.log(`::error::📅 SCHEDULED POST DUE: ${label} is due but ${reason}`);
            const issueOpened = await notifySlotIssue(`📅 Scheduled post overdue: linked media missing`, project, campaign, channel, slot, reason);
            if (!issueOpened) anyIssueFailed = true;
            slot.scheduledNotifiedAt = now.toISOString();
            campaignsDirty = true;
          }
          continue;
        }
        if (media.length > MAX_CAROUSEL_ITEMS) {
          console.log(`${label}: linked post has ${media.length} items, over the ${MAX_CAROUSEL_ITEMS}-item carousel cap -- trim it manually before it can post`);
          continue;
        }

        const caption = await resolveCaption(postDir);
        const publisherId = channel.publisher ?? 'buffer';
        const publish = getPublisher(publisherId);
        const mediaType = media.length === 1 ? media[0].type : 'carousel';

        console.log(`${label}: publishing "${slot.linkedPostPath}" (${mediaType}, ${media.length} item(s)) via ${publisherId}`);

        try {
          await publish({ media, caption, channel, instagramPostType: slot.instagramPostType });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.log(`::error::${label}: FAILED to publish "${slot.linkedPostPath}": ${message}`);
          const issueOpened = await openNotificationIssue(
            `❌ Scheduled post failed: ${campaign.name} — ${slot.stage}`,
            publishOutcomeBody(project, channel, slot.linkedPostPath, mediaType, media.length, publisherId, `**Error:** ${message}\n\n_Left linked and queued -- this will be retried on the next run. Close this once handled._`),
            ['post-failure'],
          );
          if (!issueOpened) anyIssueFailed = true;
          continue; // leave it linked/queued so the next run retries it, and move on to the next slot
        }

        await movePosted(postDir, project.id, channel.id);
        channel.lastPostedAt = now.toISOString();
        channelsDirty = true;

        slot.status = 'posted';
        slot.postedAt = now.toISOString();
        campaignsDirty = true;

        await openAndCloseNotificationIssue(
          `✅ Scheduled post published: ${campaign.name} — ${slot.stage}`,
          publishOutcomeBody(project, channel, slot.linkedPostPath, mediaType, media.length, publisherId),
          ['post-success'],
        );
      }
    }

    if (channelsDirty) await saveChannels(project.id, channels);
    if (campaignsDirty) await saveCampaigns(project.id, campaigns);
  }

  console.log('scheduled-posts complete');

  const githubOutput = process.env['GITHUB_OUTPUT'];
  if (githubOutput && anyIssueFailed) {
    appendFileSync(githubOutput, 'notify_failed=true\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
