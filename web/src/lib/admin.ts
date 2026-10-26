// Shared definitions for the admin screens. They mirror the database's check
// constraints so problems show up in the form, not as database errors.

import type { ApplicationStatus } from './types';
import { CITIZENSHIP, EDUCATION_LEVELS, ENROLLMENT_STATUSES, SCHOOL_TYPES } from './options';

export type RuleKind = 'criterion' | 'unstructured' | 'also_required';

export interface RuleDraft {
  key: string;
  kind: RuleKind;
  field: string;
  operator: string;
  value: string; // edited as text; converted by ruleValue()
  values: string[]; // for "in" / "not_in"
  grade_scale: string;
  description: string;
  note?: string;
}

export type FieldType = 'province' | 'number' | 'boolean' | 'enum' | 'text' | 'income' | 'grade';

export const RULE_FIELDS: { value: string; label: string; type: FieldType; options?: [string, string][] }[] = [
  { value: 'residence_province_id', label: 'Home province', type: 'province' },
  { value: 'residency_years', label: 'Years of residency', type: 'number' },
  { value: 'parent_registered_voter', label: 'Parent is a registered voter there', type: 'boolean' },
  { value: 'grade', label: 'Latest grade', type: 'grade' },
  { value: 'income', label: 'Household income (yearly)', type: 'income' },
  { value: 'is_4ps', label: '4Ps or Listahanan household', type: 'boolean' },
  { value: 'education_level', label: 'Year level', type: 'enum', options: EDUCATION_LEVELS },
  { value: 'enrollment_status', label: 'Enrollment status', type: 'enum', options: ENROLLMENT_STATUSES },
  { value: 'school_type', label: 'Type of school', type: 'enum', options: SCHOOL_TYPES },
  // Options come from the course_fields table; see fieldOptions().
  { value: 'ched_discipline', label: 'Course field', type: 'enum', options: [] },
  { value: 'age', label: 'Age', type: 'number' },
  { value: 'citizenship', label: 'Citizenship', type: 'enum', options: CITIZENSHIP },
  { value: 'holds_other_scholarship', label: 'Holds another scholarship', type: 'boolean' },
  { value: 'is_pwd', label: 'Person with disability', type: 'boolean' },
  { value: 'is_indigenous', label: 'Indigenous Peoples member', type: 'boolean' },
  { value: 'is_solo_parent_child', label: 'Child of a solo parent', type: 'boolean' },
  { value: 'is_ofw_dependent', label: 'Dependent of an OFW', type: 'boolean' },
  { value: 'is_athlete', label: 'Student athlete', type: 'boolean' },
  { value: 'is_first_gen', label: 'First in family in college', type: 'boolean' },
];

export const OPERATORS: Record<FieldType, [string, string][]> = {
  province: [['eq', 'is'], ['in', 'is one of']],
  number: [['gte', 'at least'], ['lte', 'at most'], ['eq', 'exactly']],
  grade: [['lte', 'at most (1.00 scale: lower is better)'], ['gte', 'at least (percent: higher is better)']],
  income: [['income_max_php', 'not more than (₱)'], ['income_min_php', 'at least (₱)']],
  boolean: [['is_true', 'yes'], ['is_false', 'no']],
  enum: [['eq', 'is'], ['in', 'is one of']],
  text: [['eq', 'is']],
};

export const STATUS_OPTIONS: [ApplicationStatus, string][] = [
  ['open_verified', 'Open, verified'],
  ['open_unconfirmed', 'Open, not recently confirmed'],
  ['upcoming', 'Upcoming'],
  ['closed', 'Closed'],
  ['suspended', 'Suspended or cancelled'],
  ['unknown', 'Status unknown'],
];

export const PROVIDER_KINDS: [string, string][] = [
  ['lgu', 'Local government (province, city, municipality)'],
  ['national_agency', 'National government agency'],
  ['suc', 'State university or college'],
  ['luc', 'Local university or college'],
  ['private_hei', 'Private college or university'],
  ['foundation', 'Foundation'],
  ['corporate', 'Company'],
  ['other', 'Other'],
];

// Choices for an enum rule field. Course fields are loaded from the database.
export function fieldOptions(field: string, courseFields: [string, string][]): [string, string][] {
  if (field === 'ched_discipline') return courseFields;
  return RULE_FIELDS.find((f) => f.value === field)?.options ?? [];
}

export function fieldType(field: string): FieldType | null {
  return RULE_FIELDS.find((f) => f.value === field)?.type ?? null;
}

let counter = 0;
export function newRule(partial: Partial<RuleDraft> = {}): RuleDraft {
  counter += 1;
  return {
    key: `r${counter}`,
    kind: 'criterion',
    field: '',
    operator: '',
    value: '',
    values: [],
    grade_scale: '',
    description: '',
    ...partial,
  };
}

/** Converts an edited rule to what approve_candidate() expects, or returns an error message. */
export function ruleToPayload(r: RuleDraft): { ok: true; rule: Record<string, unknown> } | { ok: false; error: string } {
  const description = r.description.trim();
  if (!description) return { ok: false, error: 'Every rule needs the wording students will see.' };
  if (r.kind !== 'criterion') return { ok: true, rule: { kind: r.kind, description } };

  const type = fieldType(r.field);
  if (!type) return { ok: false, error: `Choose what "${description}" checks, or mark it as not checkable.` };
  if (!OPERATORS[type].some(([op]) => op === r.operator)) {
    return { ok: false, error: `Choose a condition for "${description}".` };
  }
  const base = { kind: 'criterion', field: r.field, operator: r.operator, description };

  if (type === 'boolean') return { ok: true, rule: { ...base, value: null } };
  if (r.operator === 'in') {
    if (r.values.length === 0) return { ok: false, error: `Pick at least one option for "${description}".` };
    const vals = type === 'province' ? r.values.map(Number) : r.values;
    return { ok: true, rule: { ...base, value: vals } };
  }
  if (type === 'province') {
    if (!r.value) return { ok: false, error: `Pick a province for "${description}".` };
    return { ok: true, rule: { ...base, value: Number(r.value) } };
  }
  if (type === 'number' || type === 'income' || type === 'grade') {
    const n = Number(r.value);
    if (r.value.trim() === '' || !Number.isFinite(n) || n < 0) {
      return { ok: false, error: `Enter a number for "${description}".` };
    }
    if (type === 'grade') {
      if (!r.grade_scale) return { ok: false, error: `Choose the grading scale for "${description}".` };
      return { ok: true, rule: { ...base, value: n, grade_scale: r.grade_scale } };
    }
    return { ok: true, rule: { ...base, value: n } };
  }
  if (!r.value.trim()) return { ok: false, error: `Enter a value for "${description}".` };
  return { ok: true, rule: { ...base, value: r.value.trim() } };
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
