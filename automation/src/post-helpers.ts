import { readdir, mkdir, rename, readFile, rm, writeFile } from 'node:fs/promises';
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
export const DRIVE_SOURCE_ID_FILENAME = '.drive-source-id';
/** Instagram's hard cap on carousel items -- other platforms are more lenient, this is the binding one. */
export const MAX_CAROUSEL_ITEMS = 10;

/**
 * Shared by post.ts (oldest-file-first) and scheduled-posts.ts (a specific
 * linked post folder) so both publish a post folder identically -- reading
 * its media, resolving its caption, and moving it to posted/ once done.
 */
export async function readPostMedia(postDir: string): Promise<PostMedia[]> {
  const files = (await readdir(postDir))
    .filter((f) => f !== CAPTION_FILENAME && f !== DRIVE_SOURCE_ID_FILENAME)
    .sort();
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

/** A campaign slot's own caption wins when set -- caption.txt stays the fallback for anything not linked to a slot, or a slot with no caption set. */
export async function resolveCaption(postDir: string, slotCaption?: string): Promise<string> {
  if (slotCaption && slotCaption.trim()) {
    return slotCaption.trim();
  }
  try {
    const custom = await readFile(path.join(postDir, CAPTION_FILENAME), 'utf-8');
    return custom.trim();
  } catch {
    return '';
  }
}

/** Records which Drive file/folder a synced post folder came from, so a later successful publish can relocate it in Drive too. */
export async function writeDriveSourceId(postDir: string, driveId: string): Promise<void> {
  await writeFile(path.join(postDir, DRIVE_SOURCE_ID_FILENAME), driveId, 'utf-8');
}

/** Null for posts synced before this existed, or media added to the repo by hand -- both fine to just skip the Drive-side move for. */
export async function readDriveSourceId(postDir: string): Promise<string | null> {
  try {
    const id = await readFile(path.join(postDir, DRIVE_SOURCE_ID_FILENAME), 'utf-8');
    return id.trim() || null;
  } catch {
    return null;
  }
}

export async function movePosted(postDir: string, projectId: string, channelId: string): Promise<void> {
  const destParent = path.join(postedRoot(projectId), channelId);
  await mkdir(destParent, { recursive: true });
  const dest = path.join(destParent, path.basename(postDir));
  // postFolderName is derived from the source Drive file's own metadata, so reusing the same physical file for a
  // later, different post produces the identical folder name -- rename() can't land on a non-empty destination
  // that's still around from the earlier archive, so clear it first. The newer post's copy is authoritative;
  // content is identical anyway since it's the same source file.
  await rm(dest, { recursive: true, force: true });
  await rename(postDir, dest);
}
