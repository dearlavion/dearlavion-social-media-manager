import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChannelConfig, Project } from './channel.model';
import { GithubConnection, GithubService } from './github.service';
import {
  Campaign,
  CampaignSlot,
  ChannelProgress,
  DEFAULT_STAGES,
  channelProgress,
  newCampaign,
  newSlot,
  nextOpenSlot,
} from './campaign.model';
import { InboxPost, parseInboxTree } from './inbox-tree.util';

type Mode = 'list' | 'builder' | 'detail';

@Component({
  selector: 'app-campaign',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './campaign.component.html',
  styleUrl: './campaign.component.css',
})
export class CampaignComponent {
  @Input({ required: true }) connection!: GithubConnection;
  @Input() project: Project | null = null;
  @Input() channels: ChannelConfig[] = [];
  @Input() channelsLoaded = false;

  readonly defaultStages = DEFAULT_STAGES;

  mode: Mode = 'list';
  campaigns: Campaign[] = [];
  sha: string | null = null;
  loaded = false;
  loading = false;
  saving = false;
  statusMessage = '';
  errorMessage = '';

  selectedCampaignId: string | null = null;

  // Builder wizard state
  step = 1;
  draftName = '';
  draftGoal = '';
  draftStartDate = '';
  draftEndDate = '';
  draftChannelIds: string[] = [];
  /** Target post count per channel, keyed by channel id -- set in step 3, alongside building the slot list. */
  draftChannelTargets: Record<string, number> = {};
  draftSlots: CampaignSlot[] = [];
  newSlotStage = '';
  newSlotGuidance = '';
  newSlotChannelId = '';

  // Currently-queued inbox posts, for the "link a post" picker in detail mode
  inboxPosts: InboxPost[] = [];
  inboxLoaded = false;
  loadingInbox = false;

  constructor(private readonly github: GithubService) {}

  get selectedCampaign(): Campaign | undefined {
    return this.campaigns.find((c) => c.id === this.selectedCampaignId);
  }

  channelName(channelId: string): string {
    return this.channels.find((c) => c.id === channelId)?.id ?? channelId;
  }

  nextOpenSlot(campaign: Campaign): CampaignSlot | undefined {
    return nextOpenSlot(campaign);
  }

  progressLabel(campaign: Campaign): string {
    const posted = campaign.slots.filter((s) => s.status === 'posted').length;
    return `${posted}/${campaign.slots.length} posted`;
  }

  channelProgress(campaign: Campaign): ChannelProgress[] {
    return channelProgress(campaign);
  }

  slotCountForChannel(channelId: string): number {
    return this.draftSlots.filter((s) => s.channelId === channelId).length;
  }

  linkableInboxPosts(slot: CampaignSlot): InboxPost[] {
    const alreadyLinked = new Set(
      (this.selectedCampaign?.slots ?? [])
        .filter((s) => s.id !== slot.id && s.linkedPostPath)
        .map((s) => s.linkedPostPath),
    );
    return this.inboxPosts.filter((p) => p.channelId === slot.channelId && !alreadyLinked.has(p.path));
  }

  // --- load/save ---

  async load(): Promise<void> {
    if (!this.project) return;
    this.errorMessage = '';
    this.statusMessage = '';
    this.loading = true;
    try {
      const { campaigns, sha } = await this.github.loadCampaigns(this.connection, this.project.id);
      // Campaigns created before channelTargets existed won't have it on GitHub.
      this.campaigns = campaigns.map((c) => ({ ...c, channelTargets: c.channelTargets ?? [] }));
      this.sha = sha;
      this.loaded = true;
      this.statusMessage = `Loaded ${campaigns.length} campaign(s).`;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  private async save(): Promise<void> {
    if (!this.project) return;
    this.errorMessage = '';
    this.saving = true;
    try {
      this.sha = await this.github.saveCampaigns(this.connection, this.project.id, this.campaigns, this.sha);
      this.statusMessage = 'Saved to GitHub.';
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.saving = false;
    }
  }

  async loadInbox(): Promise<void> {
    if (!this.project) return;
    this.errorMessage = '';
    this.loadingInbox = true;
    try {
      const tree = await this.github.loadTree(this.connection);
      this.inboxPosts = parseInboxTree(tree, this.project.id);
      this.inboxLoaded = true;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.loadingInbox = false;
    }
  }

  // --- navigation ---

  openList(): void {
    this.mode = 'list';
    this.statusMessage = '';
    this.errorMessage = '';
  }

  openBuilder(): void {
    this.mode = 'builder';
    this.step = 1;
    this.draftName = '';
    this.draftGoal = '';
    this.draftStartDate = '';
    this.draftEndDate = '';
    this.draftChannelIds = [];
    this.draftChannelTargets = {};
    this.draftSlots = [];
    this.resetNewSlotForm();
    this.statusMessage = '';
    this.errorMessage = '';
  }

  openDetail(campaignId: string): void {
    this.mode = 'detail';
    this.selectedCampaignId = campaignId;
    this.statusMessage = '';
    this.errorMessage = '';
    if (!this.inboxLoaded) {
      void this.loadInbox();
    }
  }

  // --- builder wizard ---

  toggleDraftChannel(channelId: string): void {
    const isSelected = this.draftChannelIds.includes(channelId);
    this.draftChannelIds = isSelected
      ? this.draftChannelIds.filter((id) => id !== channelId)
      : [...this.draftChannelIds, channelId];
    if (isSelected) {
      delete this.draftChannelTargets[channelId];
    } else {
      this.draftChannelTargets[channelId] = 0;
    }
    if (!this.newSlotChannelId && this.draftChannelIds.length > 0) {
      this.newSlotChannelId = this.draftChannelIds[0];
    }
  }

  pickStage(stage: string, guidance: string): void {
    this.newSlotStage = stage;
    this.newSlotGuidance = guidance;
  }

  private resetNewSlotForm(): void {
    this.newSlotStage = '';
    this.newSlotGuidance = '';
    this.newSlotChannelId = this.draftChannelIds[0] ?? '';
  }

  addDraftSlot(): void {
    const stage = this.newSlotStage.trim();
    const channelId = this.newSlotChannelId;
    if (!stage || !channelId) return;
    this.draftSlots = [...this.draftSlots, newSlot(stage, this.newSlotGuidance.trim(), channelId)];
    this.resetNewSlotForm();
  }

  removeDraftSlot(index: number): void {
    this.draftSlots = this.draftSlots.filter((_, i) => i !== index);
  }

  moveDraftSlot(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= this.draftSlots.length) return;
    const slots = this.draftSlots.slice();
    [slots[index], slots[target]] = [slots[target], slots[index]];
    this.draftSlots = slots;
  }

  goToStep(n: number): void {
    this.step = n;
  }

  async createCampaign(): Promise<void> {
    const name = this.draftName.trim();
    const goal = this.draftGoal.trim();
    if (!name || this.draftSlots.length === 0) {
      this.errorMessage = 'A campaign needs a name and at least one slot.';
      return;
    }
    const campaign = newCampaign(name, goal);
    campaign.startDate = this.draftStartDate || null;
    campaign.endDate = this.draftEndDate || null;
    campaign.slots = this.draftSlots;
    campaign.channelTargets = this.draftChannelIds
      .filter((channelId) => (this.draftChannelTargets[channelId] ?? 0) > 0)
      .map((channelId) => ({ channelId, targetCount: this.draftChannelTargets[channelId] }));

    this.campaigns = [...this.campaigns, campaign];
    await this.save();
    if (!this.errorMessage) {
      this.openDetail(campaign.id);
    }
  }

  // --- detail: linking posts to slots ---

  async linkPost(slot: CampaignSlot, post: InboxPost): Promise<void> {
    slot.linkedPostPath = post.path;
    slot.status = 'queued';
    await this.save();
  }

  async unlinkSlot(slot: CampaignSlot): Promise<void> {
    slot.linkedPostPath = undefined;
    slot.status = 'planned';
    await this.save();
  }
}
