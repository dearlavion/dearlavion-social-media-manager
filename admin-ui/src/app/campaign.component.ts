import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChannelConfig, Project } from './channel.model';
import { GithubConnection, GithubService } from './github.service';
import {
  CAMPAIGN_STATUSES,
  Campaign,
  CampaignSlot,
  CampaignStatus,
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

  /** A post's Edit button doesn't edit inline here -- Content Queue's "Planned" section is where that happens. */
  @Output() editInContentQueue = new EventEmitter<void>();

  readonly defaultStages = DEFAULT_STAGES;
  readonly campaignStatuses = CAMPAIGN_STATUSES;

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

  // Editing an existing campaign's per-channel goal, in detail mode
  editingGoalChannelId: string | null = null;
  editingGoalValue = 0;

  // Editing an existing campaign's dates, in detail mode
  editingDates = false;
  editingStartDate = '';
  editingEndDate = '';

  // Renaming an existing campaign, in detail mode
  editingName = false;
  editingNameValue = '';

  // Editing an existing campaign's overall goal text, in detail mode
  editingCampaignGoal = false;
  editingCampaignGoalValue = '';

  // Deleting an existing campaign, in detail mode
  confirmingDelete = false;

  // Adding a channel to an existing campaign, in detail mode
  addingChannel = false;
  newChannelId = '';

  // Removing a channel from an existing campaign, in detail mode
  confirmingRemoveChannelId: string | null = null;

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
      // Campaigns created before channelTargets/status/channelIds existed won't have them on GitHub.
      this.campaigns = campaigns.map((c) => ({
        ...c,
        channelTargets: c.channelTargets ?? [],
        status: c.status ?? 'open',
        channelIds: c.channelIds ?? Array.from(new Set([...c.slots.map((s) => s.channelId), ...(c.channelTargets ?? []).map((t) => t.channelId)])),
      }));
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
    this.editingGoalChannelId = null;
    this.editingDates = false;
    this.editingName = false;
    this.editingCampaignGoal = false;
    this.confirmingDelete = false;
    this.addingChannel = false;
    this.confirmingRemoveChannelId = null;
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
    if (!name) {
      this.errorMessage = 'A campaign needs a name.';
      return;
    }
    const campaign = newCampaign(name, goal);
    campaign.startDate = this.draftStartDate || null;
    campaign.endDate = this.draftEndDate || null;
    campaign.slots = this.draftSlots;
    campaign.channelIds = this.draftChannelIds;
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

  // --- detail: editing an existing campaign's per-channel goal ---

  startEditGoal(channelId: string, currentTarget: number): void {
    this.editingGoalChannelId = channelId;
    this.editingGoalValue = currentTarget;
  }

  cancelEditGoal(): void {
    this.editingGoalChannelId = null;
  }

  async saveEditGoal(): Promise<void> {
    const campaign = this.selectedCampaign;
    const channelId = this.editingGoalChannelId;
    if (!campaign || !channelId) return;

    const targetCount = Math.max(0, Math.floor(this.editingGoalValue) || 0);
    const existing = campaign.channelTargets.find((t) => t.channelId === channelId);
    if (targetCount === 0) {
      // 0 means "no goal" -- drop the entry rather than persist a meaningless target.
      campaign.channelTargets = campaign.channelTargets.filter((t) => t.channelId !== channelId);
    } else if (existing) {
      existing.targetCount = targetCount;
    } else {
      campaign.channelTargets = [...campaign.channelTargets, { channelId, targetCount }];
    }

    this.editingGoalChannelId = null;
    await this.save();
  }

  // --- detail: adding/removing a channel on an existing campaign ---

  availableChannelsToAdd(campaign: Campaign): ChannelConfig[] {
    const existing = new Set(campaign.channelIds ?? []);
    return this.channels.filter((c) => !existing.has(c.id));
  }

  startAddChannel(): void {
    const campaign = this.selectedCampaign;
    if (!campaign) return;
    this.newChannelId = this.availableChannelsToAdd(campaign)[0]?.id ?? '';
    this.addingChannel = true;
  }

  cancelAddChannel(): void {
    this.addingChannel = false;
  }

  async confirmAddChannel(): Promise<void> {
    const campaign = this.selectedCampaign;
    if (!campaign || !this.newChannelId) return;
    campaign.channelIds = [...(campaign.channelIds ?? []), this.newChannelId];
    this.addingChannel = false;
    await this.save();
  }

  /** How many slots reference this channel -- surfaced in the remove-channel confirmation, since removing it drops them too. */
  channelSlotCount(campaign: Campaign, channelId: string): number {
    return campaign.slots.filter((s) => s.channelId === channelId).length;
  }

  startRemoveChannel(channelId: string): void {
    this.confirmingRemoveChannelId = channelId;
  }

  cancelRemoveChannel(): void {
    this.confirmingRemoveChannelId = null;
  }

  async confirmRemoveChannel(channelId: string): Promise<void> {
    const campaign = this.selectedCampaign;
    if (!campaign) return;
    campaign.channelIds = (campaign.channelIds ?? []).filter((id) => id !== channelId);
    campaign.channelTargets = campaign.channelTargets.filter((t) => t.channelId !== channelId);
    campaign.slots = campaign.slots.filter((s) => s.channelId !== channelId);
    this.confirmingRemoveChannelId = null;
    await this.save();
  }

  // --- detail: editing an existing campaign's status and dates ---

  async updateStatus(status: CampaignStatus): Promise<void> {
    const campaign = this.selectedCampaign;
    if (!campaign) return;
    campaign.status = status;
    await this.save();
  }

  startEditDates(): void {
    const campaign = this.selectedCampaign;
    if (!campaign) return;
    this.editingStartDate = campaign.startDate ?? '';
    this.editingEndDate = campaign.endDate ?? '';
    this.editingDates = true;
  }

  cancelEditDates(): void {
    this.editingDates = false;
  }

  async saveEditDates(): Promise<void> {
    const campaign = this.selectedCampaign;
    if (!campaign) return;
    campaign.startDate = this.editingStartDate || null;
    campaign.endDate = this.editingEndDate || null;
    this.editingDates = false;
    await this.save();
  }

  // --- detail: renaming an existing campaign ---

  startEditName(): void {
    const campaign = this.selectedCampaign;
    if (!campaign) return;
    this.editingNameValue = campaign.name;
    this.editingName = true;
  }

  cancelEditName(): void {
    this.editingName = false;
  }

  async saveEditName(): Promise<void> {
    const campaign = this.selectedCampaign;
    const name = this.editingNameValue.trim();
    if (!campaign || !name) return;
    campaign.name = name;
    this.editingName = false;
    await this.save();
  }

  // --- detail: editing an existing campaign's overall goal text ---

  startEditCampaignGoal(): void {
    const campaign = this.selectedCampaign;
    if (!campaign) return;
    this.editingCampaignGoalValue = campaign.goal;
    this.editingCampaignGoal = true;
  }

  cancelEditCampaignGoal(): void {
    this.editingCampaignGoal = false;
  }

  async saveEditCampaignGoal(): Promise<void> {
    const campaign = this.selectedCampaign;
    if (!campaign) return;
    campaign.goal = this.editingCampaignGoalValue.trim();
    this.editingCampaignGoal = false;
    await this.save();
  }

  // --- detail: deleting an existing campaign ---

  /** Slots with real-world consequences (media queued or already published) -- surfaced in the delete confirmation, since planned-only slots have none. */
  linkedSlotCount(campaign: Campaign): number {
    return campaign.slots.filter((s) => s.status === 'queued' || s.status === 'posted').length;
  }

  startDeleteConfirm(): void {
    this.confirmingDelete = true;
  }

  cancelDelete(): void {
    this.confirmingDelete = false;
  }

  async confirmDelete(): Promise<void> {
    const campaign = this.selectedCampaign;
    if (!campaign) return;
    this.campaigns = this.campaigns.filter((c) => c.id !== campaign.id);
    this.confirmingDelete = false;
    await this.save();
    if (!this.errorMessage) {
      this.openList();
    }
  }
}
