-- SQLite has no ALTER COLUMN; recreate the table with body made nullable.
CREATE TABLE reports_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  staff_id INTEGER REFERENCES users(id),
  body TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  pdf_key TEXT,
  file_name TEXT,
  title TEXT
);
INSERT INTO reports_new SELECT id, client_id, staff_id, body, created_at, pdf_key, file_name, title FROM reports;
ALTER TABLE reports RENAME TO reports_old;
ALTER TABLE reports_new RENAME TO reports;
DROP TABLE reports_old;
