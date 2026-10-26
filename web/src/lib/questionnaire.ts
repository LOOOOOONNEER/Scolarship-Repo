// Questionnaire helpers that do not depend on React, kept separate so they are easy to test.

export interface ProfileForm {
  birth_date: string;
  education_level: string;
  enrollment_status: string;
  school_name: string;
  school_type: string;
  program_name: string;
  ched_discipline: string;
  grade_value: string;
  grade_scale: string;
  grade_source: string;
  residence_province_id: string;
  residence_locality_id: string;
  residency_years: string;
  parent_registered_voter: string; // 'yes' | 'no' | ''
  income_bracket: string;
  is_4ps: string; // 'yes' | 'no' | ''
  citizenship: string;
  holds_other_scholarship: string; // 'yes' | 'no' | ''
}

export const EMPTY_FORM: ProfileForm = {
  birth_date: '',
  education_level: '',
  enrollment_status: '',
  school_name: '',
  school_type: '',
  program_name: '',
  ched_discipline: '',
  grade_value: '',
  grade_scale: '',
  grade_source: '',
  residence_province_id: '',
  residence_locality_id: '',
  residency_years: '',
  parent_registered_voter: '',
  income_bracket: '',
  is_4ps: '',
  citizenship: '',
  holds_other_scholarship: '',
};

export interface GradeScale {
  code: string;
  label: string;
  min_value: number;
  max_value: number;
}

type Row = Record<string, unknown>;

const yesNo = (v: unknown) => (v === true ? 'yes' : v === false ? 'no' : '');
const toBool = (v: string) => (v === 'yes' ? true : v === 'no' ? false : null);
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const text = (v: string) => (v.trim() === '' ? null : v.trim());
const num = (v: string) => (v.trim() === '' ? null : Number(v));

export function formFromRow(row: Row | null): ProfileForm {
  if (!row) return { ...EMPTY_FORM };
  return {
    birth_date: str(row.birth_date),
    education_level: str(row.education_level),
    enrollment_status: str(row.enrollment_status),
    school_name: str(row.school_name),
    school_type: str(row.school_type),
    program_name: str(row.program_name),
    ched_discipline: str(row.ched_discipline),
    grade_value: str(row.grade_value),
    grade_scale: str(row.grade_scale),
    grade_source: str(row.grade_source),
    residence_province_id: str(row.residence_province_id),
    residence_locality_id: str(row.residence_locality_id),
    residency_years: str(row.residency_years),
    parent_registered_voter: yesNo(row.parent_registered_voter),
    income_bracket: str(row.income_bracket),
    is_4ps: yesNo(row.is_4ps),
    citizenship: str(row.citizenship),
    holds_other_scholarship: yesNo(row.holds_other_scholarship),
  };
}

export function rowFromForm(userId: string, f: ProfileForm): Row {
  return {
    user_id: userId,
    birth_date: text(f.birth_date),
    education_level: text(f.education_level),
    enrollment_status: text(f.enrollment_status),
    school_name: text(f.school_name),
    school_type: text(f.school_type),
    program_name: text(f.program_name),
    ched_discipline: text(f.ched_discipline),
    grade_value: f.grade_scale ? num(f.grade_value) : null,
    grade_scale: f.grade_value.trim() ? text(f.grade_scale) : null,
    grade_source: f.grade_value.trim() ? text(f.grade_source) : null,
    residence_province_id: num(f.residence_province_id),
    residence_locality_id: f.residence_province_id ? num(f.residence_locality_id) : null,
    residency_years: num(f.residency_years),
    parent_registered_voter: toBool(f.parent_registered_voter),
    income_bracket: num(f.income_bracket),
    is_4ps: toBool(f.is_4ps),
    citizenship: text(f.citizenship),
    holds_other_scholarship: toBool(f.holds_other_scholarship),
  };
}

// Age in whole years on today's date in Manila.
export function ageOn(birthDate: string, today: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) return null;
  const manila = new Date(today.getTime() + 8 * 3600 * 1000);
  const y = manila.getUTCFullYear(), mo = manila.getUTCMonth() + 1, d = manila.getUTCDate();
  let age = y - Number(m[1]);
  if (mo < Number(m[2]) || (mo === Number(m[2]) && d < Number(m[3]))) age -= 1;
  return age;
}

// Problems shown next to the form before saving. The database checks again.
export function validateForm(f: ProfileForm, scales: GradeScale[], today: Date = new Date()): string[] {
  const problems: string[] = [];
  if (!f.birth_date) problems.push('Enter your birth date.');
  else {
    const age = ageOn(f.birth_date, today);
    if (age === null || age < 12 || age > 80) problems.push('Check your birth date.');
  }
  if (f.grade_value.trim()) {
    const value = Number(f.grade_value);
    const scale = scales.find((s) => s.code === f.grade_scale);
    if (!scale) problems.push('Choose the grading scale your grade uses.');
    else if (!Number.isFinite(value) || value < scale.min_value || value > scale.max_value) {
      problems.push(`Your grade must be between ${scale.min_value} and ${scale.max_value} on the ${scale.label} scale.`);
    }
  }
  if (f.residency_years.trim()) {
    const y = Number(f.residency_years);
    if (!Number.isFinite(y) || y < 0 || y > 80) problems.push('Years of residency should be a number from 0 to 80.');
  }
  return problems;
}

// Which questionnaire section answers each rule field (for "missing information" links).
export const SECTION_FOR_FIELD: Record<string, string> = {
  education_level: 'education',
  enrollment_status: 'education',
  school_type: 'education',
  ched_discipline: 'education',
  grade: 'academics',
  residence_province_id: 'residency',
  residence_locality_id: 'residency',
  residency_years: 'residency',
  parent_registered_voter: 'residency',
  income: 'finances',
  is_4ps: 'finances',
  citizenship: 'other',
  holds_other_scholarship: 'other',
  age: 'other',
  is_pwd: 'sensitive',
  is_indigenous: 'sensitive',
  is_solo_parent_child: 'sensitive',
  is_ofw_dependent: 'sensitive',
  is_athlete: 'sensitive',
  is_first_gen: 'sensitive',
};
