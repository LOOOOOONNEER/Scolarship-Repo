import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { requireClient } from '../lib/supabase';
import type { MatchResult, MatchRow } from '../lib/types';
import { matchLabel, matchTone } from '../lib/labels';
import { SECTION_FOR_FIELD } from '../lib/questionnaire';
import { Badge } from '../components/Badge';
import { OfferingCard } from '../components/OfferingCard';
import { OFFERING_FIELDS } from './Browse';

const GROUPS: { result: MatchResult; title: string; intro: string }[] = [
  { result: 'eligible', title: 'You appear to meet the requirements', intro: 'Your answers match everything the provider published.' },
  {
    result: 'missing_information',
    title: 'Answer a question to check',
    intro: 'These depend on a question you have not answered yet.',
  },
  {
    result: 'needs_verification',
    title: 'Needs verification',
    intro: 'Something here cannot be checked automatically. Read the reason, then confirm with the provider.',
  },
  { result: 'not_eligible', title: 'Requirements you do not meet', intro: 'Based on your current answers.' },
];

const OUTCOME_ICON = { pass: '✓', fail: '✕', missing: '?', verify: '!' } as const;
const STATUS_ORDER = ['open_verified', 'open_unconfirmed', 'upcoming', 'unknown', 'closed', 'suspended'];
const INACTIVE = new Set(['closed', 'suspended']);

function sortKey(m: MatchRow): [number, string] {
  const o = m.offerings;
  return [STATUS_ORDER.indexOf(o?.application_status ?? 'unknown'), o?.closes_on ?? '9999-12-31'];
}

export function Matches() {
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [ruleFields, setRuleFields] = useState<Record<string, string>>({});
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNotEligible, setShowNotEligible] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    const client = requireClient();
    client
      .from('profiles')
      .select('user_id', { count: 'exact', head: true })
      .then(({ count }) => setHasProfile((count ?? 0) > 0));
    client
      .from('matches')
      .select(`offering_id, result, reasons, saved, dismissed, computed_at, offerings(${OFFERING_FIELDS})`)
      .then(async ({ data, error: err }) => {
        if (err) {
          setError('Could not load your matches. Please try again.');
          return;
        }
        const list = (data ?? []) as unknown as MatchRow[];
        setRows(list);
        // Look up which question each "missing" reason needs, to link to it.
        const ids = [...new Set(list.flatMap((m) => m.reasons.filter((r) => r.outcome === 'missing' && r.rule_id).map((r) => r.rule_id!)))];
        if (ids.length) {
          const { data: rules } = await client.from('eligibility_rules').select('id, field').in('id', ids);
          setRuleFields(Object.fromEntries(((rules ?? []) as { id: string; field: string }[]).map((r) => [r.id, r.field])));
        }
      });
  }, []);

  const update = async (row: MatchRow, patch: Partial<Pick<MatchRow, 'saved' | 'dismissed'>>) => {
    const { error: err } = await requireClient().from('matches').update(patch).eq('offering_id', row.offering_id);
    if (!err) setRows((prev) => prev?.map((r) => (r.offering_id === row.offering_id ? { ...r, ...patch } : r)) ?? null);
  };

  const visible = useMemo(
    () => (rows ?? []).filter((m) => m.offerings && !INACTIVE.has(m.offerings.application_status) && (showHidden || !m.dismissed)),
    [rows, showHidden],
  );
  const hiddenCount = (rows ?? []).filter((m) => m.dismissed).length;

  // Distinct unanswered questions, with how many scholarships each would let us check.
  const missingQuestions = useMemo(() => {
    const counts = new Map<string, { text: string; field: string; count: number }>();
    for (const m of visible) {
      if (m.result !== 'missing_information') continue;
      for (const r of m.reasons) {
        if (r.outcome !== 'missing' || !r.rule_id) continue;
        const field = ruleFields[r.rule_id];
        if (!field) continue;
        const entry = counts.get(field) ?? { text: r.detail ?? r.text, field, count: 0 };
        entry.count += 1;
        counts.set(field, entry);
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [visible, ruleFields]);

  if (hasProfile === false) {
    return (
      <section className="narrow">
        <h1>My matches</h1>
        <div className="empty">
          <p>Answer a few questions to see scholarships you appear to qualify for.</p>
          <Link className="button" to="/profile">
            Start the questionnaire
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h1>My matches</h1>
      <p className="muted">
        "You appear to meet the requirements" means your answers match what the provider published. The provider makes
        the final decision. <Link to="/profile">Update your answers</Link>
      </p>
      {error && <p className="error">{error}</p>}
      {!rows && !error && <p className="muted">Loading…</p>}
      {rows && visible.length === 0 && (
        <div className="empty">
          <p>No open scholarships to compare yet.</p>
          <p className="muted">We'll notify you when a new one is checked and published.</p>
        </div>
      )}

      {missingQuestions.length > 0 && (
        <div className="notice">
          <p>
            <strong>Answer these to check more scholarships:</strong>
          </p>
          <ul className="plain">
            {missingQuestions.map((q) => (
              <li key={q.field}>
                <Link to={`/profile#${SECTION_FOR_FIELD[q.field] ?? 'education'}`}>{q.text}</Link>{' '}
                <span className="muted small">
                  ({q.count} scholarship{q.count === 1 ? '' : 's'})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {GROUPS.map((g) => {
        const items = visible.filter((m) => m.result === g.result).sort((a, b) => {
          const [sa, da] = sortKey(a);
          const [sb, db] = sortKey(b);
          return sa - sb || da.localeCompare(db);
        });
        if (!items.length) return null;
        const collapsed = g.result === 'not_eligible' && !showNotEligible;
        return (
          <div key={g.result} className="match-group">
            <h2>
              {g.title} <span className="muted">({items.length})</span>
            </h2>
            <p className="muted small">{g.intro}</p>
            {collapsed ? (
              <button type="button" className="link-button" onClick={() => setShowNotEligible(true)}>
                Show them
              </button>
            ) : (
              <div className="stack">
                {items.map((m) => (
                  <OfferingCard key={m.offering_id} offering={m.offerings!}>
                    <div className="match">
                      <Badge tone={matchTone[m.result]}>{matchLabel[m.result]}</Badge>
                      <ul className="reasons">
                        {m.reasons.map((r, i) => (
                          <li key={r.rule_id ?? i} className={`reason reason-${r.outcome}`}>
                            <span aria-hidden="true">{OUTCOME_ICON[r.outcome]}</span>
                            <span>
                              {r.text}
                              {r.detail && <span className="muted"> — {r.detail}</span>}
                              {r.outcome === 'missing' && r.rule_id && ruleFields[r.rule_id] && (
                                <>
                                  {' '}
                                  <Link to={`/profile#${SECTION_FOR_FIELD[ruleFields[r.rule_id]] ?? 'education'}`}>Answer</Link>
                                </>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div className="row">
                        <button type="button" className="link-button" onClick={() => update(m, { saved: !m.saved })}>
                          {m.saved ? 'Saved ✓' : 'Save'}
                        </button>
                        <button type="button" className="link-button" onClick={() => update(m, { dismissed: !m.dismissed })}>
                          {m.dismissed ? 'Show again' : 'Hide'}
                        </button>
                      </div>
                    </div>
                  </OfferingCard>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {hiddenCount > 0 && (
        <p>
          <button type="button" className="link-button" onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? 'Hide the ones I hid' : `Show ${hiddenCount} hidden`}
          </button>
        </p>
      )}
    </section>
  );
}
