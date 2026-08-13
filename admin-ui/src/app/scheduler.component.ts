import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Reminder, newReminder } from './reminder.model';
import { GithubConnection, GithubService } from './github.service';

interface CalendarDay {
  date: string;
  day: number;
  isToday: boolean;
  reminders: Reminder[];
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

@Component({
  selector: 'app-scheduler',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './scheduler.component.html',
  styleUrl: './scheduler.component.css',
})
export class SchedulerComponent {
  @Input({ required: true }) connection!: GithubConnection;

  readonly weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  reminders: Reminder[] = [];
  sha: string | null = null;
  loaded = false;
  loading = false;
  saving = false;
  statusMessage = '';
  errorMessage = '';

  currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  selectedDate = toDateKey(new Date());
  newTime = '09:00';
  newMessage = '';

  constructor(private readonly github: GithubService) {}

  get monthLabel(): string {
    return this.currentMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  get weeks(): (CalendarDay | null)[][] {
    const year = this.currentMonth.getFullYear();
    const month = this.currentMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startWeekday = new Date(year, month, 1).getDay();
    const todayKey = toDateKey(new Date());

    const remindersByDate = new Map<string, Reminder[]>();
    for (const r of this.reminders) {
      const list = remindersByDate.get(r.date) ?? [];
      list.push(r);
      remindersByDate.set(r.date, list);
    }

    const cells: (CalendarDay | null)[] = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const date = toDateKey(new Date(year, month, day));
      cells.push({
        date,
        day,
        isToday: date === todayKey,
        reminders: (remindersByDate.get(date) ?? []).slice().sort((a, b) => a.time.localeCompare(b.time)),
      });
    }
    while (cells.length % 7 !== 0) cells.push(null);

    const weeks: (CalendarDay | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }

  get selectedDateReminders(): Reminder[] {
    return this.reminders.filter((r) => r.date === this.selectedDate).sort((a, b) => a.time.localeCompare(b.time));
  }

  get selectedDateLabel(): string {
    return new Date(`${this.selectedDate}T00:00:00`).toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  prevMonth(): void {
    this.currentMonth = new Date(this.currentMonth.getFullYear(), this.currentMonth.getMonth() - 1, 1);
  }

  nextMonth(): void {
    this.currentMonth = new Date(this.currentMonth.getFullYear(), this.currentMonth.getMonth() + 1, 1);
  }

  goToday(): void {
    const today = new Date();
    this.currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    this.selectedDate = toDateKey(today);
  }

  selectDate(date: string): void {
    this.selectedDate = date;
  }

  async load(): Promise<void> {
    this.errorMessage = '';
    this.statusMessage = '';
    this.loading = true;
    try {
      const { reminders, sha } = await this.github.loadReminders(this.connection);
      this.reminders = reminders;
      this.sha = sha;
      this.loaded = true;
      this.statusMessage = `Loaded ${reminders.length} reminder(s).`;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  async save(): Promise<void> {
    this.errorMessage = '';
    this.statusMessage = '';
    this.saving = true;
    try {
      this.sha = await this.github.saveReminders(this.connection, this.reminders, this.sha);
      this.statusMessage = 'Saved to GitHub.';
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.saving = false;
    }
  }

  addReminder(): void {
    const message = this.newMessage.trim();
    if (!message) return;
    this.reminders = [...this.reminders, newReminder(this.selectedDate, this.newTime, message)];
    this.newMessage = '';
  }

  removeReminder(id: string): void {
    this.reminders = this.reminders.filter((r) => r.id !== id);
  }
}
