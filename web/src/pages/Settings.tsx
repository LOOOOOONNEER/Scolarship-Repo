import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { requireClient } from '../lib/supabase';
import { formatDate } from '../lib/labels';
import { SENSITIVE_QUESTIONS } from '../lib/options';

interface ConsentRow {
  id: string;
  consent_type: string;
  granted_at: string;
}

function consentLabel(type: string): string {
  if (type === 'privacy_notice') return 'Privacy notice (needed for the questionnaire)';
  if (type === 'guardian') return 'Parent or guardian consent';
  const q = SENSITIVE_QUESTIONS.find((x) => `sensitive:${x.field}` === type);
  return q ? `Sharing: ${q.label}` : type;
}

export function Settings() {
  const { signOut } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [consents, setConsents] = useState<ConsentRow[]>([]);

  const loadConsents = async () => {
    const { data } = await requireClient()
      .from('consents')
      .select('id, consent_type, granted_at')
      .is('withdrawn_at', null)
      .order('granted_at');
    setConsents((data ?? []) as ConsentRow[]);
  };

  useEffect(() => {
    loadConsents();
  }, []);

  const withdraw = async (c: ConsentRow) => {
    if (c.consent_type === 'privacy_notice') {
      const ok = window.confirm('This deletes all your questionnaire answers and matches. Continue?');
      if (!ok) return;
    }
    // The server stamps the time; the database then deletes the related answers.
    const { error } = await requireClient().from('consents').update({ withdrawn_at: new Date().toISOString() }).eq('id', c.id);
    if (error) setMessage('That did not work. Please try again.');
    else {
      setMessage(null);
      await loadConsents();
    }
  };

  const exportData = async () => {
    setExporting(true);
    const { data, error } = await requireClient().rpc('export_my_data');
    setExporting(false);
    if (error) {
      setMessage('Export failed. Please try again.');
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'scholarship-finder-my-data.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteAccount = async () => {
    setDeleting(true);
    const { error } = await requireClient().functions.invoke('delete-account', { method: 'POST' });
    setDeleting(false);
    if (error) {
      setMessage('We could not delete your account. Please try again or contact us.');
      return;
    }
    await signOut();
  };

  return (
    <section className="narrow">
      <h1>Privacy and your data</h1>

      <div className="panel">
        <h2>What you have agreed to</h2>
        {consents.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <ul className="consent-list">
            {consents.map((c) => (
              <li key={c.id}>
                <span>
                  {consentLabel(c.consent_type)}
                  <span className="muted small"> · since {formatDate(c.granted_at)}</span>
                </span>
                <button type="button" className="link-button" onClick={() => withdraw(c)}>
                  Withdraw
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">Withdrawing deletes the related answers straight away.</p>
      </div>

      <div className="panel">
        <h2>Download your data</h2>
        <p className="muted">A copy of your answers, consents, matches and notifications, as a JSON file.</p>
        <button type="button" className="button ghost" onClick={exportData} disabled={exporting}>
          {exporting ? 'Preparing…' : 'Download my data'}
        </button>
      </div>

      <div className="panel">
        <h2>Delete your account</h2>
        <p className="muted">
          This permanently deletes your profile, answers, consents, matches and notifications. It cannot be
          undone.
        </p>
        <label htmlFor="confirm-delete">Type DELETE to confirm</label>
        <input id="confirm-delete" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
        <button
          type="button"
          className="button danger"
          onClick={deleteAccount}
          disabled={confirmText !== 'DELETE' || deleting}
        >
          {deleting ? 'Deleting…' : 'Delete my account'}
        </button>
      </div>

      {message && <p className="error">{message}</p>}
    </section>
  );
}
