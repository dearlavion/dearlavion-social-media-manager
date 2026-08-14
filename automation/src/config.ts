import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(__dirname, '../..');
export const PROJECTS_PATH = path.join(REPO_ROOT, 'config', 'projects.json');
export const REMINDERS_PATH = path.join(REPO_ROOT, 'config', 'reminders.json');

export interface Project {
  id: string;
  name: string;
}

/**
 * A personal reminder, not tied to any project. `date`/`time` are the
 * user's local calendar day/time (for display and calendar grouping);
 * `dueAt` is the UTC instant computed from those at creation time, which
 * is what automation actually compares "now" against.
 */
export interface Reminder {
  id: string;
  date: string;
  time: string;
  dueAt: string;
  message: string;
  notifiedAt: string | null;
}

export function configPath(projectId: string): string {
  return path.join(REPO_ROOT, 'config', projectId, 'channels.json');
}

export function campaignsPath(projectId: string): string {
  return path.join(REPO_ROOT, 'config', projectId, 'campaigns.json');
}

/**
 * One planned post within a Campaign's ordered sequence. `linkedPostPath`
 * is a repo-relative path (e.g. "inbox/travel-besty/ig-main/<postId>") set
 * by the admin UI when a queued post is assigned to fulfil this slot --
 * post.ts watches for a match on that path to flip status to "posted".
 */
export interface CampaignSlot {
  id: string;
  stage: string;
  guidance: string;
  channelId: string;
  status: 'planned' | 'queued' | 'posted';
  linkedPostPath?: string;
  postedAt?: string;
}

export interface Campaign {
  id: string;
  name: string;
  goal: string;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  slots: CampaignSlot[];
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

function assertValidReminder(value: unknown, index: number): asserts value is Reminder {
  const r = value as Partial<Reminder>;
  const path = `config/reminders.json[${index}]`;
  if (typeof r.id !== 'string' || !r.id) {
    throw new Error(`${path}: "id" must be a non-empty string`);
  }
  if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
    throw new Error(`${path} (${r.id}): "date" must be a YYYY-MM-DD string`);
  }
  if (typeof r.dueAt !== 'string' || Number.isNaN(new Date(r.dueAt).getTime())) {
    throw new Error(`${path} (${r.id}): "dueAt" must be a valid ISO datetime string`);
  }
  if (typeof r.message !== 'string' || !r.message) {
    throw new Error(`${path} (${r.id}): "message" must be a non-empty string`);
  }
}

export async function loadReminders(): Promise<Reminder[]> {
  let raw: string;
  try {
    raw = await readFile(REMINDERS_PATH, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('config/reminders.json must contain a JSON array');
  }
  parsed.forEach((r, i) => assertValidReminder(r, i));
  return parsed as Reminder[];
}

export async function saveReminders(reminders: Reminder[]): Promise<void> {
  await writeFile(REMINDERS_PATH, JSON.stringify(reminders, null, 2) + '\n', 'utf-8');
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

function assertValidCampaign(projectId: string, value: unknown, index: number): asserts value is Campaign {
  const c = value as Partial<Campaign>;
  const path = `config/${projectId}/campaigns.json[${index}]`;
  if (typeof c.id !== 'string' || !c.id) {
    throw new Error(`${path}: "id" must be a non-empty string`);
  }
  if (typeof c.name !== 'string' || !c.name) {
    throw new Error(`${path} (${c.id}): "name" must be a non-empty string`);
  }
  if (!Array.isArray(c.slots)) {
    throw new Error(`${path} (${c.id}): "slots" must be an array`);
  }
  c.slots.forEach((s, i) => {
    if (typeof s.id !== 'string' || !s.id) {
      throw new Error(`${path} (${c.id}).slots[${i}]: "id" must be a non-empty string`);
    }
    if (!['planned', 'queued', 'posted'].includes(s.status)) {
      throw new Error(`${path} (${c.id}).slots[${i}] (${s.id}): invalid "status" "${s.status}"`);
    }
  });
}

/** Most projects won't have a campaigns.json at all -- absent file means no campaigns, not an error. */
export async function loadCampaigns(projectId: string): Promise<Campaign[]> {
  let raw: string;
  try {
    raw = await readFile(campaignsPath(projectId), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`config/${projectId}/campaigns.json must contain a JSON array`);
  }
  parsed.forEach((c, i) => assertValidCampaign(projectId, c, i));
  return parsed as Campaign[];
}

export async function saveCampaigns(projectId: string, campaigns: Campaign[]): Promise<void> {
  await writeFile(campaignsPath(projectId), JSON.stringify(campaigns, null, 2) + '\n', 'utf-8');
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
/** Repo-relative, forward-slash path -- the same shape used for a Campaign slot's `linkedPostPath`. */
export function repoRelativePath(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
}

export function publicRawUrl(absPath: string): string {
  const repo = process.env['GITHUB_REPOSITORY']; // e.g. "dearlavion/dearlavion-social-media-manager", set by GH Actions
  const ref = process.env['GITHUB_REF_NAME'] ?? 'main';
  if (!repo) {
    throw new Error('GITHUB_REPOSITORY env var is not set (expected to run inside GitHub Actions)');
  }
  return `https://raw.githubusercontent.com/${repo}/${ref}/${repoRelativePath(absPath)}`;
}
