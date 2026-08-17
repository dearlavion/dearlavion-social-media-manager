import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChannelConfig, Project } from './channel.model';
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

  loading = false;
  loaded = false;
  saving = false;
  errorMessage = '';
  private queuesByChannel = new Map<string, QueuedPost[]>();

  // Only ongoing campaigns -- Content Queue plans posts against what's actively running.
  private campaigns: Campaign[] = [];
  private campaignsSha: string | null = null;

  // Adding a new planned post, one channel at a time.
  addingPlannedForChannel: string | null = null;
  newPlannedCampaignId = '';
  newPlannedStage = '';
  newPlannedGuidance = '';
  newPlannedTargetDate = '';
  newPlannedTargetTime = '';
  newPlannedExpectedFileName = '';

  // Editing an existing planned post inline.
  editingPlannedSlotId: string | null = null;
  editingPlannedStage = '';
  editingPlannedGuidance = '';
  editingPlannedTargetDate = '';
  editingPlannedTargetTime = '';
  editingPlannedExpectedFileName = '';

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
    return openSlotsForChannel(this.campaigns, post.channelId);
  }

  get hasOngoingCampaigns(): boolean {
    return this.campaigns.length > 0;
  }

  get ongoingCampaigns(): Campaign[] {
    return this.campaigns;
  }

  plannedFor(channelId: string): LinkedSlot[] {
    return openSlotsForChannel(this.campaigns, channelId);
  }

  /** Synced posts for a channel not already claimed by any slot -- candidates for a Planned row's "Link media" action. */
  unlinkedSyncedFor(channelId: string): QueuedPost[] {
    return this.queueFor(channelId).filter((post) => !this.linkedSlotFor(post));
  }

  dateOptionsForCampaign(campaignId: string): string[] {
    const campaign = this.campaigns.find((c) => c.id === campaignId);
    return campaign ? campaignDateOptions(campaign) : [];
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
    this.newPlannedCampaignId = this.campaigns[0]?.id ?? '';
    this.newPlannedStage = '';
    this.newPlannedGuidance = '';
    this.newPlannedTargetDate = '';
    this.newPlannedTargetTime = '';
    this.newPlannedExpectedFileName = '';
  }

  cancelAddPlanned(): void {
    this.addingPlannedForChannel = null;
  }

  pickPlannedStage(stage: string, guidance: string): void {
    this.newPlannedStage = stage;
    this.newPlannedGuidance = guidance;
  }

  async addPlanned(channelId: string): Promise<void> {
    const stage = this.newPlannedStage.trim();
    const campaign = this.campaigns.find((c) => c.id === this.newPlannedCampaignId);
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
    campaign.slots = [...campaign.slots, slot];
    this.addingPlannedForChannel = null;
    await this.saveCampaigns();
  }

  // --- planned posts: edit / remove / prep status ---

  startEditPlanned(slot: CampaignSlot): void {
    this.editingPlannedSlotId = slot.id;
    this.editingPlannedStage = slot.stage;
    this.editingPlannedGuidance = slot.guidance;
    this.editingPlannedTargetDate = slot.targetDate ?? '';
    this.editingPlannedTargetTime = slot.targetTime ?? '';
    this.editingPlannedExpectedFileName = slot.expectedFileName ?? '';
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
