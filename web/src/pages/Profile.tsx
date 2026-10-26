import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { requireClient } from '../lib/supabase';
import { PrivacyNoticeText } from '../components/PrivacyNotice';
import {
  CITIZENSHIP,
  EDUCATION_LEVELS,
  ENROLLMENT_STATUSES,
  GRADE_SOURCES,
  PRIVACY_NOTICE_VERSION,
  SCHOOL_TYPES,
  SENSITIVE_QUESTIONS,
  type Option,
  type SensitiveQuestion,
} from '../lib/options';
import { ageOn, EMPTY_FORM, formFromRow, rowFromForm, validateForm, type GradeScale, type ProfileForm } from '../lib/questionnaire';

interface Locality {
  id: number;
  name: string;
  kind: string;
  parent_id: number | null;
}

interface Consent {
  id: string;
  consent_type: string;
}

type SensitiveAnswers = Partial<Record<SensitiveQuestion['field'], string>>; // 'yes' | 'no' | ''

function Select({ id, value, onChange, options, placeholder = 'Choose…' }: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function YesNo({ name, value, onChange, allowSkip = true }: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  allowSkip?: boolean;
}) {
  const choices: Option[] = [['yes', 'Yes'], ['no', 'No'], ...(allowSkip ? ([['', 'Prefer not to say']] as Option[]) : [])];
  return (
    <div className="choices" role="radiogroup">
      {choices.map(([v, l]) => (
        <label key={v || 'skip'} className="check">
          <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
          {l}
        </label>
      ))}
    </div>
  );
}

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <fieldset id={id} className="q-section">
      <legend>{title}</legend>
      {intro && <p className="muted small">{intro}</p>}
      <div className="form-grid">{children}</div>
    </fieldset>
  );
}

export function Profile() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [form, setForm] = useState<ProfileForm>({ ...EMPTY_FORM });
  const [hasProfile, setHasProfile] = useState(false);
  const [sensitive, setSensitive] = useState<SensitiveAnswers>({});
  const [sensitiveConsentDraft, setSensitiveConsentDraft] = useState<Record<string, boolean>>({});
  const [inUse, setInUse] = useState<string[]>([]);
  const [localities, setLocalities] = useState<Locality[]>([]);
  const [scales, setScales] = useState<GradeScale[]>([]);
  const [brackets, setBrackets] = useState<Option[]>([]);
  const [courses, setCourses] = useState<Option[]>([]);

  const [guardianName, setGuardianName] = useState('');
  const [guardianContact, setGuardianContact] = useState('');
  const [guardianAgreed, setGuardianAgreed] = useState(false);

  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const client = requireClient();
    const [prof, sens, cons, use, loc, gs, ib, cf] = await Promise.all([
      client.from('profiles').select('*').maybeSingle(),
      client.from('profile_sensitive').select('*').maybeSingle(),
      client.from('consents').select('id, consent_type').is('withdrawn_at', null),
      client.rpc('sensitive_questions_in_use'),
      client.from('localities').select('id, name, kind, parent_id').order('name'),
      client.from('grade_scales').select('code, label, min_value, max_value'),
      client.from('income_brackets').select('id, label').order('id'),
      client.from('course_fields').select('code, label').order('sort'),
    ]);
    if (prof.error || cons.error) {
      setLoadError('Your profile could not be loaded. Please try again.');
      setLoading(false);
      return;
    }
    setHasProfile(Boolean(prof.data));
    setForm(formFromRow(prof.data as Record<string, unknown> | null));
    const s = (sens.data ?? {}) as Record<string, unknown>;
    const answers: SensitiveAnswers = {};
    for (const q of SENSITIVE_QUESTIONS) answers[q.field] = s[q.field] === true ? 'yes' : s[q.field] === false ? 'no' : '';
    setSensitive(answers);
    setConsents((cons.data ?? []) as Consent[]);
    setInUse(((use.data ?? []) as unknown[]).map((x) => (typeof x === 'string' ? x : String(Object.values(x as object)[0]))));
    setLocalities((loc.data ?? []) as Locality[]);
    setScales(((gs.data ?? []) as GradeScale[]).map((x) => ({ ...x, min_value: Number(x.min_value), max_value: Number(x.max_value) })));
    setBrackets(((ib.data ?? []) as { id: number; label: string }[]).map((b) => [String(b.id), b.label]));
    setCourses(((cf.data ?? []) as { code: string; label: string }[]).map((c) => [c.code, c.label]));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  // Arriving from a "missing information" link: scroll to that section once loaded.
  const location = useLocation();
  useEffect(() => {
    if (!loading && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [loading, location.hash]);

  const hasConsent = (type: string) => consents.some((c) => c.consent_type === type);
  const agreedToNotice = hasConsent('privacy_notice');
  const age = ageOn(form.birth_date);
  const isMinor = age !== null && age < 18;
  const guardianOk = !isMinor || hasConsent('guardian');

  const provinces = useMemo(() => localities.filter((l) => l.kind === 'province'), [localities]);
  const towns = useMemo(
    () => localities.filter((l) => l.kind !== 'province' && String(l.parent_id) === form.residence_province_id),
    [localities, form.residence_province_id],
  );
  const askedSensitive = SENSITIVE_QUESTIONS.filter((q) => inUse.includes(q.field) || hasConsent(`sensitive:${q.field}`));

  const set = (key: keyof ProfileForm) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value, ...(key === 'residence_province_id' ? { residence_locality_id: '' } : {}) }));
    setMessage(null);
  };

  const agree = async () => {
    const { error } = await requireClient()
      .from('consents')
      .insert({ user_id: userId, consent_type: 'privacy_notice', notice_version: PRIVACY_NOTICE_VERSION });
    if (error) setMessage('That did not save. Please try again.');
    else await load();
  };

  const saveGuardian = async () => {
    if (!guardianName.trim() || !guardianContact.trim() || !guardianAgreed) {
      setMessage('Enter your parent or guardian\'s name and contact, and confirm they agree.');
      return;
    }
    const { error } = await requireClient().from('consents').insert({
      user_id: userId,
      consent_type: 'guardian',
      notice_version: PRIVACY_NOTICE_VERSION,
      guardian_name: guardianName.trim(),
      guardian_contact: guardianContact.trim(),
    });
    if (error) setMessage('That did not save. Please try again.');
    else {
      setMessage('Guardian consent recorded.');
      await load();
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateForm(form, scales);
    setProblems(found);
    if (found.length) return;
    setSaving(true);
    setMessage(null);
    const client = requireClient();

    const { error } = await client.from('profiles').upsert(rowFromForm(userId, form), { onConflict: 'user_id' });
    if (error) {
      setSaving(false);
      setMessage('Your answers could not be saved. Please check them and try again.');
      return;
    }

    // Sensitive answers: only for questions the student has agreed to share.
    if (guardianOk && askedSensitive.length) {
      const newConsents = askedSensitive.filter(
        (q) => !hasConsent(`sensitive:${q.field}`) && sensitiveConsentDraft[q.field] && sensitive[q.field],
      );
      if (newConsents.length) {
        const { error: cErr } = await client.from('consents').insert(
          newConsents.map((q) => ({ user_id: userId, consent_type: `sensitive:${q.field}`, notice_version: PRIVACY_NOTICE_VERSION })),
        );
        if (cErr) {
          setSaving(false);
          setMessage('Your main answers were saved, but the optional questions were not. Please try again.');
          return;
        }
      }
      const shared = new Set([
        ...consents.filter((c) => c.consent_type.startsWith('sensitive:')).map((c) => c.consent_type.slice(10)),
        ...newConsents.map((q) => q.field),
      ]);
      const row: Record<string, unknown> = { user_id: userId };
      for (const q of askedSensitive) {
        if (shared.has(q.field)) row[q.field] = sensitive[q.field] === 'yes' ? true : sensitive[q.field] === 'no' ? false : null;
      }
      if (Object.keys(row).length > 1) {
        const { error: sErr } = await client.from('profile_sensitive').upsert(row, { onConflict: 'user_id' });
        if (sErr) {
          setSaving(false);
          setMessage('Your main answers were saved, but the optional questions were not. Please try again.');
          return;
        }
      }
    }

    setSaving(false);
    setHasProfile(true);
    setSensitiveConsentDraft({});
    setMessage('Saved. Your matches have been updated.');
    await load();
  };

  if (loading) return <p className="muted">Loading…</p>;
  if (loadError) return <p className="error">{loadError}</p>;

  if (!agreedToNotice) {
    return (
      <section className="narrow">
        <h1>Before you start</h1>
        <p className="lead">About 3 minutes of questions, so we can show scholarships whose requirements you appear to meet.</p>
        <div className="panel">
          <h2>How we handle your answers</h2>
          <PrivacyNoticeText />
          <button type="button" className="button" onClick={agree}>
            I agree, continue
          </button>
        </div>
        {message && <p className="error">{message}</p>}
      </section>
    );
  }

  const scale = scales.find((s) => s.code === form.grade_scale);

  return (
    <section className="questionnaire">
      <h1>Your profile</h1>
      <p className="muted">
        Answer what you know. Blank answers are fine: matches that depend on them show as "missing information".
      </p>

      <form onSubmit={save} noValidate>
        <Section id="education" title="Education">
          <label>
            Year level
            <Select id="education_level" value={form.education_level} onChange={set('education_level')} options={EDUCATION_LEVELS} />
          </label>
          <label>
            Enrollment status
            <Select id="enrollment_status" value={form.enrollment_status} onChange={set('enrollment_status')} options={ENROLLMENT_STATUSES} />
          </label>
          <label>
            School
            <input value={form.school_name} onChange={(e) => set('school_name')(e.target.value)} autoComplete="organization" />
          </label>
          <label>
            Type of school
            <Select id="school_type" value={form.school_type} onChange={set('school_type')} options={SCHOOL_TYPES} />
          </label>
          <label>
            Course or program
            <input value={form.program_name} onChange={(e) => set('program_name')(e.target.value)} placeholder="e.g. BS Civil Engineering" />
          </label>
          <label>
            Course field
            <Select id="ched_discipline" value={form.ched_discipline} onChange={set('ched_discipline')} options={courses} />
          </label>
        </Section>

        <Section
          id="academics"
          title="Latest grade"
          intro={
            form.education_level === 'incoming_freshman'
              ? 'Incoming freshmen: use your senior high school general average.'
              : 'Use your latest general weighted average (GWA), exactly as written on your grades.'
          }
        >
          <label>
            Grade
            <input
              inputMode="decimal"
              value={form.grade_value}
              onChange={(e) => set('grade_value')(e.target.value)}
              placeholder={scale ? `${scale.min_value} to ${scale.max_value}` : ''}
            />
          </label>
          <label>
            Grading scale
            <Select
              id="grade_scale"
              value={form.grade_scale}
              onChange={set('grade_scale')}
              options={scales.map((s) => [s.code, s.label] as Option)}
            />
          </label>
          <label>
            Where it comes from
            <Select id="grade_source" value={form.grade_source} onChange={set('grade_source')} options={GRADE_SOURCES} />
          </label>
          <p className="muted small wide">
            We never convert your grade by guesswork. If a scholarship uses a different scale and has published no
            official conversion, the match shows "needs verification".
          </p>
        </Section>

        <Section id="residency" title="Where you live" intro="Many local government scholarships require residency.">
          <label>
            Home province
            <Select
              id="residence_province_id"
              value={form.residence_province_id}
              onChange={set('residence_province_id')}
              options={provinces.map((p) => [String(p.id), p.name] as Option)}
            />
          </label>
          {towns.length > 0 && (
            <label>
              City or municipality
              <Select
                id="residence_locality_id"
                value={form.residence_locality_id}
                onChange={set('residence_locality_id')}
                options={towns.map((t) => [String(t.id), t.name] as Option)}
              />
            </label>
          )}
          <label>
            Years living there
            <input inputMode="decimal" value={form.residency_years} onChange={(e) => set('residency_years')(e.target.value)} />
          </label>
          <div className="wide">
            <p className="label">Is a parent a registered voter there?</p>
            <YesNo name="parent_registered_voter" value={form.parent_registered_voter} onChange={set('parent_registered_voter')} />
          </div>
        </Section>

        <Section id="finances" title="Household finances" intro="Optional. Used only for need-based scholarships.">
          <label>
            Yearly household income
            <Select
              id="income_bracket"
              value={form.income_bracket}
              onChange={set('income_bracket')}
              options={brackets}
              placeholder="Prefer not to say"
            />
          </label>
          <div>
            <p className="label">4Ps or Listahanan household?</p>
            <YesNo name="is_4ps" value={form.is_4ps} onChange={set('is_4ps')} />
          </div>
        </Section>

        <Section id="other" title="About you">
          <label>
            Birth date
            <input type="date" value={form.birth_date} onChange={(e) => set('birth_date')(e.target.value)} autoComplete="bday" />
          </label>
          <label>
            Citizenship
            <Select id="citizenship" value={form.citizenship} onChange={set('citizenship')} options={CITIZENSHIP} />
          </label>
          <div className="wide">
            <p className="label">Do you currently hold another scholarship?</p>
            <YesNo name="holds_other_scholarship" value={form.holds_other_scholarship} onChange={set('holds_other_scholarship')} />
          </div>
        </Section>

        <fieldset id="sensitive" className="q-section">
          <legend>Optional questions for specific scholarships</legend>
          {askedSensitive.length === 0 ? (
            <p className="muted small">
              No listed scholarship currently needs questions about disability, Indigenous Peoples membership or
              similar topics, so we don't ask them.
            </p>
          ) : !guardianOk ? (
            <div className="panel">
              <p>
                Because you are under 18, a parent or guardian must agree before you answer these questions.
              </p>
              <label>
                Parent or guardian's name
                <input value={guardianName} onChange={(e) => setGuardianName(e.target.value)} />
              </label>
              <label>
                Their phone number or email
                <input value={guardianContact} onChange={(e) => setGuardianContact(e.target.value)} />
              </label>
              <label className="check">
                <input type="checkbox" checked={guardianAgreed} onChange={(e) => setGuardianAgreed(e.target.checked)} />
                My parent or guardian has read the privacy notice and agrees.
              </label>
              <button type="button" className="button ghost small" onClick={saveGuardian}>
                Record guardian consent
              </button>
            </div>
          ) : (
            <>
              <p className="muted small">
                Some scholarships are only for these groups. Answer only if you want to be matched to them; you can
                withdraw consent later and your answer is deleted.
              </p>
              {askedSensitive.map((q) => {
                const consented = hasConsent(`sensitive:${q.field}`);
                return (
                  <div key={q.field} className="sensitive-q">
                    <p className="label">{q.question}</p>
                    {!consented && (
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={Boolean(sensitiveConsentDraft[q.field])}
                          onChange={(e) => setSensitiveConsentDraft((d) => ({ ...d, [q.field]: e.target.checked }))}
                        />
                        I agree to share this answer for scholarship matching.
                      </label>
                    )}
                    {(consented || sensitiveConsentDraft[q.field]) && (
                      <YesNo
                        name={q.field}
                        value={sensitive[q.field] ?? ''}
                        onChange={(v) => setSensitive((s) => ({ ...s, [q.field]: v }))}
                      />
                    )}
                    {consented && <p className="muted small">Shared. You can withdraw this on the Privacy page.</p>}
                  </div>
                );
              })}
            </>
          )}
        </fieldset>

        {problems.length > 0 && (
          <div className="flags" role="alert">
            <ul>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="save-bar">
          <button className="button" type="submit" disabled={saving}>
            {saving ? 'Saving…' : hasProfile ? 'Save changes' : 'Save and see my matches'}
          </button>
          {message && (
            <span className={message.startsWith('Saved') || message.startsWith('Guardian') ? 'muted' : 'error'} role="status">
              {message} {message.startsWith('Saved') && <Link to="/matches">See my matches</Link>}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
