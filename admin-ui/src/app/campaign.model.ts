export type CampaignSlotStatus = 'planned' | 'queued' | 'posted';

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
  };
}

export function newSlot(stage: string, guidance: string, channelId: string): CampaignSlot {
  return {
    id: crypto.randomUUID(),
    stage,
    guidance,
    channelId,
    status: 'planned',
  };
}

/** The first slot not yet posted, in order -- "what to do next" for a campaign. */
export function nextOpenSlot(campaign: Campaign): CampaignSlot | undefined {
  return campaign.slots.find((s) => s.status !== 'posted');
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
  const channelIds = new Set<string>([...campaign.slots.map((s) => s.channelId), ...targetByChannel.keys()]);

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
