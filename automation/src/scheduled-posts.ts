import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, loadProjects, loadChannels, saveChannels, loadCampaigns, saveCampaigns } from './config.js';
import { getPublisher } from './publishers/index.js';
import { MAX_CAROUSEL_ITEMS, readPostMedia, resolveCaption, movePosted } from './post-helpers.js';

/**
 * Runs alongside (not instead of) post.ts's interval-based FIFO posting.
 * A campaign slot only participates here once it has a `targetDueAt`
 * (admin UI sets this when both a target date *and* time are picked --
 * date-only stays a pure label). Once due:
 *   - "queued" (media linked): publish that specific folder now, via the
 *     same helpers post.ts uses, then mark the slot posted.
 *   - "planned" (nothing linked): log + notify once via GitHub's own
 *     workflow-failure email (same mechanism as reminders.ts), then stay
 *     quiet on later runs so it doesn't repeat every hour forever.
 */
async function main() {
  const now = new Date();
  let anyDueNotification = false;

  for (const project of await loadProjects()) {
    const channels = await loadChannels(project.id);
    const campaigns = await loadCampaigns(project.id);
    let channelsDirty = false;
    let campaignsDirty = false;

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

        if (slot.status === 'planned') {
          if (!slot.scheduledNotifiedAt) {
            console.log(`::error::📅 SCHEDULED POST DUE: ${label} was due ${slot.targetDueAt} but has no media linked -- link one in Content Queue.`);
            slot.scheduledNotifiedAt = now.toISOString();
            campaignsDirty = true;
            anyDueNotification = true;
          }
          continue;
        }

        // status === "queued" -- media linked, publish it now regardless of the channel's own interval/FIFO position.
        if (!slot.linkedPostPath) {
          console.log(`::error::📅 SCHEDULED POST DUE: ${label} is "queued" but has no linkedPostPath (data inconsistency) -- skipping.`);
          continue;
        }

        const postDir = path.join(REPO_ROOT, slot.linkedPostPath);
        const media = await readPostMedia(postDir).catch(() => []); // folder may have been moved/deleted by hand since linking
        if (media.length === 0) {
          if (!slot.scheduledNotifiedAt) {
            console.log(
              `::error::📅 SCHEDULED POST DUE: ${label} is due but its linked post "${slot.linkedPostPath}" has no media (missing, moved, or empty) -- relink it in Content Queue.`,
            );
            slot.scheduledNotifiedAt = now.toISOString();
            campaignsDirty = true;
            anyDueNotification = true;
          }
          continue;
        }
        if (media.length > MAX_CAROUSEL_ITEMS) {
          console.log(`${label}: linked post has ${media.length} items, over the ${MAX_CAROUSEL_ITEMS}-item carousel cap -- trim it manually before it can post`);
          continue;
        }

        const caption = await resolveCaption(postDir, channel);
        const publisherId = channel.publisher ?? 'buffer';
        const publish = getPublisher(publisherId);
        const mediaType = media.length === 1 ? media[0].type : 'carousel';

        console.log(`${label}: publishing "${slot.linkedPostPath}" (${mediaType}, ${media.length} item(s)) via ${publisherId}`);
        await publish({ media, caption, channel });

        await movePosted(postDir, project.id, channel.id);
        channel.lastPostedAt = now.toISOString();
        channelsDirty = true;

        slot.status = 'posted';
        slot.postedAt = now.toISOString();
        campaignsDirty = true;
      }
    }

    if (channelsDirty) await saveChannels(project.id, channels);
    if (campaignsDirty) await saveCampaigns(project.id, campaigns);
  }

  console.log('scheduled-posts complete');

  const githubOutput = process.env['GITHUB_OUTPUT'];
  if (githubOutput && anyDueNotification) {
    appendFileSync(githubOutput, 'due=true\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
