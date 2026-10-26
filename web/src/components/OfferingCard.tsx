import type { ReactNode } from 'react';
import type { OfferingSummary } from '../lib/types';
import { deadlineText, formatDate, statusLabel, statusTone } from '../lib/labels';
import { Badge } from './Badge';

export function OfferingCard({ offering, children }: { offering: OfferingSummary; children?: ReactNode }) {
  const program = offering.scholarship_programs;
  return (
    <article className="card">
      <div className="card-head">
        <div>
          <h3>{program?.name ?? 'Scholarship'}</h3>
          <p className="muted">
            {program?.providers?.name ?? 'Provider'} · AY {offering.academic_year}
          </p>
        </div>
        <Badge tone={statusTone[offering.application_status]}>{statusLabel[offering.application_status]}</Badge>
      </div>

      <p className="deadline">{deadlineText(offering.closes_on, offering.rolling_admission)}</p>
      {offering.benefits && <p>{offering.benefits}</p>}
      {children}

      <div className="card-foot">
        {offering.apply_url && offering.application_status === 'open_verified' && (
          <a className="button small" href={offering.apply_url} target="_blank" rel="noopener noreferrer">
            Official application page
          </a>
        )}
        {offering.status_source_url && (
          <a href={offering.status_source_url} target="_blank" rel="noopener noreferrer">
            Verify on the official page
          </a>
        )}
        {offering.status_verified_at && (
          <span className="muted small">Status checked {formatDate(offering.status_verified_at)}</span>
        )}
      </div>
    </article>
  );
}
