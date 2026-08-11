import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(__dirname, '../..');
export const CONFIG_PATH = path.join(REPO_ROOT, 'config', 'channels.json');
export const INBOX_ROOT = path.join(REPO_ROOT, 'inbox');
export const POSTED_ROOT = path.join(REPO_ROOT, 'posted');

export type Platform = 'instagram' | 'tiktok' | 'pinterest' | 'facebook';

export interface ChannelConfig {
  id: string;
  platform: Platform;
  enabled: boolean;
  intervalHours: number;
  driveFolderId: string;
  captionTemplate: string;
  syncedDriveFileIds: string[];
  lastPostedAt: string | null;
}

function assertValidChannel(value: unknown, index: number): asserts value is ChannelConfig {
  const c = value as Partial<ChannelConfig>;
  if (typeof c.id !== 'string' || !c.id) {
    throw new Error(`config/channels.json[${index}]: "id" must be a non-empty string`);
  }
  if (!['instagram', 'tiktok', 'pinterest', 'facebook'].includes(c.platform as string)) {
    throw new Error(`config/channels.json[${index}] (${c.id}): invalid "platform" "${c.platform}"`);
  }
  if (typeof c.enabled !== 'boolean') {
    throw new Error(`config/channels.json[${index}] (${c.id}): "enabled" must be a boolean`);
  }
  if (typeof c.intervalHours !== 'number' || c.intervalHours < 1) {
    throw new Error(`config/channels.json[${index}] (${c.id}): "intervalHours" must be a number >= 1`);
  }
  if (typeof c.driveFolderId !== 'string' || !c.driveFolderId) {
    throw new Error(`config/channels.json[${index}] (${c.id}): "driveFolderId" must be a non-empty string`);
  }
}

export async function loadChannels(): Promise<ChannelConfig[]> {
  const raw = await readFile(CONFIG_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('config/channels.json must contain a JSON array');
  }
  parsed.forEach((c, i) => assertValidChannel(c, i));
  return parsed as ChannelConfig[];
}

export async function saveChannels(channels: ChannelConfig[]): Promise<void> {
  await writeFile(CONFIG_PATH, JSON.stringify(channels, null, 2) + '\n', 'utf-8');
}

export function isDue(channel: ChannelConfig, now: Date): boolean {
  if (!channel.lastPostedAt) return true;
  const elapsedHours = (now.getTime() - new Date(channel.lastPostedAt).getTime()) / (1000 * 60 * 60);
  return elapsedHours >= channel.intervalHours;
}

export const DRY_RUN = process.env['DRY_RUN'] === 'true';

/**
 * Builds the raw.githubusercontent.com URL for a file already committed to
 * this repo. Instagram/Pinterest need a publicly-fetchable image_url rather
 * than accepting a binary upload, so this only works if the repo is public.
 */
export function publicRawUrl(absPath: string): string {
  const repo = process.env['GITHUB_REPOSITORY']; // e.g. "dearlavion/dearlavion-social-media-manager", set by GH Actions
  const ref = process.env['GITHUB_REF_NAME'] ?? 'main';
  if (!repo) {
    throw new Error('GITHUB_REPOSITORY env var is not set (expected to run inside GitHub Actions)');
  }
  const relPath = path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
  return `https://raw.githubusercontent.com/${repo}/${ref}/${relPath}`;
}

export interface PublishParams {
  imagePath: string;
  publicImageUrl: string;
  caption: string;
  channel: ChannelConfig;
}

export type PublishFn = (params: PublishParams) => Promise<void>;
