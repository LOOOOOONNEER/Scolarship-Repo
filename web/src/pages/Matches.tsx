import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { requireClient } from '../lib/supabase';
import type { MatchResult, MatchRow } from '../lib/types';
import { matchLabel, matchTone } from '../lib/labels';
import { Badge } from '../components/Badge';
import { OfferingCard } from '../components/OfferingCard';
import { OFFERING_FIELDS } from './Browse';

const ORDER: MatchResult[] = ['eligible', 'needs_verification', 'missing_information', 'not_eligible'];
const OUTCOME_ICON = { pass: '✓', fail: '✕', missing: '?', verify: '!' } as const;

export function Matches() {
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = requireClient();
    client
      .from('profiles')
      .select('user_id', { count: 'exact', head: true })
      .then(({ count }) => setHasProfile((count ?? 0) > 0));
    client
      .from('matches')
      .select(`offering_id, result, reasons, saved, dismissed, computed_at, offerings(${OFFERING_FIELDS})`)
      .eq('dismissed', false)
      .then(({ data, error: err }) => {
        if (err) setError('Could not load your matches. Please try again.');
        else setRows((data ?? []) as unknown as MatchRow[]);
      });
  }, []);

  const toggleSave = async (row: MatchRow) => {
    const { error: err } = await requireClient()
      .from('matches')
      .update({ saved: !row.saved })
      .eq('offering_id', row.offering_id);
    if (!err) {
      setRows((prev) => prev?.map((r) => (r.offering_id === row.offering_id ? { ...r, saved: !r.saved } : r)) ?? null);
    }
  };

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

  const sorted = [...(rows ?? [])].sort((a, b) => ORDER.indexOf(a.result) - ORDER.indexOf(b.result));

  return (
    <section>
      <h1>My matches</h1>
      <p className="muted">
        "Appears to meet the requirements" means your answers match what the provider published. The provider
        makes the final decision.
      </p>
      {error && <p className="error">{error}</p>}
      {!rows && !error && <p className="muted">Loading…</p>}
      {rows && rows.length === 0 && (
        <div className="empty">
          <p>No verified scholarships to compare yet.</p>
          <p className="muted">We'll notify you when a new one is checked and published.</p>
        </div>
      )}
      <div className="stack">
        {sorted.map((m) =>
          m.offerings ? (
            <OfferingCard key={m.offering_id} offering={m.offerings}>
              <div className="match">
                <Badge tone={matchTone[m.result]}>{matchLabel[m.result]}</Badge>
                <ul className="reasons">
                  {m.reasons.map((r, i) => (
                    <li key={r.rule_id ?? i} className={`reason reason-${r.outcome}`}>
                      <span aria-hidden="true">{OUTCOME_ICON[r.outcome]}</span>
                      <span>
                        {r.text}
                        {r.detail && <span className="muted"> — {r.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                <button type="button" className="link-button" onClick={() => toggleSave(m)}>
                  {m.saved ? 'Saved ✓' : 'Save'}
                </button>
              </div>
            </OfferingCard>
          ) : null,
        )}
      </div>
    </section>
  );
}
