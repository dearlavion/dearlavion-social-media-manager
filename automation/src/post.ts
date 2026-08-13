import { readdir, mkdir, rename, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadProjects, loadChannels, saveChannels, isDue, publicRawUrl, inboxRoot, postedRoot } from './config.js';
import type { ChannelConfig } from './config.js';
import { getPublisher } from './publishers/index.js';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

async function nextImage(projectId: string, channelId: string): Promise<string | null> {
  const dir = path.join(inboxRoot(projectId), channelId);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const images = entries.filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase())).sort();
  return images.length > 0 ? path.join(dir, images[0]) : null;
}

async function resolveCaption(imagePath: string, channel: ChannelConfig): Promise<string> {
  const sidecar = `${imagePath}.caption.txt`;
  try {
    const custom = await readFile(sidecar, 'utf-8');
    return custom.trim();
  } catch {
    return channel.captionTemplate;
  }
}

async function movePosted(imagePath: string, projectId: string, channelId: string): Promise<void> {
  const destDir = path.join(postedRoot(projectId), channelId);
  await mkdir(destDir, { recursive: true });
  await rename(imagePath, path.join(destDir, path.basename(imagePath)));

  const sidecar = `${imagePath}.caption.txt`;
  try {
    await rename(sidecar, path.join(destDir, `${path.basename(imagePath)}.caption.txt`));
  } catch {
    // no sidecar caption file for this image, nothing to move
  }
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

    for (const channel of channels) {
      const forced = forceChannelId === channel.id;
      if (!channel.enabled && !forced) continue;
      if (!forced && !isDue(channel, now)) {
        console.log(`[${project.id}/${channel.id}] not due yet`);
        continue;
      }

      const imagePath = await nextImage(project.id, channel.id);
      if (!imagePath) {
        console.log(`[${project.id}/${channel.id}] due, but inbox is empty`);
        continue;
      }

      const caption = await resolveCaption(imagePath, channel);
      const publicImageUrl = publicRawUrl(imagePath);
      const publisherId = channel.publisher ?? 'buffer';
      const publish = getPublisher(publisherId);

      console.log(`[${project.id}/${channel.id}] posting ${imagePath} to ${channel.platform} via ${publisherId}`);
      await publish({ publicImageUrl, caption, channel });

      await movePosted(imagePath, project.id, channel.id);
      channel.lastPostedAt = now.toISOString();
    }

    await saveChannels(project.id, channels);
  }

  console.log('post complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
