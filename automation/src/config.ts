import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(__dirname, '../..');
export const PROJECTS_PATH = path.join(REPO_ROOT, 'config', 'projects.json');

export interface Project {
  id: string;
  name: string;
}

export function configPath(projectId: string): string {
  return path.join(REPO_ROOT, 'config', projectId, 'channels.json');
}

export function inboxRoot(projectId: string): string {
  return path.join(REPO_ROOT, 'inbox', projectId);
}

export function postedRoot(projectId: string): string {
  return path.join(REPO_ROOT, 'posted', projectId);
}

/** Informational only — the actual publish target is `bufferChannelId`, which already knows its own platform on Buffer's side. */
export type Platform = 'instagram' | 'tiktok' | 'facebook';

/** Only meaningful when platform is "instagram" -- Buffer requires this on every Instagram post. Defaults to "post". */
export type InstagramPostType = 'post' | 'story' | 'reel';

/**
 * Which backend actually publishes the post. Only "buffer" is implemented
 * today (see src/publishers/) -- adding a new one there and to this union
 * is what makes it selectable, no other changes needed. Defaults to
 * "buffer" when absent, so existing channels saved before this field
 * existed keep working unchanged.
 */
export type Publisher = 'buffer';

export interface ChannelConfig {
  id: string;
  platform: Platform;
  enabled: boolean;
  intervalHours: number;
  driveFolderId: string;
  bufferChannelId: string;
  captionTemplate: string;
  syncedDriveFileIds: string[];
  lastPostedAt: string | null;
  instagramPostType?: InstagramPostType;
  publisher?: Publisher;
}

function assertValidProject(value: unknown, index: number): asserts value is Project {
  const p = value as Partial<Project>;
  if (typeof p.id !== 'string' || !p.id) {
    throw new Error(`config/projects.json[${index}]: "id" must be a non-empty string`);
  }
  if (typeof p.name !== 'string' || !p.name) {
    throw new Error(`config/projects.json[${index}] (${p.id}): "name" must be a non-empty string`);
  }
}

export async function loadProjects(): Promise<Project[]> {
  const raw = await readFile(PROJECTS_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('config/projects.json must contain a JSON array');
  }
  parsed.forEach((p, i) => assertValidProject(p, i));
  return parsed as Project[];
}

function assertValidChannel(projectId: string, value: unknown, index: number): asserts value is ChannelConfig {
  const c = value as Partial<ChannelConfig>;
  const path = `config/${projectId}/channels.json[${index}]`;
  if (typeof c.id !== 'string' || !c.id) {
    throw new Error(`${path}: "id" must be a non-empty string`);
  }
  if (!['instagram', 'tiktok', 'facebook'].includes(c.platform as string)) {
    throw new Error(`${path} (${c.id}): invalid "platform" "${c.platform}"`);
  }
  if (typeof c.enabled !== 'boolean') {
    throw new Error(`${path} (${c.id}): "enabled" must be a boolean`);
  }
  if (typeof c.intervalHours !== 'number' || c.intervalHours < 1) {
    throw new Error(`${path} (${c.id}): "intervalHours" must be a number >= 1`);
  }
  if (typeof c.driveFolderId !== 'string' || !c.driveFolderId) {
    throw new Error(`${path} (${c.id}): "driveFolderId" must be a non-empty string`);
  }
  if (c.enabled && (typeof c.bufferChannelId !== 'string' || !c.bufferChannelId)) {
    throw new Error(`${path} (${c.id}): "bufferChannelId" must be a non-empty string when enabled`);
  }
  if (c.instagramPostType !== undefined && !['post', 'story', 'reel'].includes(c.instagramPostType)) {
    throw new Error(`${path} (${c.id}): invalid "instagramPostType" "${c.instagramPostType}"`);
  }
  if (c.publisher !== undefined && !['buffer'].includes(c.publisher)) {
    throw new Error(`${path} (${c.id}): invalid "publisher" "${c.publisher}"`);
  }
}

export async function loadChannels(projectId: string): Promise<ChannelConfig[]> {
  const raw = await readFile(configPath(projectId), 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`config/${projectId}/channels.json must contain a JSON array`);
  }
  parsed.forEach((c, i) => assertValidChannel(projectId, c, i));
  return parsed as ChannelConfig[];
}

export async function saveChannels(projectId: string, channels: ChannelConfig[]): Promise<void> {
  await writeFile(configPath(projectId), JSON.stringify(channels, null, 2) + '\n', 'utf-8');
}

export function isDue(channel: ChannelConfig, now: Date): boolean {
  if (!channel.lastPostedAt) return true;
  const elapsedHours = (now.getTime() - new Date(channel.lastPostedAt).getTime()) / (1000 * 60 * 60);
  return elapsedHours >= channel.intervalHours;
}

export const DRY_RUN = process.env['DRY_RUN'] === 'true';

/**
 * Builds the raw.githubusercontent.com URL for a file already committed to
 * this repo. Buffer's createPost only accepts a publicly-fetchable image
 * URL, not a binary upload, so this only works if the repo is public.
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
