export type ApplicationStatus =
  | 'open_verified'
  | 'open_unconfirmed'
  | 'upcoming'
  | 'closed'
  | 'suspended'
  | 'unknown';

export type MatchResult = 'eligible' | 'needs_verification' | 'missing_information' | 'not_eligible';

export interface OfferingSummary {
  id: string;
  academic_year: string;
  application_status: ApplicationStatus;
  opens_on: string | null;
  closes_on: string | null;
  rolling_admission: boolean;
  status_verified_at: string | null;
  status_source_url: string | null;
  apply_url: string | null;
  benefits: string | null;
  scholarship_programs: {
    name: string;
    providers: { name: string } | null;
  } | null;
}

export interface MatchReason {
  rule_id?: string;
  outcome: 'pass' | 'fail' | 'missing' | 'verify';
  text: string;
  detail?: string;
}

export interface MatchRow {
  offering_id: string;
  result: MatchResult;
  reasons: MatchReason[];
  saved: boolean;
  dismissed: boolean;
  computed_at: string;
  offerings: OfferingSummary | null;
}

export interface JobRun {
  id: string;
  job_name: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'succeeded' | 'failed';
  pages_fetched: number;
  llm_calls: number;
  errors: number;
  error_summary: string | null;
}

export interface SourceHealth {
  id: string;
  url: string;
  tier: number;
  last_success_at: string | null;
  consecutive_failures: number;
  is_stale: boolean;
  is_failing: boolean;
}
