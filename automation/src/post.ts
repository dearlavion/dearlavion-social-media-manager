import { readdir, mkdir, rename, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadChannels, saveChannels, isDue, publicRawUrl, INBOX_ROOT, POSTED_ROOT } from './config.js';
import type { ChannelConfig } from './config.js';
import { publishViaBuffer } from './buffer.js';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

async function nextImage(channelId: string): Promise<string | null> {
  const dir = path.join(INBOX_ROOT, channelId);
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

async function movePosted(imagePath: string, channelId: string): Promise<void> {
  const destDir = path.join(POSTED_ROOT, channelId);
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
  const channels = await loadChannels();
  const now = new Date();
  // Set by the admin UI's per-channel "Post now" button, to post one
  // specific channel on demand, ignoring its enabled flag and due-check.
  const forceChannelId = process.env['FORCE_CHANNEL_ID'];

  for (const channel of channels) {
    const forced = forceChannelId === channel.id;
    if (!channel.enabled && !forced) continue;
    if (!forced && !isDue(channel, now)) {
      console.log(`[${channel.id}] not due yet`);
      continue;
    }

    const imagePath = await nextImage(channel.id);
    if (!imagePath) {
      console.log(`[${channel.id}] due, but inbox is empty`);
      continue;
    }

    const caption = await resolveCaption(imagePath, channel);
    const publicImageUrl = publicRawUrl(imagePath);

    console.log(`[${channel.id}] posting ${imagePath} to ${channel.platform} via Buffer`);
    await publishViaBuffer({ publicImageUrl, caption, channel });

    await movePosted(imagePath, channel.id);
    channel.lastPostedAt = now.toISOString();
  }

  await saveChannels(channels);
  console.log('post complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
