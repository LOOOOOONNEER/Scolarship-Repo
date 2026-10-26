import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { requireClient } from '../../lib/supabase';
import { formatDate } from '../../lib/labels';
import { AdminNav } from '../../components/AdminNav';
import { Badge } from '../../components/Badge';

interface Task {
  id: string;
  kind: string;
  ref_table: string;
  ref_id: string;
  summary: string;
  created_at: string;
}

interface Submission {
  id: string;
  url: string | null;
  note: string | null;
}

const KIND_LABEL: Record<string, [string, 'good' | 'warn' | 'neutral' | 'bad']> = {
  new_offering: ['New offering', 'good'],
  offering_change: ['Changed details', 'warn'],
  duplicate: ['Possible duplicate', 'warn'],
  submission: ['Student submission', 'neutral'],
  error_report: ['Error report', 'bad'],
  source_suggestion: ['Source suggestion', 'neutral'],
};

export function ReviewQueue() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [submissions, setSubmissions] = useState<Record<string, Submission>>({});
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const client = requireClient();
    const { data, error: err } = await client
      .from('review_tasks')
      .select('id, kind, ref_table, ref_id, summary, created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: true })
      .limit(200);
    if (err) {
      setError('Could not load the review queue.');
      return;
    }
    const rows = (data ?? []) as Task[];
    setTasks(rows);
    const subIds = rows.filter((t) => t.ref_table === 'submissions').map((t) => t.ref_id);
    if (subIds.length) {
      const { data: subs } = await client.from('submissions').select('id, url, note').in('id', subIds);
      setSubmissions(Object.fromEntries(((subs ?? []) as Submission[]).map((s) => [s.id, s])));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const closeTask = async (task: Task, status: 'resolved' | 'dismissed') => {
    const { error: err } = await requireClient()
      .from('review_tasks')
      .update({ status, resolved_at: new Date().toISOString(), resolution: status === 'resolved' ? 'handled manually' : 'dismissed' })
      .eq('id', task.id);
    if (err) setError('Could not update the task.');
    else setTasks((prev) => prev?.filter((t) => t.id !== task.id) ?? null);
  };

  return (
    <section>
      <AdminNav />
      <h1>Review queue</h1>
      <p className="muted">
        Nothing the discovery engine finds reaches students until it is approved here. Oldest first.
      </p>
      {error && <p className="error">{error}</p>}
      {!tasks && !error && <p className="muted">Loading…</p>}
      {tasks && tasks.length === 0 && (
        <div className="empty">
          <p>The queue is empty.</p>
          <p className="muted">New items appear after each daily discovery run.</p>
        </div>
      )}
      <div className="stack">
        {tasks?.map((t) => {
          const [label, tone] = KIND_LABEL[t.kind] ?? [t.kind, 'neutral'];
          const sub = t.ref_table === 'submissions' ? submissions[t.ref_id] : undefined;
          return (
            <article key={t.id} className="card">
              <div className="card-head">
                <div>
                  <Badge tone={tone}>{label}</Badge>
                  <p className="task-summary">{t.summary}</p>
                  <p className="muted small">Queued {formatDate(t.created_at)}</p>
                </div>
              </div>
              {sub && (
                <p className="small">
                  {sub.url && (
                    <a href={sub.url} target="_blank" rel="noopener noreferrer">
                      {sub.url}
                    </a>
                  )}
                  {sub.note && <span className="muted"> — “{sub.note}”</span>}
                </p>
              )}
              <div className="card-foot">
                {t.ref_table === 'extracted_candidates' ? (
                  <Link className="button small" to={`/admin/review/${t.ref_id}`}>
                    Review
                  </Link>
                ) : (
                  <>
                    <button type="button" className="button small" onClick={() => closeTask(t, 'resolved')}>
                      Mark handled
                    </button>
                    <button type="button" className="link-button" onClick={() => closeTask(t, 'dismissed')}>
                      Dismiss
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
