# Scholarship Finder

An installable web app (PWA) that finds college scholarships in Central Luzon and shows students the ones they appear to qualify for, with the reason for every match.

**Status: Phase 1 (Foundation) of the technical plan.** The database, privacy rules, matching engine, app shell, sign-in, worker skeleton and CI are in place. Discovery jobs (fetching, extraction, validation) come in Phase 2; the questionnaire UI in Phase 3.

## What's in the repo

| Folder | What it is |
| --- | --- |
| `supabase/migrations/` | The whole database: tables, row-level security, the restricted `discovery_worker` role, consent rules, audit and change logs, and the matching engine |
| `supabase/tests/` | 86 access-control and matching checks, run on plain Postgres (no Supabase account needed) |
| `supabase/functions/delete-account/` | Edge Function that lets a student delete their account |
| `web/` | React + Vite + TypeScript PWA (Browse, Sign in, My matches, Privacy, Admin) |
| `worker/` | Python discovery worker for GitHub Actions; currently runs a daily heartbeat |
| `scripts/check_privacy_boundaries.py` | CI check: the worker never touches student tables, and no log line mentions a student answer |
| `.github/workflows/` | CI, the daily Discovery schedule, and a monthly keepalive |

## How the privacy boundary works

- **Students** can read and change only their own rows (row-level security on every table).
- **Admins and reviewers** manage the catalog but **cannot read** profiles, sensitive answers, consents or matches.
- **The discovery worker** connects as `discovery_worker`, a Postgres role with **no grant on any student table**. It can create drafts but cannot publish, and it cannot change a published offering's dates, apply link or eligibility; those go to the review queue. It never gets the service-role key.
- **Sensitive answers** (PWD, Indigenous Peoples membership and the like) are stored only with a matching active consent, and for under-18s only with guardian consent. Withdrawing consent deletes the answer immediately.
- **Matching** runs inside Postgres, so student answers never leave the database.
- **Publishing** an offering is refused by the database unless it has a verified status, a status source, an apply link, and a deadline (or rolling admission).

## Setup

You need free accounts on GitHub, Supabase and Cloudflare.

### 1. Supabase project

1. Create a project at supabase.com (choose the Singapore region, closest to the Philippines).
2. Apply the migrations, either:
   - **CLI:** `npx supabase login`, `npx supabase link --project-ref <your-ref>`, then `npx supabase db push`; or
   - **Dashboard:** open **SQL Editor** and run each file in `supabase/migrations/` in filename order.
3. Deploy the account-deletion function: `npx supabase functions deploy delete-account`.
4. In **Authentication → URL Configuration**, set the Site URL to your Cloudflare Pages address (step 3) and add it under Redirect URLs. Add `http://localhost:5173` too for local development.

### 2. Make yourself admin

Sign in to the app once (so your user exists), then run in the SQL Editor:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'you@example.com';
```

### 3. Frontend on Cloudflare Pages (free `*.pages.dev` subdomain)

Create a Pages project connected to this repository with:

| Setting | Value |
| --- | --- |
| Root directory | `web` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Environment variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (from Supabase **Project Settings → API**), `NODE_VERSION` = `22` |

The publishable (anon) key is safe in the browser; row-level security protects the data. **Never** put the service-role key in the frontend.

### 4. Worker on GitHub Actions

1. Give the worker role a long random password (SQL Editor):
   ```sql
   alter role discovery_worker with password 'paste-a-long-random-password';
   ```
2. In Supabase, open **Connect** and copy the **Session pooler** connection string. Replace the user `postgres.<ref>` with `discovery_worker.<ref>` and use the password above. (The pooler is needed because GitHub runners can't reach the free plan's IPv6-only direct address.)
3. In GitHub, **Settings → Secrets and variables → Actions**:
   - secret `WORKER_DATABASE_URL` = that connection string
   - variable `WORKER_CONTACT` = an email address sites can use to reach you about the bot
4. Run **Actions → Discovery → Run workflow** once. A successful run appears on the app's Admin page.

The repository must be **public** for free GitHub Actions minutes. Only code lives in it; no student data or keys.

## Local development

```bash
cd web
cp .env.example .env.local   # fill in your Supabase URL and publishable key
npm install
npm run dev                  # http://localhost:5173
```

Database tests (needs a throwaway local Postgres 15+ and a superuser):

```bash
PGHOST=localhost PGUSER=postgres PGPASSWORD=... bash supabase/tests/run_tests.sh
```

Worker tests:

```bash
pip install -e "worker[dev]"
python -m pytest worker/tests
```

## Before launch (not done yet)

- Write the data-protection document and review it with the school's data protection officer: see `docs/data-protection.md`.
- Import cities and municipalities with official PSGC codes: see `docs/reference-data.md`.
- Schedule `private.purge_expired()` with Supabase Cron (monthly).

## Next: Phase 2 (Discovery v1)

Source registry for the first 10–20 official sources, polite fetching (robots.txt, per-host delay, ETag), text and PDF extraction, LLM extraction with per-field evidence, rule-based validation, and the admin review queue.
