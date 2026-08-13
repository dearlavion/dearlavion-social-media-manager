/**
 * A personal reminder, not tied to any project. `date`/`time` are the
 * local calendar day/time as picked in the UI (for display and calendar
 * grouping); `dueAt` is the UTC instant computed from those at creation
 * time, which is what automation actually compares "now" against.
 */
export interface Reminder {
  id: string;
  date: string;
  time: string;
  dueAt: string;
  message: string;
  notifiedAt: string | null;
}

export function newReminder(date: string, time: string, message: string): Reminder {
  return {
    id: crypto.randomUUID(),
    date,
    time,
    dueAt: new Date(`${date}T${time}:00`).toISOString(),
    message,
    notifiedAt: null,
  };
}
