import { useEffect, useState } from 'react';
import { requireClient } from '../lib/supabase';
import type { JobRun, SourceHealth } from '../lib/types';
import { formatDate } from '../lib/labels';
import { Badge } from '../components/Badge';

export function Admin() {
  const [jobs, setJobs] = useState<JobRun[]>([]);
  const [openTasks, setOpenTasks] = useState<number | null>(null);
  const [sources, setSources] = useState<SourceHealth[]>([]);

  useEffect(() => {
    const client = requireClient();
    client
      .from('job_runs')
      .select('id, job_name, started_at, finished_at, status, pages_fetched, llm_calls, errors, error_summary')
      .order('started_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setJobs((data ?? []) as JobRun[]));
    client
      .from('review_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .then(({ count }) => setOpenTasks(count ?? 0));
    client
      .from('source_health')
      .select('id, url, tier, last_success_at, consecutive_failures, is_stale, is_failing')
      .then(({ data }) => setSources((data ?? []) as SourceHealth[]));
  }, []);

  const lastSuccess = jobs.find((j) => j.status === 'succeeded');
  const hoursSince = lastSuccess ? (Date.now() - new Date(lastSuccess.started_at).getTime()) / 36e5 : null;
  const unhealthy = sources.filter((s) => s.is_stale || s.is_failing);

  return (
    <section>
      <h1>Admin</h1>

      <div className="stats">
        <div className="stat">
          <span className="stat-value">{openTasks ?? '–'}</span>
          <span className="muted">open review tasks</span>
        </div>
        <div className="stat">
          <span className="stat-value">{sources.length}</span>
          <span className="muted">sources in the registry</span>
        </div>
        <div className="stat">
          <span className="stat-value">{unhealthy.length}</span>
          <span className="muted">stale or failing sources</span>
        </div>
      </div>

      {(hoursSince === null || hoursSince > 48) && (
        <p className="error">
          No discovery run has succeeded in the last 48 hours. Check the GitHub Actions "Discovery" workflow.
        </p>
      )}

      <h2>Recent job runs</h2>
      {jobs.length === 0 ? (
        <p className="muted">No job runs recorded yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Started</th>
                <th>Status</th>
                <th>Pages</th>
                <th>AI calls</th>
                <th>Errors</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>{j.job_name}</td>
                  <td>{formatDate(j.started_at)}</td>
                  <td>
                    <Badge tone={j.status === 'succeeded' ? 'good' : j.status === 'failed' ? 'bad' : 'neutral'}>
                      {j.status}
                    </Badge>
                  </td>
                  <td>{j.pages_fetched}</td>
                  <td>{j.llm_calls}</td>
                  <td title={j.error_summary ?? undefined}>{j.errors}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Sources needing attention</h2>
      {unhealthy.length === 0 ? (
        <p className="muted">All sources are fresh.</p>
      ) : (
        <ul className="plain">
          {unhealthy.map((s) => (
            <li key={s.id}>
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.url}
              </a>{' '}
              <span className="muted small">
                tier {s.tier} · last success {s.last_success_at ? formatDate(s.last_success_at) : 'never'}
                {s.is_failing ? ` · ${s.consecutive_failures} failures in a row` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
