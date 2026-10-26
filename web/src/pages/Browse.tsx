import { useEffect, useState } from 'react';
import { requireClient } from '../lib/supabase';
import type { OfferingSummary } from '../lib/types';
import { OfferingCard } from '../components/OfferingCard';

export const OFFERING_FIELDS =
  'id, academic_year, application_status, opens_on, closes_on, rolling_admission, status_verified_at, ' +
  'status_source_url, apply_url, benefits, scholarship_programs(name, providers(name))';

export function Browse() {
  const [rows, setRows] = useState<OfferingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    requireClient()
      .from('offerings')
      .select(OFFERING_FIELDS)
      .eq('publish_state', 'published')
      .in('application_status', ['open_verified', 'open_unconfirmed', 'upcoming'])
      .order('closes_on', { ascending: true, nullsFirst: false })
      .then(({ data, error: err }) => {
        if (err) setError('Could not load scholarships. Please try again.');
        else setRows((data ?? []) as unknown as OfferingSummary[]);
      });
  }, []);

  return (
    <section>
      <h1>Open and upcoming scholarships</h1>
      <p className="muted">
        Only listings reviewed against an official source appear here. Sign in to see which ones you appear to
        qualify for.
      </p>
      {error && <p className="error">{error}</p>}
      {!rows && !error && <p className="muted">Loading…</p>}
      {rows && rows.length === 0 && (
        <div className="empty">
          <p>No verified listings yet.</p>
          <p className="muted">New scholarships appear here after they are checked against the provider's page.</p>
        </div>
      )}
      <div className="stack">
        {rows?.map((o) => <OfferingCard key={o.id} offering={o} />)}
      </div>
    </section>
  );
}
