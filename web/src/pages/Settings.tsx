import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { requireClient } from '../lib/supabase';

export function Settings() {
  const { signOut } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
