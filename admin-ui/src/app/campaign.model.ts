import type { InstagramPostType } from './channel.model';

export type CampaignSlotStatus = 'planned' | 'queued' | 'posted';

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The UTC instant for a local date+time pair -- same computation as Reminder.dueAt (reminder.model.ts). */
export function computeTargetDueAt(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

/** Whether the content for a planned slot has actually been created yet -- independent of publish lifecycle. */
export type PrepStatus = 'todo' | 'done';

/** The campaign's own lifecycle stage -- set by hand, independent of slot progress. */
export type CampaignStatus = 'open' | 'ongoing' | 'done';

export const CAMPAIGN_STATUSES: CampaignStatus[] = ['open', 'ongoing', 'done'];

/**
 * One planned post within a Campaign's ordered sequence. `linkedPostPath`
 * is a repo-relative path (e.g. "inbox/travel-besty/ig-main/<postId>") set
 * when a currently-queued post is assigned to fulfil this slot --
 * automation's post.ts watches for a match on that path and flips the
 * status to "posted" once it actually publishes.
 */
export interface CampaignSlot {
  id: string;
  stage: string;
  guidance: string;
  channelId: string;
  status: CampaignSlotStatus;
  /** Content-creation checklist state -- "have I actually made this yet", separate from `status`. Defaults to "todo". */
  prepStatus?: PrepStatus;
  /** YYYY-MM-DD -- date-only is just a label; see targetDueAt for when it becomes actionable. */
  targetDate?: string;
  /** HH:MM, set alongside targetDate. */
  targetTime?: string;
  /** ISO instant computed from targetDate+targetTime once both are set -- only then does scheduled-posts.ts act on this slot. */
  targetDueAt?: string;
  /** Set by scheduled-posts.ts once it's notified about this slot being due with no media linked, so it doesn't repeat every run. */
  scheduledNotifiedAt?: string;
  /** Exact Drive filename this slot is waiting for -- only acted on by scheduled-posts.ts, and only alongside targetDueAt. */
  expectedFileName?: string;
  /** Only meaningful when the slot's channel is Instagram -- Buffer requires this on every Instagram post. Defaults to "post" at publish time when unset. */
  instagramPostType?: InstagramPostType;
  /** Takes priority over a post folder's caption.txt file at publish time when set -- see automation's resolveCaption(). */
  caption?: string;
  linkedPostPath?: string;
  postedAt?: string;
}

/** How many posts you're aiming for on one channel over the life of a campaign -- tracked against actual `posted` slots. */
export interface ChannelTarget {
  channelId: string;
  targetCount: number;
}

export interface Campaign {
  id: string;
  name: string;
  goal: string;
  status: CampaignStatus;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  slots: CampaignSlot[];
  channelTargets: ChannelTarget[];
  /** Which channels this campaign involves -- independent of slots/goals, so a channel can be added before it has either. */
  channelIds: string[];
}

/** Quick-pick stages offered by the builder, with generic (project-agnostic) default guidance text. */
export const DEFAULT_STAGES: { stage: string; guidance: string }[] = [
  {
    stage: 'awareness',
    guidance: 'Reach people who don’t know you yet -- lead with a relatable pain point or hook, no pitch yet.',
  },
  {
    stage: 'consideration',
    guidance: 'Show the product/solution in action -- demos, testimonials, real examples of it working.',
  },
  {
    stage: 'conversion',
    guidance: 'Make the ask, frictionless -- one clear CTA, highlight the offer, remove hesitation.',
  },
  {
    stage: 'loyalty',
    guidance: 'Encourage repeat engagement -- user content, shoutouts, follow-ups with existing customers.',
  },
];

export function newCampaign(name: string, goal: string): Campaign {
  return {
    id: crypto.randomUUID(),
    name,
    goal,
    status: 'open',
    startDate: null,
    endDate: null,
    createdAt: new Date().toISOString(),
    slots: [],
    channelTargets: [],
    channelIds: [],
  };
}

export function newSlot(stage: string, guidance: string, channelId: string): CampaignSlot {
  return {
    id: crypto.randomUUID(),
    stage,
    guidance,
    channelId,
    status: 'planned',
    prepStatus: 'todo',
  };
}

/** The first slot not yet posted, in order -- "what to do next" for a campaign. */
export function nextOpenSlot(campaign: Campaign): CampaignSlot | undefined {
  return campaign.slots.find((s) => s.status !== 'posted');
}

const MAX_DATE_OPTIONS = 90;

/**
 * Every day from a campaign's startDate to endDate inclusive, for a "target
 * date to post" dropdown -- falls back to the next 30 days from today when
 * the campaign has no dates set. Capped at 90 options for sanity.
 */
export function campaignDateOptions(campaign: Campaign): string[] {
  let start: Date;
  let end: Date;
  if (campaign.startDate && campaign.endDate) {
    start = new Date(`${campaign.startDate}T00:00:00`);
    end = new Date(`${campaign.endDate}T00:00:00`);
  } else {
    start = new Date();
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setDate(end.getDate() + 30);
  }

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime() && dates.length < MAX_DATE_OPTIONS) {
    dates.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export interface ChannelProgress {
  channelId: string;
  /** 0 means no goal has been set for this channel yet. */
  target: number;
  posted: number;
  planned: number;
}

/**
 * Per-channel target vs. how many of that channel's slots are actually
 * posted so far -- one row per channel the campaign actually touches
 * (from its slots), even if no goal has been set for it yet, so the
 * detail view has somewhere to offer "set a goal" for every channel.
 * `channelTargets` defaults to [] since campaigns created before this
 * field existed won't have it on GitHub.
 */
export function channelProgress(campaign: Campaign): ChannelProgress[] {
  const targets = campaign.channelTargets ?? [];
  const targetByChannel = new Map(targets.map((t) => [t.channelId, t.targetCount]));
  const channelIds = new Set<string>([
    ...(campaign.channelIds ?? []),
    ...campaign.slots.map((s) => s.channelId),
    ...targetByChannel.keys(),
  ]);

  return [...channelIds].sort().map((channelId) => {
    const channelSlots = campaign.slots.filter((s) => s.channelId === channelId);
    return {
      channelId,
      target: targetByChannel.get(channelId) ?? 0,
      posted: channelSlots.filter((s) => s.status === 'posted').length,
      planned: channelSlots.length,
    };
  });
}

export interface LinkedSlot {
  campaign: Campaign;
  slot: CampaignSlot;
}

/** Which campaign/slot (if any) a given inbox post path is already linked to -- the Content Queue side of the link. */
export function findLinkedSlot(campaigns: Campaign[], postPath: string): LinkedSlot | undefined {
  for (const campaign of campaigns) {
    const slot = campaign.slots.find((s) => s.linkedPostPath === postPath);
    if (slot) return { campaign, slot };
  }
  return undefined;
}

/** Slots not yet linked to anything, for a given channel, across every campaign -- candidates to link a queued post to. */
export function openSlotsForChannel(campaigns: Campaign[], channelId: string): LinkedSlot[] {
  const result: LinkedSlot[] = [];
  for (const campaign of campaigns) {
    for (const slot of campaign.slots) {
      if (slot.channelId === channelId && slot.status === 'planned') {
        result.push({ campaign, slot });
      }
    }
  }
  return result;
}
