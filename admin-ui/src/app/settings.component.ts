import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GithubConnection, GithubService } from './github.service';
import {
  EVERY_N_MINUTES_OPTIONS,
  ParsedCron,
  WORKFLOW_SCHEDULES,
  WorkflowScheduleConfig,
  buildCron,
  extractCronFromYaml,
  parseCron,
  replaceCronInYaml,
} from './workflow-schedule.model';

interface WorkflowState {
  config: WorkflowScheduleConfig;
  raw: string;
  sha: string;
  /** Null if no "cron: '...'" line was found in the file at all. */
  currentCron: string | null;
  /** Null if a cron line was found but isn't one of the two shapes this UI knows how to edit safely. */
  parsed: ParsedCron | null;
  editValue: number;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css',
})
export class SettingsComponent {
  @Input({ required: true }) connection!: GithubConnection;

  readonly everyNMinutesOptions = EVERY_N_MINUTES_OPTIONS;

  loading = false;
  loaded = false;
  errorMessage = '';
  statusMessage = '';
  savingFile: string | null = null;
  triggeringFile: string | null = null;

  workflows: WorkflowState[] = [];

  constructor(private readonly github: GithubService) {}

  async load(): Promise<void> {
    this.errorMessage = '';
    this.statusMessage = '';
    this.loading = true;
    try {
      this.workflows = await Promise.all(
        WORKFLOW_SCHEDULES.map(async (config): Promise<WorkflowState> => {
          const { content, sha } = await this.github.loadRawFile(this.connection, `.github/workflows/${config.file}`);
          const currentCron = extractCronFromYaml(content);
          const parsed = currentCron ? parseCron(currentCron) : null;
          return {
            config,
            raw: content,
            sha,
            currentCron,
            parsed,
            editValue: parsed?.value ?? (config.pattern === 'hourlyAtMinute' ? 0 : 5),
          };
        }),
      );
      this.loaded = true;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  padMinute(n: number): string {
    return String(n).padStart(2, '0');
  }

  describeCron(wf: WorkflowState): string {
    if (!wf.parsed) return wf.currentCron ?? '(no cron found)';
    return wf.parsed.pattern === 'hourlyAtMinute'
      ? `Every hour, at :${String(wf.parsed.value).padStart(2, '0')}`
      : `Every ${wf.parsed.value} minute${wf.parsed.value === 1 ? '' : 's'}`;
  }

  /** Other hourly workflows currently set (or being edited) to the same minute -- a heads up, not a hard block. */
  minuteCollisions(wf: WorkflowState): string[] {
    if (wf.config.pattern !== 'hourlyAtMinute') return [];
    return this.workflows
      .filter((other) => other !== wf && other.config.pattern === 'hourlyAtMinute' && other.editValue === wf.editValue)
      .map((other) => other.config.label);
  }

  async save(wf: WorkflowState): Promise<void> {
    if (!wf.parsed) return;
    this.errorMessage = '';
    this.statusMessage = '';
    this.savingFile = wf.config.file;
    try {
      const newCron = buildCron(wf.parsed.pattern, wf.editValue);
      const newContent = replaceCronInYaml(wf.raw, newCron);
      wf.sha = await this.github.saveRawFile(
        this.connection,
        `.github/workflows/${wf.config.file}`,
        newContent,
        wf.sha,
        `chore: update ${wf.config.file} schedule`,
      );
      wf.raw = newContent;
      wf.currentCron = newCron;
      wf.parsed = { pattern: wf.parsed.pattern, value: wf.editValue };
      this.statusMessage = `Saved ${wf.config.label}'s schedule.`;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.savingFile = null;
    }
  }

  async triggerNow(wf: WorkflowState): Promise<void> {
    this.errorMessage = '';
    this.statusMessage = '';
    this.triggeringFile = wf.config.file;
    try {
      await this.github.triggerWorkflow(this.connection, wf.config.file);
      this.statusMessage = `Triggered ${wf.config.label} -- check the Actions tab for progress.`;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.triggeringFile = null;
    }
  }
}
