export type CronPattern = 'hourlyAtMinute' | 'everyNMinutes';

export interface WorkflowScheduleConfig {
  file: string;
  label: string;
  description: string;
  pattern: CronPattern;
}

/** The four cron-scheduled workflows -- kept in this fixed order for a stable, predictable Settings list. */
export const WORKFLOW_SCHEDULES: WorkflowScheduleConfig[] = [
  {
    file: 'sync-drive.yml',
    label: 'Drive sync',
    description: 'Pulls new media from each channel’s Google Drive folder into inbox/.',
    pattern: 'hourlyAtMinute',
  },
  {
    file: 'post.yml',
    label: 'Post due channels',
    description: 'Posts the oldest queued item for any channel whose interval has elapsed.',
    pattern: 'hourlyAtMinute',
  },
  {
    file: 'reminders.yml',
    label: 'Reminders',
    description: 'Checks personal reminders and emails you (via a deliberate run failure) when one is due.',
    pattern: 'hourlyAtMinute',
  },
  {
    file: 'scheduled-posts.yml',
    label: 'Scheduled posts',
    description: 'Publishes a campaign slot at its exact target time, or notifies if media is still missing.',
    pattern: 'everyNMinutes',
  },
];

/** Interval choices offered for "every N minutes" workflows -- kept to values that divide evenly into 60. */
export const EVERY_N_MINUTES_OPTIONS = [1, 5, 10, 15, 20, 30, 60];

export interface ParsedCron {
  pattern: CronPattern;
  value: number;
}

/**
 * Recognizes only the two cron shapes actually used in this repo's
 * workflows -- "<minute> * * * *" (once an hour, at that minute) and
 * "star-slash-<n> * * * *" (every n minutes). Anything else (a workflow
 * edited by hand into some other shape) returns null so the UI can fall
 * back to a read-only view rather than risk mangling an unrecognized
 * expression.
 */
export function parseCron(cron: string): ParsedCron | null {
  const minuteMatch = cron.trim().match(/^(\d{1,2}) \* \* \* \*$/);
  if (minuteMatch) {
    const minute = Number(minuteMatch[1]);
    if (minute >= 0 && minute <= 59) return { pattern: 'hourlyAtMinute', value: minute };
  }
  const everyMatch = cron.trim().match(/^\*\/(\d{1,2}) \* \* \* \*$/);
  if (everyMatch) {
    const n = Number(everyMatch[1]);
    if (n >= 1 && n <= 59) return { pattern: 'everyNMinutes', value: n };
  }
  return null;
}

export function buildCron(pattern: CronPattern, value: number): string {
  return pattern === 'hourlyAtMinute' ? `${value} * * * *` : `*/${value} * * * *`;
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
