import type { ApplicationStatus, MatchResult } from './types';

export const statusLabel: Record<ApplicationStatus, string> = {
  open_verified: 'Open, verified',
  open_unconfirmed: 'Open, not recently confirmed',
  upcoming: 'Upcoming',
  closed: 'Closed',
  suspended: 'Suspended or cancelled',
  unknown: 'Status unknown',
};

export const statusTone: Record<ApplicationStatus, 'good' | 'warn' | 'neutral' | 'bad'> = {
  open_verified: 'good',
  open_unconfirmed: 'warn',
  upcoming: 'neutral',
  closed: 'bad',
  suspended: 'bad',
  unknown: 'neutral',
};

export const matchLabel: Record<MatchResult, string> = {
  eligible: 'Appears to meet the requirements',
  needs_verification: 'Needs verification',
  missing_information: 'Missing information',
  not_eligible: 'Does not meet the requirements',
};

export const matchTone: Record<MatchResult, 'good' | 'warn' | 'neutral' | 'bad'> = {
  eligible: 'good',
  needs_verification: 'warn',
  missing_information: 'neutral',
  not_eligible: 'bad',
};

const dateFormat = new Intl.DateTimeFormat('en-PH', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'Asia/Manila',
});

export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  // Plain dates (YYYY-MM-DD) are calendar dates; parse them at Manila noon so
  // they never shift a day.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+08:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : dateFormat.format(d);
}

export function deadlineText(closesOn: string | null, rolling: boolean): string {
  if (rolling) return 'Rolling admission';
  if (!closesOn) return 'Deadline not confirmed';
  return `Closes ${formatDate(closesOn)}`;
}
