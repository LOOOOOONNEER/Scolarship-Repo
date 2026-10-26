# Data protection: draft for review

**Status: draft.** This is a working list of what the system does and what still needs a decision. It is not legal advice and not proof of compliance with the Data Privacy Act of 2012 (RA 10173). Review it with the school's data protection officer before any real student signs up.

## What the database already enforces

| Control | Where |
| --- | --- |
| Students see and change only their own rows | RLS policies, `20261026000600_security.sql` |
| Admins and reviewers cannot read student answers | No policy grants them access to `profiles`, `profile_sensitive`, `consents`, `matches` |
| Discovery worker has no access to student tables | No grants for `discovery_worker`; tested in `supabase/tests/sql/40_worker.sql` |
| Sensitive answers require per-field consent | `private.enforce_sensitive_consent()` |
| Under-18s need recorded guardian consent before sensitive answers | Same trigger; guardian name and contact are required |
| Withdrawing consent deletes the related answers immediately | `private.apply_consent_withdrawal()` |
| Withdrawals are final and server-timestamped | `private.guard_consent_update()` |
| Questionnaire answers require agreeing to the privacy notice first | `private.require_privacy_notice()` |
| Withdrawing the privacy notice deletes the answers and matches | `private.apply_privacy_withdrawal()` |
| Sensitive questions are shown only when a published scholarship uses them | `public.sensitive_questions_in_use()` |
| Data export | `public.export_my_data()` |
| Account deletion | Edge Function `delete-account`; student tables cascade |
| Audit log of admin and worker actions, field names only | `private.audit_row_change()` |
| Logs never contain questionnaire answers | `scripts/check_privacy_boundaries.py` in CI; worker log redaction |

## Decisions still needed

- [ ] Retention periods. Proposed: inactive accounts deleted after 24 months (with a warning email first); notifications, raw source snapshots and job runs kept 12 months (`private.purge_expired()`).
- [ ] Review the draft privacy notice in `web/src/components/PrivacyNotice.tsx` (version label `PRIVACY_NOTICE_VERSION` in `web/src/lib/options.ts`, stored with every consent).
- [ ] How guardian consent is confirmed for under-18 users. Currently the student records the guardian's name and contact and confirms the guardian agrees; nothing contacts the guardian yet.
- [ ] Whether registration with the National Privacy Commission applies at this scale.
- [ ] Who handles data-subject requests, and how quickly.
- [ ] Breach response contact and steps.
