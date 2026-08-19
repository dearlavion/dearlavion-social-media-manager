import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChannelConfig, INSTAGRAM_POST_TYPES, InstagramPostType, Project } from './channel.model';
import { GithubConnection, GithubService } from './github.service';
import { InboxPost, parseInboxTree } from './inbox-tree.util';
import {
  Campaign,
  CampaignSlot,
  DEFAULT_STAGES,
  LinkedSlot,
  campaignDateOptions,
  computeTargetDueAt,
  findLinkedSlot,
  newSlot,
  openSlotsForChannel,
} from './campaign.model';

interface QueuedPost extends InboxPost {
  /** 0-indexed position in this channel's FIFO queue -- 0 posts on the channel's next post.yml run. */
  queuePosition: number;
}

@Component({
  selector: 'app-queue',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './queue.component.html',
  styleUrl: './queue.component.css',
})
export class QueueComponent {
  @Input({ required: true }) connection!: GithubConnection;
  @Input() project: Project | null = null;
  @Input() channels: ChannelConfig[] = [];
  @Input() channelsLoaded = false;

  readonly defaultStages = DEFAULT_STAGES;
  readonly instagramPostTypes = INSTAGRAM_POST_TYPES;

  loading = false;
  loaded = false;
  saving = false;
  errorMessage = '';
  private queuesByChannel = new Map<string, QueuedPost[]>();

  // Only ongoing campaigns -- Content Queue plans posts against what's actively running.
  private campaigns: Campaign[] = [];
  private campaignsSha: string | null = null;

  // Optional campaign filter -- null shows every channel (the old behavior); picking one narrows the channel
  // sections below to just that campaign's enabled channels, so planning a specific campaign doesn't mean
  // scrolling past every other channel in the project.
  selectedCampaignId: string | null = null;

  // Adding a new planned post, one channel at a time.
  addingPlannedForChannel: string | null = null;
  newPlannedStage = '';
  newPlannedGuidance = '';
  newPlannedTargetDate = '';
  newPlannedTargetTime = '';
  newPlannedExpectedFileName = '';
  newPlannedInstagramPostType: InstagramPostType = 'post';

  // Editing an existing planned post inline.
  editingPlannedSlotId: string | null = null;
  editingPlannedStage = '';
  editingPlannedGuidance = '';
  editingPlannedTargetDate = '';
  editingPlannedTargetTime = '';
  editingPlannedExpectedFileName = '';
  editingPlannedInstagramPostType: InstagramPostType = 'post';

  constructor(private readonly github: GithubService) {}

  queueFor(channelId: string): QueuedPost[] {
    return this.queuesByChannel.get(channelId) ?? [];
  }

  rawUrl(path: string): string {
    return `https://raw.githubusercontent.com/${this.connection.owner}/${this.connection.repo}/${this.connection.branch}/${path}`;
  }

  linkedSlotFor(post: QueuedPost): LinkedSlot | undefined {
    return findLinkedSlot(this.campaigns, post.path);
  }

  openSlotsFor(post: QueuedPost): LinkedSlot[] {
    return openSlotsForChannel(this.campaignsInScope, post.channelId);
  }

  get hasOngoingCampaigns(): boolean {
    return this.campaigns.length > 0;
  }

  get ongoingCampaigns(): Campaign[] {
    return this.campaigns;
  }

  get selectedCampaign(): Campaign | undefined {
    return this.selectedCampaignId ? this.campaigns.find((c) => c.id === this.selectedCampaignId) : undefined;
  }

  /** The selected campaign alone, or [] before one's picked -- what "in scope" for planning/linking narrows to. */
  private get campaignsInScope(): Campaign[] {
    const campaign = this.selectedCampaign;
    return campaign ? [campaign] : [];
  }

  /** Channel sections to actually show -- nothing until a campaign is picked, then just that campaign's enabled channels. */
  get displayChannels(): ChannelConfig[] {
    const campaign = this.selectedCampaign;
    if (!campaign) return [];
    const memberIds = new Set(campaign.channelIds ?? []);
    return this.channels.filter((c) => memberIds.has(c.id) && c.enabled);
  }

  plannedFor(channelId: string): LinkedSlot[] {
    return openSlotsForChannel(this.campaignsInScope, channelId);
  }

  /** Synced posts for a channel not already claimed by any slot -- candidates for a Planned row's "Link media" action. */
  unlinkedSyncedFor(channelId: string): QueuedPost[] {
    return this.queueFor(channelId).filter((post) => !this.linkedSlotFor(post));
  }

  dateOptionsForCampaign(campaignId: string): string[] {
    const campaign = this.campaigns.find((c) => c.id === campaignId);
    return campaign ? campaignDateOptions(campaign) : [];
  }

  /** Instagram post type only makes sense for an Instagram channel -- Buffer ignores it (and rejects the field) for other platforms. */
  isInstagramChannel(channelId: string): boolean {
    return this.channels.find((c) => c.id === channelId)?.platform === 'instagram';
  }

  async load(): Promise<void> {
    if (!this.project) return;
    this.errorMessage = '';
    this.loading = true;
    try {
      const [tree, { campaigns, sha }] = await Promise.all([
        this.github.loadTree(this.connection),
        this.github.loadCampaigns(this.connection, this.project.id),
      ]);
      this.queuesByChannel = this.buildQueues(parseInboxTree(tree, this.project.id));
      this.campaigns = campaigns.filter((c) => c.status === 'ongoing');
      this.campaignsSha = sha;
      this.selectedCampaignId = null;
      this.loaded = true;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  private async saveCampaigns(): Promise<void> {
    if (!this.project) return;
    this.errorMessage = '';
    this.saving = true;
    try {
      this.campaignsSha = await this.github.saveCampaigns(this.connection, this.project.id, this.campaigns, this.campaignsSha);
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.saving = false;
    }
  }

  async linkToCampaign(target: LinkedSlot, post: QueuedPost): Promise<void> {
    target.slot.linkedPostPath = post.path;
    target.slot.status = 'queued';
    await this.saveCampaigns();
  }

  // --- planned posts: add ---

  startAddPlanned(channelId: string): void {
    this.addingPlannedForChannel = channelId;
    this.selectPlannedStage(this.defaultStages[0].stage);
    this.newPlannedTargetDate = '';
    this.newPlannedTargetTime = '';
    this.newPlannedExpectedFileName = '';
    this.newPlannedInstagramPostType = 'post';
  }

  cancelAddPlanned(): void {
    this.addingPlannedForChannel = null;
  }

  /** Stage is a closed set (awareness/consideration/conversion/loyalty) -- picking one also fills its default guidance, same as the old quick-pick chips did. */
  selectPlannedStage(stage: string): void {
    this.newPlannedStage = stage;
    this.newPlannedGuidance = this.defaultStages.find((s) => s.stage === stage)?.guidance ?? '';
  }

  async addPlanned(channelId: string): Promise<void> {
    const stage = this.newPlannedStage.trim();
    const campaign = this.selectedCampaign;
    if (!stage || !campaign) return;
    const slot = newSlot(stage, this.newPlannedGuidance.trim(), channelId);
    if (this.newPlannedTargetDate) {
      slot.targetDate = this.newPlannedTargetDate;
      if (this.newPlannedTargetTime) {
        slot.targetTime = this.newPlannedTargetTime;
        slot.targetDueAt = computeTargetDueAt(this.newPlannedTargetDate, this.newPlannedTargetTime);
      }
    }
    if (this.newPlannedExpectedFileName.trim()) {
      slot.expectedFileName = this.newPlannedExpectedFileName.trim();
    }
    if (this.isInstagramChannel(channelId)) {
      slot.instagramPostType = this.newPlannedInstagramPostType;
    }
    campaign.slots = [...campaign.slots, slot];
    this.addingPlannedForChannel = null;
    await this.saveCampaigns();
  }

  // --- planned posts: edit / remove / prep status ---

  /** True for the four standard stages -- false for a custom one typed before this became a closed dropdown, so the edit form can still show it as an option. */
  isKnownStage(stage: string): boolean {
    return this.defaultStages.some((s) => s.stage === stage);
  }

  startEditPlanned(slot: CampaignSlot): void {
    this.editingPlannedSlotId = slot.id;
    this.editingPlannedStage = slot.stage;
    this.editingPlannedGuidance = slot.guidance;
    this.editingPlannedTargetDate = slot.targetDate ?? '';
    this.editingPlannedTargetTime = slot.targetTime ?? '';
    this.editingPlannedExpectedFileName = slot.expectedFileName ?? '';
    this.editingPlannedInstagramPostType = slot.instagramPostType ?? 'post';
  }

  cancelEditPlanned(): void {
    this.editingPlannedSlotId = null;
  }

  async saveEditPlanned(slot: CampaignSlot): Promise<void> {
    const stage = this.editingPlannedStage.trim();
    if (!stage) return;
    slot.stage = stage;
    slot.guidance = this.editingPlannedGuidance.trim();
    slot.targetDate = this.editingPlannedTargetDate || undefined;
    slot.targetTime = this.editingPlannedTargetDate && this.editingPlannedTargetTime ? this.editingPlannedTargetTime : undefined;
    const newTargetDueAt =
      slot.targetDate && slot.targetTime ? computeTargetDueAt(slot.targetDate, slot.targetTime) : undefined;
    if (newTargetDueAt !== slot.targetDueAt) {
      // The due time actually changed -- any past "due, no media" notification was about the old time, not this one.
      slot.scheduledNotifiedAt = undefined;
    }
    slot.targetDueAt = newTargetDueAt;
    slot.expectedFileName = this.editingPlannedExpectedFileName.trim() || undefined;
    slot.instagramPostType = this.isInstagramChannel(slot.channelId) ? this.editingPlannedInstagramPostType : undefined;
    this.editingPlannedSlotId = null;
    await this.saveCampaigns();
  }

  async removePlanned(campaign: Campaign, slot: CampaignSlot): Promise<void> {
    campaign.slots = campaign.slots.filter((s) => s.id !== slot.id);
    await this.saveCampaigns();
  }

  async togglePrepStatus(slot: CampaignSlot): Promise<void> {
    slot.prepStatus = slot.prepStatus === 'done' ? 'todo' : 'done';
    await this.saveCampaigns();
  }

  private buildQueues(posts: InboxPost[]): Map<string, QueuedPost[]> {
    const byChannel = new Map<string, InboxPost[]>();
    for (const post of posts) {
      if (!byChannel.has(post.channelId)) byChannel.set(post.channelId, []);
      byChannel.get(post.channelId)!.push(post);
    }

    const result = new Map<string, QueuedPost[]>();
    for (const [channelId, channelPosts] of byChannel) {
      result.set(
        channelId,
        channelPosts.map((post, queuePosition) => ({ ...post, queuePosition })),
      );
    }
    return result;
  }
}
