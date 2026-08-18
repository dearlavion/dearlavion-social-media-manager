export interface WorkflowScheduleConfig {
  file: string;
  label: string;
  description: string;
}

/** The four cron-scheduled workflows -- kept in this fixed order for a stable, predictable Settings list. */
export const WORKFLOW_SCHEDULES: WorkflowScheduleConfig[] = [
  {
    file: 'sync-drive.yml',
    label: 'Drive sync',
    description: 'Pulls new media from each channel’s Google Drive folder into inbox/.',
  },
  {
    file: 'post.yml',
    label: 'Post due channels',
    description: 'Posts the oldest queued item for any channel whose interval has elapsed.',
  },
  {
    file: 'reminders.yml',
    label: 'Reminders',
    description: 'Checks personal reminders and emails you (via a deliberate run failure) when one is due.',
  },
  {
    file: 'scheduled-posts.yml',
    label: 'Scheduled posts',
    description: 'Publishes a campaign slot at its exact target time, or notifies if media is still missing.',
  },
];

/** Interval choices offered for "every N minutes" -- kept to values that divide evenly into 60. */
export const EVERY_N_MINUTES_OPTIONS = [1, 5, 10, 15, 20, 30, 60];

export interface Weekday {
  /** Cron's own day-of-week numbering -- 0 is Sunday. */
  value: number;
  label: string;
}

export const WEEKDAYS: Weekday[] = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

export type CronPattern = 'hourlyAtMinute' | 'everyNMinutes' | 'daysAtTime';

/**
 * GitHub Actions cron has no seconds field -- one minute is the finest
 * granularity it supports, full stop. These three shapes are the ones this
 * page knows how to build and edit safely; anything else (hand-edited into
 * some other cron shape -- a month restriction, a day-of-month, an hour
 * range) falls back to a read-only display rather than risk mangling an
 * expression this page doesn't understand.
 */
export type ParsedCron =
  | { pattern: 'hourlyAtMinute'; minute: number }
  | { pattern: 'everyNMinutes'; everyN: number }
  | { pattern: 'daysAtTime'; hour: number; minute: number; days: number[] };

export function parseCron(cron: string): ParsedCron | null {
  const trimmed = cron.trim();

  const hourlyMatch = trimmed.match(/^(\d{1,2}) \* \* \* \*$/);
  if (hourlyMatch) {
    const minute = Number(hourlyMatch[1]);
    if (minute >= 0 && minute <= 59) return { pattern: 'hourlyAtMinute', minute };
  }

  const everyMatch = trimmed.match(/^\*\/(\d{1,2}) \* \* \* \*$/);
  if (everyMatch) {
    const everyN = Number(everyMatch[1]);
    if (everyN >= 1 && everyN <= 59) return { pattern: 'everyNMinutes', everyN };
  }

  const daysMatch = trimmed.match(/^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6](?:,[0-6])*)$/);
  if (daysMatch) {
    const minute = Number(daysMatch[1]);
    const hour = Number(daysMatch[2]);
    const days = daysMatch[3] === '*' ? [0, 1, 2, 3, 4, 5, 6] : [...new Set(daysMatch[3].split(',').map(Number))].sort((a, b) => a - b);
    if (minute >= 0 && minute <= 59 && hour >= 0 && hour <= 23 && days.length > 0) {
      return { pattern: 'daysAtTime', minute, hour, days };
    }
  }

  return null;
}

export function buildCron(parsed: ParsedCron): string {
  switch (parsed.pattern) {
    case 'hourlyAtMinute':
      return `${parsed.minute} * * * *`;
    case 'everyNMinutes':
      return `*/${parsed.everyN} * * * *`;
    case 'daysAtTime': {
      const daysField = parsed.days.length === 7 ? '*' : [...parsed.days].sort((a, b) => a - b).join(',');
      return `${parsed.minute} ${parsed.hour} * * ${daysField}`;
    }
  }
}

/** Finds the "- cron: '...'" line in a workflow file's raw text and pulls out just the expression. */
export function extractCronFromYaml(yaml: string): string | null {
  const match = yaml.match(/cron: '([^']*)'/);
  return match ? match[1] : null;
}

/** Replaces the cron expression in a workflow file's raw text, leaving everything else (including any trailing comment) untouched. */
export function replaceCronInYaml(yaml: string, newCron: string): string {
  return yaml.replace(/cron: '[^']*'/, `cron: '${newCron}'`);
}
