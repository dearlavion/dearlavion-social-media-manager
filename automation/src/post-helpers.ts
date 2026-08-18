import { readdir, mkdir, rename, readFile } from 'node:fs/promises';
import path from 'node:path';
import { publicRawUrl, postedRoot } from './config.js';
import type { Campaign, CampaignSlot } from './config.js';
import type { PostMedia } from './publishers/types.js';

/** The slot (if any) across every campaign whose linkedPostPath matches -- e.g. to check whether a folder is reserved for a scheduled post. */
export function findSlotByLinkedPath(campaigns: Campaign[], linkedPostPath: string): CampaignSlot | undefined {
  for (const campaign of campaigns) {
    const slot = campaign.slots.find((s) => s.linkedPostPath === linkedPostPath);
    if (slot) return slot;
  }
  return undefined;
}

export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
export const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm']);
export const CAPTION_FILENAME = 'caption.txt';
/** Instagram's hard cap on carousel items -- other platforms are more lenient, this is the binding one. */
export const MAX_CAROUSEL_ITEMS = 10;

/**
 * Shared by post.ts (oldest-file-first) and scheduled-posts.ts (a specific
 * linked post folder) so both publish a post folder identically -- reading
 * its media, resolving its caption, and moving it to posted/ once done.
 */
export async function readPostMedia(postDir: string): Promise<PostMedia[]> {
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

export async function resolveCaption(postDir: string): Promise<string> {
  try {
    const custom = await readFile(path.join(postDir, CAPTION_FILENAME), 'utf-8');
    return custom.trim();
  } catch {
    return '';
  }
}

export async function movePosted(postDir: string, projectId: string, channelId: string): Promise<void> {
  const destParent = path.join(postedRoot(projectId), channelId);
  await mkdir(destParent, { recursive: true });
  await rename(postDir, path.join(destParent, path.basename(postDir)));
}
