// Answer options shared by the student questionnaire and the reviewer's rule
// editor, so a student's answer and a scholarship's rule always use the same codes.
// Codes match the database enums and check constraints.

export type Option = [value: string, label: string];

export const EDUCATION_LEVELS: Option[] = [
  ['incoming_freshman', 'Incoming freshman'],
  ['first_year', '1st year'],
  ['second_year', '2nd year'],
  ['third_year', '3rd year'],
  ['fourth_year', '4th year'],
  ['fifth_year', '5th year'],
];

export const ENROLLMENT_STATUSES: Option[] = [
  ['not_yet_enrolled', 'Not yet enrolled'],
  ['enrolled', 'Enrolled'],
  ['on_leave', 'On leave'],
  ['irregular', 'Irregular'],
];

export const SCHOOL_TYPES: Option[] = [
  ['suc', 'State university or college (SUC)'],
  ['luc', 'Local university or college (LUC)'],
  ['private', 'Private'],
  ['other', 'Other'],
];

export const CITIZENSHIP: Option[] = [
  ['filipino', 'Filipino citizen'],
  ['other', 'Not a Filipino citizen'],
];

export const GRADE_SOURCES: Option[] = [
  ['report_card', 'Report card'],
  ['transcript', 'Transcript of records'],
  ['self_reported', 'From memory'],
];

export interface SensitiveQuestion {
  field: 'is_pwd' | 'is_indigenous' | 'is_solo_parent_child' | 'is_ofw_dependent' | 'is_athlete' | 'is_first_gen';
  label: string;
  question: string;
}

export const SENSITIVE_QUESTIONS: SensitiveQuestion[] = [
  { field: 'is_pwd', label: 'Person with disability', question: 'Are you a person with disability (PWD)?' },
  { field: 'is_indigenous', label: 'Indigenous Peoples member', question: 'Are you a member of an Indigenous Peoples group?' },
  { field: 'is_solo_parent_child', label: 'Child of a solo parent', question: 'Are you the child of a solo parent?' },
  { field: 'is_ofw_dependent', label: 'Dependent of an OFW', question: 'Is a parent or guardian an overseas Filipino worker (OFW)?' },
  { field: 'is_athlete', label: 'Student athlete', question: 'Are you a varsity or competitive student athlete?' },
  { field: 'is_first_gen', label: 'First in family in college', question: 'Are you the first in your family to go to college?' },
];

// Version label stored with every privacy-notice consent. Change it whenever the
// notice text in PrivacyNotice.tsx changes, so consents record what was shown.
export const PRIVACY_NOTICE_VERSION = '2026-10-draft-1';

export function labelFor(options: Option[], value: string | null | undefined): string {
  return options.find(([v]) => v === value)?.[1] ?? '';
}
