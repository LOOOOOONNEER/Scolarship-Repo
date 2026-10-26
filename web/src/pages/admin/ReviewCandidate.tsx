import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { requireClient } from '../../lib/supabase';
import { formatDate } from '../../lib/labels';
import type { ApplicationStatus } from '../../lib/types';
import {
  OPERATORS,
  PROVIDER_KINDS,
  RULE_FIELDS,
  STATUS_OPTIONS,
  fieldType,
  isHttpUrl,
  newRule,
  ruleToPayload,
  type RuleDraft,
  type RuleKind,
} from '../../lib/admin';
import { AdminNav } from '../../components/AdminNav';
import { Badge } from '../../components/Badge';

interface Evidence {
  id: string;
  field_name: string;
  extracted_value: string | null;
  evidence_text: string | null;
  validation_result: 'pass' | 'warn' | 'fail';
  validation_notes: string | null;
}

interface SuggestedRule {
  field: string;
  operator: string;
  value?: number;
  province?: string;
  grade_scale?: string;
  description: string;
  note?: string;
}

interface Normalized {
  program_name?: string;
  provider_name?: string;
  academic_year?: string;
  opens_on?: string;
  closes_on?: string;
  rolling_admission?: boolean;
  benefits?: string;
  apply_url?: string;
  status_text?: string;
  eligibility?: { text: string; kind: 'criterion' | 'also_required'; evidence?: string }[];
  required_documents?: string[];
}

interface Candidate {
  id: string;
  status: string;
  confidence: number | null;
  suggested_status: ApplicationStatus | null;
  summary: string | null;
  validation_flags: string[];
  payload: {
    normalized?: Normalized;
    suggested_rules?: SuggestedRule[];
    similar_programs?: { program_id: string; program_name: string; provider_name: string; similarity: number }[];
    changes?: string[];
    existing_offering_id?: string;
  };
  raw_documents: { url: string; retrieved_at: string; text_content: string | null } | null;
}

interface Option {
  id: string;
  name: string;
}

const RESULT_TONE = { pass: 'good', warn: 'warn', fail: 'bad' } as const;

function initialRules(c: Candidate, provinces: Option[]): RuleDraft[] {
  const suggested = c.payload.suggested_rules ?? [];
  const rules: RuleDraft[] = suggested.map((s) => {
    const province = s.province ? provinces.find((p) => p.name === s.province) : undefined;
    return newRule({
      field: s.field,
      operator: s.operator,
      value: province ? province.id : s.value !== undefined ? String(s.value) : '',
      grade_scale: s.grade_scale ?? '',
      description: s.description,
      note: s.note,
    });
  });
  const covered = new Set(suggested.map((s) => s.description));
  for (const item of c.payload.normalized?.eligibility ?? []) {
    if (covered.has(item.text)) continue;
    const kind: RuleKind = item.kind === 'also_required' ? 'also_required' : 'unstructured';
    rules.push(
      newRule({
        kind,
        description: item.text,
        note: kind === 'unstructured' ? 'Not structured yet: students will see "needs verification" unless you set a condition.' : undefined,
      }),
    );
  }
  return rules;
}

export function ReviewCandidate() {
  const { candidateId } = useParams();
  const navigate = useNavigate();
  const [cand, setCand] = useState<Candidate | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [providers, setProviders] = useState<Option[]>([]);
  const [provinces, setProvinces] = useState<Option[]>([]);
  const [scales, setScales] = useState<{ code: string; label: string }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // form state
  const [providerId, setProviderId] = useState('new');
  const [providerName, setProviderName] = useState('');
  const [providerKind, setProviderKind] = useState('lgu');
  const [providerDomains, setProviderDomains] = useState('');
  const [programName, setProgramName] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [opensOn, setOpensOn] = useState('');
  const [closesOn, setClosesOn] = useState('');
  const [rolling, setRolling] = useState(false);
  const [status, setStatus] = useState<ApplicationStatus>('unknown');
  const [statusUrl, setStatusUrl] = useState('');
  const [benefits, setBenefits] = useState('');
  const [applyUrl, setApplyUrl] = useState('');
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [verified, setVerified] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showSource, setShowSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const client = requireClient();
    (async () => {
      const [c, ev, pv, loc, gs] = await Promise.all([
        client
          .from('extracted_candidates')
          .select('id, status, confidence, suggested_status, summary, validation_flags, payload, raw_documents(url, retrieved_at, text_content)')
          .eq('id', candidateId)
          .single(),
        client
          .from('field_evidence')
          .select('id, field_name, extracted_value, evidence_text, validation_result, validation_notes')
          .eq('candidate_id', candidateId),
        client.from('providers').select('id, name').order('name'),
        client.from('localities').select('id, name').eq('kind', 'province').order('name'),
        client.from('grade_scales').select('code, label'),
      ]);
      if (c.error || !c.data) {
        setLoadError('This candidate could not be loaded.');
        return;
      }
      const candidate = c.data as unknown as Candidate;
      const provinceOpts = ((loc.data ?? []) as { id: number; name: string }[]).map((p) => ({ id: String(p.id), name: p.name }));
      setCand(candidate);
      setEvidence((ev.data ?? []) as Evidence[]);
      setProviders(((pv.data ?? []) as Option[]));
      setProvinces(provinceOpts);
      setScales((gs.data ?? []) as { code: string; label: string }[]);

      const n = candidate.payload.normalized ?? {};
      setProgramName(n.program_name ?? '');
      setProviderName(n.provider_name ?? '');
      setAcademicYear(n.academic_year ?? '');
      setOpensOn(n.opens_on ?? '');
      setClosesOn(n.closes_on ?? '');
      setRolling(Boolean(n.rolling_admission));
      setBenefits(n.benefits ?? '');
      setApplyUrl(n.apply_url ?? '');
      setStatus(candidate.suggested_status ?? 'unknown');
      setStatusUrl(candidate.raw_documents?.url ?? '');
      setRules(initialRules(candidate, provinceOpts));
      const match = ((pv.data ?? []) as Option[]).find((p) => p.name.toLowerCase() === (n.provider_name ?? '').toLowerCase());
      if (match) setProviderId(match.id);
      try {
        const host = new URL(candidate.raw_documents?.url ?? '').hostname;
        setProviderDomains(host.replace(/^www\./, ''));
      } catch {
        /* no source url */
      }
    })();
  }, [candidateId]);

  const failing = useMemo(() => evidence.filter((e) => e.validation_result === 'fail'), [evidence]);
  const decided = cand && !['pending', 'needs_review'].includes(cand.status);

  const updateRule = (key: string, patch: Partial<RuleDraft>) =>
    setRules((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const buildPayload = (publish: boolean): Record<string, unknown> | string => {
    if (!programName.trim()) return 'Enter the program name.';
    if (!/^\d{4}-\d{4}$/.test(academicYear) || Number(academicYear.slice(5)) !== Number(academicYear.slice(0, 4)) + 1) {
      return 'Academic year must look like 2026-2027.';
    }
    if (providerId === 'new' && !providerName.trim()) return 'Choose the provider or enter a new one.';
    if (opensOn && closesOn && opensOn > closesOn) return 'The opening date is after the closing date.';
    if (rolling && closesOn) return 'A rolling-admission program has no closing date. Clear one of them.';
    if (applyUrl && !isHttpUrl(applyUrl)) return 'The application link must start with http:// or https://.';
    if (statusUrl && !isHttpUrl(statusUrl)) return 'The status source must be a web address.';

    const ruleRows: Record<string, unknown>[] = [];
    for (const r of rules) {
      const res = ruleToPayload(r);
      if (!res.ok) return res.error;
      ruleRows.push(res.rule);
    }

    if (publish) {
      if (!verified) return 'Before publishing, open the official page and tick the confirmation box.';
      if (!applyUrl) return 'Publishing needs the official application link.';
      if (!closesOn && !rolling) return 'Publishing needs a closing date, or rolling admission.';
      if (status === 'unknown') return 'Publishing needs an application status.';
      if (!statusUrl) return 'Publishing needs the page where you confirmed the status.';
    }

    return {
      ...(providerId === 'new'
        ? {
            provider: {
              name: providerName.trim(),
              kind: providerKind,
              official_domains: providerDomains
                .split(',')
                .map((d) => d.trim().toLowerCase())
                .filter(Boolean),
            },
          }
        : { provider_id: providerId }),
      program_name: programName.trim(),
      academic_year: academicYear,
      opens_on: opensOn || null,
      closes_on: rolling ? null : closesOn || null,
      rolling_admission: rolling,
      application_status: status,
      status_source_url: statusUrl || null,
      status_verified: verified,
      benefits: benefits.trim() || null,
      apply_url: applyUrl.trim() || null,
      rules: ruleRows,
      publish,
    };
  };

  const approve = async (publish: boolean) => {
    setFormError(null);
    const payload = buildPayload(publish);
    if (typeof payload === 'string') {
      setFormError(payload);
      return;
    }
    setBusy(true);
    const { error } = await requireClient().rpc('approve_candidate', { p_candidate: candidateId, p_data: payload });
    setBusy(false);
    if (error) {
      setFormError(`The database refused this: ${error.message}`);
      return;
    }
    navigate('/admin/review');
  };

  const reject = async (e: FormEvent) => {
    e.preventDefault();
    if (!rejectReason.trim()) {
      setFormError('Give a short reason for rejecting.');
      return;
    }
    setBusy(true);
    const { error } = await requireClient().rpc('reject_candidate', { p_candidate: candidateId, p_reason: rejectReason.trim() });
    setBusy(false);
    if (error) setFormError(`Could not reject: ${error.message}`);
    else navigate('/admin/review');
  };

  if (loadError) {
    return (
      <section>
        <AdminNav />
        <p className="error">{loadError}</p>
        <Link to="/admin/review">Back to the queue</Link>
      </section>
    );
  }
  if (!cand) return <p className="muted">Loading…</p>;

  const doc = cand.raw_documents;

  return (
    <section className="review">
      <AdminNav />
      <p className="small">
        <Link to="/admin/review">← Review queue</Link>
      </p>
      <h1>{cand.summary ?? 'Candidate'}</h1>
      <p className="muted small">
        Confidence {cand.confidence !== null ? Math.round(cand.confidence * 100) : '–'}% ·{' '}
        {doc && (
          <>
            found on{' '}
            <a href={doc.url} target="_blank" rel="noopener noreferrer">
              {doc.url}
            </a>{' '}
            · read {formatDate(doc.retrieved_at)}
          </>
        )}
      </p>
      {decided && <p className="notice">This candidate was already {cand.status}.</p>}

      {(cand.validation_flags?.length ?? 0) > 0 && (
        <div className="flags" role="note">
          <strong>Check before approving</strong>
          <ul>
            {cand.validation_flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {cand.payload.changes && (
        <div className="flags" role="note">
          <strong>Differs from the published record</strong>
          <ul>
            {cand.payload.changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {(cand.payload.similar_programs?.length ?? 0) > 0 && (
        <p className="small">
          <strong>Similar existing programs:</strong>{' '}
          {cand.payload.similar_programs!.map((s) => `${s.program_name} (${s.provider_name}, ${Math.round(s.similarity * 100)}%)`).join('; ')}
        </p>
      )}

      <h2>What was extracted, and the source text behind it</h2>
      {failing.length > 0 && (
        <p className="small error">
          {failing.length} value(s) failed checks and were left out of the form below. Read the source before adding them back.
        </p>
      )}
      <div className="table-wrap">
        <table className="evidence">
          <thead>
            <tr>
              <th>Field</th>
              <th>Extracted</th>
              <th>Source text</th>
              <th>Check</th>
            </tr>
          </thead>
          <tbody>
            {evidence.map((e) => (
              <tr key={e.id}>
                <td>{e.field_name}</td>
                <td>{e.extracted_value}</td>
                <td className="quote">{e.evidence_text ? `“${e.evidence_text}”` : <span className="muted">none</span>}</td>
                <td>
                  <Badge tone={RESULT_TONE[e.validation_result]}>{e.validation_result}</Badge>
                  {e.validation_notes && <div className="muted small">{e.validation_notes}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {doc?.text_content && (
        <p>
          <button type="button" className="link-button" onClick={() => setShowSource((s) => !s)}>
            {showSource ? 'Hide' : 'Show'} the full source text
          </button>
        </p>
      )}
      {showSource && doc?.text_content && <pre className="source-text">{doc.text_content}</pre>}

      {!decided && (
        <>
          <h2>Record to publish</h2>
          <div className="form-grid">
            <label>
              Provider
              <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
                <option value="new">New provider…</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {providerId === 'new' && (
              <>
                <label>
                  New provider name
                  <input value={providerName} onChange={(e) => setProviderName(e.target.value)} />
                </label>
                <label>
                  Provider type
                  <select value={providerKind} onChange={(e) => setProviderKind(e.target.value)}>
                    {PROVIDER_KINDS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Official domains (comma-separated)
                  <input value={providerDomains} onChange={(e) => setProviderDomains(e.target.value)} placeholder="example.gov.ph" />
                </label>
              </>
            )}
            <label>
              Program name
              <input value={programName} onChange={(e) => setProgramName(e.target.value)} />
            </label>
            <label>
              Academic year
              <input value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} placeholder="2026-2027" />
            </label>
            <label>
              Applications open
              <input type="date" value={opensOn} onChange={(e) => setOpensOn(e.target.value)} />
            </label>
            <label>
              Applications close
              <input type="date" value={closesOn} onChange={(e) => setClosesOn(e.target.value)} disabled={rolling} />
            </label>
            <label className="check">
              <input type="checkbox" checked={rolling} onChange={(e) => setRolling(e.target.checked)} />
              Rolling admission (no fixed deadline)
            </label>
            <label>
              Application status
              <select value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus)}>
                {STATUS_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide">
              Page where the status is confirmed
              <input value={statusUrl} onChange={(e) => setStatusUrl(e.target.value)} />
            </label>
            <label className="wide">
              Official application link
              <input value={applyUrl} onChange={(e) => setApplyUrl(e.target.value)} />
            </label>
            <label className="wide">
              Benefits
              <input value={benefits} onChange={(e) => setBenefits(e.target.value)} />
            </label>
          </div>

          <h2>Eligibility rules</h2>
          <p className="muted small">
            Matching only uses rules with a condition. "Not checkable" rules show students "needs verification";
            "also required" items (essays, interviews) are shown but never checked.
          </p>
          <div className="stack">
            {rules.map((r) => {
              const type = fieldType(r.field);
              return (
                <div key={r.key} className="rule">
                  <div className="rule-row">
                    <select value={r.kind} onChange={(e) => updateRule(r.key, { kind: e.target.value as RuleKind })} aria-label="Rule type">
                      <option value="criterion">Checkable condition</option>
                      <option value="unstructured">Not checkable</option>
                      <option value="also_required">Also required</option>
                    </select>
                    <input
                      className="grow"
                      value={r.description}
                      onChange={(e) => updateRule(r.key, { description: e.target.value })}
                      aria-label="Wording shown to students"
                      placeholder="Wording shown to students"
                    />
                    <button type="button" className="link-button" onClick={() => setRules((prev) => prev.filter((x) => x.key !== r.key))}>
                      Remove
                    </button>
                  </div>
                  {r.kind === 'criterion' && (
                    <div className="rule-row">
                      <select
                        value={r.field}
                        onChange={(e) => updateRule(r.key, { field: e.target.value, operator: '', value: '', values: [] })}
                        aria-label="What it checks"
                      >
                        <option value="">What it checks…</option>
                        {RULE_FIELDS.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      {type && (
                        <select value={r.operator} onChange={(e) => updateRule(r.key, { operator: e.target.value })} aria-label="Condition">
                          <option value="">Condition…</option>
                          {OPERATORS[type].map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      )}
                      {type === 'province' && r.operator === 'eq' && (
                        <select value={r.value} onChange={(e) => updateRule(r.key, { value: e.target.value })} aria-label="Province">
                          <option value="">Province…</option>
                          {provinces.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {(type === 'province' || type === 'enum') && r.operator === 'in' && (
                        <select
                          multiple
                          value={r.values}
                          onChange={(e) => updateRule(r.key, { values: Array.from(e.target.selectedOptions as HTMLCollectionOf<HTMLOptionElement>).map((o) => o.value) })}
                          aria-label="Options"
                        >
                          {(type === 'province'
                            ? provinces.map((p) => [p.id, p.name] as [string, string])
                            : RULE_FIELDS.find((f) => f.value === r.field)?.options ?? []
                          ).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      )}
                      {type === 'enum' && r.operator === 'eq' && (
                        <select value={r.value} onChange={(e) => updateRule(r.key, { value: e.target.value })} aria-label="Option">
                          <option value="">Option…</option>
                          {(RULE_FIELDS.find((f) => f.value === r.field)?.options ?? []).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      )}
                      {(type === 'number' || type === 'income' || type === 'grade' || type === 'text') && (
                        <input
                          className="short"
                          value={r.value}
                          inputMode={type === 'text' ? 'text' : 'decimal'}
                          onChange={(e) => updateRule(r.key, { value: e.target.value })}
                          aria-label="Value"
                        />
                      )}
                      {type === 'grade' && (
                        <select value={r.grade_scale} onChange={(e) => updateRule(r.key, { grade_scale: e.target.value })} aria-label="Grading scale">
                          <option value="">Grading scale…</option>
                          {scales.map((s) => (
                            <option key={s.code} value={s.code}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                  {r.note && <p className="muted small">{r.note}</p>}
                </div>
              );
            })}
          </div>
          <p>
            <button type="button" className="button ghost small" onClick={() => setRules((prev) => [...prev, newRule()])}>
              Add a rule
            </button>
          </p>

          <label className="check confirm">
            <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
            I opened the official page and confirmed the application status, the deadline and the application link.
          </label>

          {formError && <p className="error">{formError}</p>}
          <div className="row">
            <button type="button" className="button" onClick={() => approve(true)} disabled={busy}>
              Approve and publish
            </button>
            <button type="button" className="button ghost" onClick={() => approve(false)} disabled={busy}>
              Save as draft
            </button>
          </div>

          <form className="reject" onSubmit={reject}>
            <label htmlFor="reject-reason">Or reject it</label>
            <div className="row">
              <input
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason, e.g. not a scholarship, past awardees list"
              />
              <button type="submit" className="button danger small" disabled={busy}>
                Reject
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
