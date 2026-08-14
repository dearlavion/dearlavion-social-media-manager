export type CampaignSlotStatus = 'planned' | 'queued' | 'posted';

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

export interface Campaign {
  id: string;
  name: string;
  goal: string;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  slots: CampaignSlot[];
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
    startDate: null,
    endDate: null,
    createdAt: new Date().toISOString(),
    slots: [],
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
