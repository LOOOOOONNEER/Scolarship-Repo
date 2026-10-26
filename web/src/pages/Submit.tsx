import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { requireClient } from '../lib/supabase';
import { formatDate } from '../lib/labels';

interface SubmissionRow {
  id: string;
  url: string | null;
  note: string | null;
  status: string;
  created_at: string;
}

const STATUS_TEXT: Record<string, string> = {
  new: 'Waiting to be checked',
  processing: 'Being checked',
  processed: 'Checked',
  rejected: 'Not added',
};

function validUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function Submit() {
  const { session } = useAuth();
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<SubmissionRow[]>([]);

  const load = async () => {
    const { data } = await requireClient()
      .from('submissions')
      .select('id, url, note, status, created_at')
      .eq('user_id', session?.user.id ?? '')
      .order('created_at', { ascending: false })
      .limit(20);
    setMine((data ?? []) as SubmissionRow[]);
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validUrl(url)) {
      setError('Paste a full link that starts with https://');
      return;
    }
    setError(null);
    setState('sending');
    const { error: err } = await requireClient()
      .from('submissions')
      .insert({ user_id: session?.user.id, url: url.trim(), note: note.trim() || null });
    if (err) {
      setState('idle');
      setError('That did not save. Please try again.');
      return;
    }
    setState('sent');
    setUrl('');
    setNote('');
    await load();
  };

  return (
    <section className="narrow">
      <h1>Tell us about a scholarship</h1>
      <p className="muted">
        Seen a scholarship announcement we don't list, for example on a town or school Facebook page? Paste the link.
        We check it against the provider's official information before anything is published.
      </p>

      <form onSubmit={submit} className="form">
        <label htmlFor="sub-url">Link to the announcement</label>
        <input id="sub-url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        <label htmlFor="sub-note">Anything we should know? (optional)</label>
        <input id="sub-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="e.g. posted by the mayor's office" />
        {error && <p className="error">{error}</p>}
        {state === 'sent' && <p className="muted">Thank you. We'll check it soon.</p>}
        <button className="button" type="submit" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Send link'}
        </button>
      </form>

      {mine.length > 0 && (
        <>
          <h2>Your links</h2>
          <ul className="plain">
            {mine.map((s) => (
              <li key={s.id}>
                {s.url}
                <span className="muted small">
                  {' '}
                  · {STATUS_TEXT[s.status] ?? s.status} · {formatDate(s.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
