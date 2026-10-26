import { useEffect, useState, type FormEvent } from 'react';
import { requireClient } from '../../lib/supabase';
import { formatDate } from '../../lib/labels';
import { isHttpUrl } from '../../lib/admin';
import { AdminNav } from '../../components/AdminNav';
import { Badge } from '../../components/Badge';

interface SourceRow {
  id: string;
  url: string;
  tier: number;
  active: boolean;
  submission_only: boolean;
  last_checked_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
  valid_offerings_found: number;
  is_stale: boolean;
  is_failing: boolean;
}

interface Suggestion {
  id: string;
  url: string;
  domain: string;
  found_via: string;
  created_at: string;
}

const TIERS: [number, string][] = [
  [1, 'Tier 1: national agency, LGU or state/local university (official site)'],
  [2, 'Tier 2: private school, foundation or company (own site)'],
  [3, 'Tier 3: aggregator, news or blog (leads only)'],
  [4, 'Tier 4: Facebook page or posters (submission only)'],
];

export function Sources() {
  const [rows, setRows] = useState<SourceRow[] | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [url, setUrl] = useState('');
  const [tier, setTier] = useState(1);
  const [days, setDays] = useState('7');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  const load = async () => {
    const client = requireClient();
    const [s, sg] = await Promise.all([
      client
        .from('source_health')
        .select('id, url, tier, active, submission_only, last_checked_at, last_success_at, consecutive_failures, valid_offerings_found, is_stale, is_failing')
        .order('tier')
        .order('url'),
      client.from('source_suggestions').select('id, url, domain, found_via, created_at').eq('status', 'pending').order('created_at').limit(50),
    ]);
    setRows((s.data ?? []) as SourceRow[]);
    setSuggestions((sg.data ?? []) as Suggestion[]);
  };

  useEffect(() => {
    load();
  }, []);

  const addSource = async (e: FormEvent, fromUrl?: string, suggestionId?: string) => {
    e.preventDefault();
    setMessage(null);
    const target = (fromUrl ?? url).trim();
    if (!isHttpUrl(target)) {
      setMessage({ kind: 'error', text: 'Enter a full web address starting with https://' });
      return;
    }
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 90) {
      setMessage({ kind: 'error', text: 'Check every 1 to 90 days.' });
      return;
    }
    const client = requireClient();
    const { error } = await client.from('sources').insert({
      url: target,
      tier,
      region_code: 'R3',
      crawl_interval: `${n} days`,
      submission_only: tier === 4,
      notes: notes.trim() || null,
    });
    if (error) {
      setMessage({ kind: 'error', text: error.code === '23505' ? 'That address is already in the registry.' : error.message });
      return;
    }
    if (suggestionId) {
      await client.from('source_suggestions').update({ status: 'approved' }).eq('id', suggestionId);
    }
    setUrl('');
    setNotes('');
    setMessage({ kind: 'ok', text: 'Source added. It will be checked on the next daily run.' });
    load();
  };

  const toggle = async (row: SourceRow) => {
    await requireClient().from('sources').update({ active: !row.active }).eq('id', row.id);
    load();
  };

  const rejectSuggestion = async (s: Suggestion) => {
    await requireClient().from('source_suggestions').update({ status: 'rejected' }).eq('id', s.id);
    setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
  };

  return (
    <section>
      <AdminNav />
      <h1>Source registry</h1>
      <p className="muted">
        Start with 10 to 20 official pages that actually post scholarships. Add only addresses you have opened and checked
        yourself. Facebook pages are tier 4: they are never crawled, only used for student submissions.
      </p>

      <form className="panel" onSubmit={(e) => addSource(e)}>
        <h2>Add a source</h2>
        <label htmlFor="src-url">Page address</label>
        <input id="src-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/scholarships" />
        <label htmlFor="src-tier">Trust tier</label>
        <select id="src-tier" value={tier} onChange={(e) => setTier(Number(e.target.value))}>
          {TIERS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <label htmlFor="src-days">Check every (days)</label>
        <input id="src-days" className="short" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        <label htmlFor="src-notes">Notes (optional)</label>
        <input id="src-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. provincial scholarship office page" />
        <button className="button" type="submit">
          Add source
        </button>
        {message && <p className={message.kind === 'error' ? 'error' : 'muted'}>{message.text}</p>}
      </form>

      <h2>Sources ({rows?.length ?? 0})</h2>
      {rows && rows.length === 0 && <p className="muted">No sources yet. Add the first official page above.</p>}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Page</th>
                <th>Tier</th>
                <th>Last success</th>
                <th>Health</th>
                <th>Found</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.active ? '' : 'inactive'}>
                  <td className="url-cell">
                    <a href={r.url} target="_blank" rel="noopener noreferrer">
                      {r.url}
                    </a>
                  </td>
                  <td>{r.tier}</td>
                  <td>{r.submission_only ? 'not crawled' : r.last_success_at ? formatDate(r.last_success_at) : 'never'}</td>
                  <td>
                    {!r.active ? (
                      <Badge tone="neutral">paused</Badge>
                    ) : r.is_failing ? (
                      <Badge tone="bad">{`failing (${r.consecutive_failures})`}</Badge>
                    ) : r.is_stale ? (
                      <Badge tone="warn">stale</Badge>
                    ) : (
                      <Badge tone="good">ok</Badge>
                    )}
                  </td>
                  <td>{r.valid_offerings_found}</td>
                  <td>
                    <button type="button" className="link-button" onClick={() => toggle(r)}>
                      {r.active ? 'Pause' : 'Resume'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Suggested sources ({suggestions.length})</h2>
      <p className="muted small">Official-looking pages the engine found linked from your sources. Open each one before adding it.</p>
      {suggestions.length === 0 ? (
        <p className="muted">None right now.</p>
      ) : (
        <ul className="plain">
          {suggestions.map((s) => (
            <li key={s.id}>
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.url}
              </a>{' '}
              <span className="muted small">found via {s.found_via}</span>{' '}
              <button type="button" className="link-button" onClick={(e) => addSource(e as unknown as FormEvent, s.url, s.id)}>
                Add (uses the tier above)
              </button>{' '}
              <button type="button" className="link-button" onClick={() => rejectSuggestion(s)}>
                Reject
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
