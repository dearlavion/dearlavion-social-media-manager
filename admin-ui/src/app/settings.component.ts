import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GithubConnection, GithubService } from './github.service';
import {
  CronPattern,
  EVERY_N_MINUTES_OPTIONS,
  ParsedCron,
  WEEKDAYS,
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
  /** Null if a cron line was found but isn't one of the three shapes this page knows how to edit safely. */
  parsed: ParsedCron | null;
  // Editable fields for all three patterns at once -- switching the "Schedule type" selector just changes which
  // subset is shown, without losing whatever's already sitting in the others.
  editPattern: CronPattern;
  editMinute: number;
  editHour: number;
  editEveryN: number;
  editDays: number[];
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
  readonly weekdays = WEEKDAYS;
  readonly patternOptions: { value: CronPattern; label: string }[] = [
    { value: 'hourlyAtMinute', label: 'Every hour, at a specific minute' },
    { value: 'everyNMinutes', label: 'Every N minutes' },
    { value: 'daysAtTime', label: 'On specific days, at a specific time' },
  ];

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
            editPattern: parsed?.pattern ?? 'hourlyAtMinute',
            editMinute: parsed && parsed.pattern !== 'everyNMinutes' ? parsed.minute : 0,
            editHour: parsed?.pattern === 'daysAtTime' ? parsed.hour : 9,
            editEveryN: parsed?.pattern === 'everyNMinutes' ? parsed.everyN : 5,
            editDays: parsed?.pattern === 'daysAtTime' ? parsed.days : [0, 1, 2, 3, 4, 5, 6],
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

  formatTime(hour: number, minute: number): string {
    return `${this.padMinute(hour)}:${this.padMinute(minute)}`;
  }

  daysLabel(days: number[]): string {
    const sorted = [...days].sort((a, b) => a - b);
    if (sorted.length === 7) return 'Every day';
    if (sorted.join(',') === '1,2,3,4,5') return 'Weekdays';
    if (sorted.join(',') === '0,6') return 'Weekends';
    return sorted.map((d) => WEEKDAYS[d].label).join(', ');
  }

  describeCron(wf: WorkflowState): string {
    if (!wf.parsed) return wf.currentCron ?? '(no cron found)';
    switch (wf.parsed.pattern) {
      case 'hourlyAtMinute':
        return `Every hour, at :${this.padMinute(wf.parsed.minute)}`;
      case 'everyNMinutes':
        return `Every ${wf.parsed.everyN} minute${wf.parsed.everyN === 1 ? '' : 's'}`;
      case 'daysAtTime':
        return `${this.daysLabel(wf.parsed.days)} at ${this.formatTime(wf.parsed.hour, wf.parsed.minute)}`;
    }
  }

  toggleDay(wf: WorkflowState, day: number): void {
    wf.editDays = wf.editDays.includes(day) ? wf.editDays.filter((d) => d !== day) : [...wf.editDays, day].sort((a, b) => a - b);
  }

  setDaysPreset(wf: WorkflowState, preset: 'all' | 'weekdays' | 'weekends'): void {
    wf.editDays = preset === 'all' ? [0, 1, 2, 3, 4, 5, 6] : preset === 'weekdays' ? [1, 2, 3, 4, 5] : [0, 6];
  }

  /** Minute this workflow would fire at, for the two patterns where that's a single fixed value -- null for everyNMinutes, which has no one minute to compare. */
  private minuteOf(wf: WorkflowState): number | null {
    return wf.editPattern === 'everyNMinutes' ? null : wf.editMinute;
  }

  /** Other workflows currently set (or being edited) to the same minute -- a heads up, not a hard block. */
  minuteCollisions(wf: WorkflowState): string[] {
    const mine = this.minuteOf(wf);
    if (mine === null) return [];
    return this.workflows.filter((other) => other !== wf && this.minuteOf(other) === mine).map((other) => other.config.label);
  }

  async save(wf: WorkflowState): Promise<void> {
    if (!wf.parsed) return;
    if (wf.editPattern === 'daysAtTime' && wf.editDays.length === 0) {
      this.errorMessage = `${wf.config.label}: pick at least one day before saving.`;
      return;
    }
    this.errorMessage = '';
    this.statusMessage = '';
    this.savingFile = wf.config.file;
    try {
      const newParsed: ParsedCron =
        wf.editPattern === 'hourlyAtMinute'
          ? { pattern: 'hourlyAtMinute', minute: wf.editMinute }
          : wf.editPattern === 'everyNMinutes'
            ? { pattern: 'everyNMinutes', everyN: wf.editEveryN }
            : { pattern: 'daysAtTime', hour: wf.editHour, minute: wf.editMinute, days: wf.editDays };
      const newCron = buildCron(newParsed);
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
      wf.parsed = newParsed;
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
