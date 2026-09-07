# D1 migrations

These were run by hand against the `ergotrax-accounts` D1 database as the schema evolved; they are not auto-applied. Kept here so the database's current shape is reproducible / explainable, not as a migration runner.

1. `001_reports_columns.sql` — add `pdf_key`, `file_name`, `title` to `reports` for PDF-based reports.
2. `002_reports_body_nullable.sql` — `reports.body` was originally `NOT NULL`; a PDF-only report has no body text, so it had to become nullable. SQLite can't `ALTER COLUMN`, so this recreates the table (rename old → create new → rename new into place).
3. `003_content_items.sql` — the generic `content_items` table (tracks/events/articles/programmes/certificates/resources), used by the dashboard's Site content tab and live-injected into the public site.

Run with: `npx wrangler d1 execute ergotrax-accounts --remote --file=migrations/00N_name.sql`
