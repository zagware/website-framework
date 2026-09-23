-- Contact form submissions (worker/contact.mjs). No IP addresses are stored.
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fields_json TEXT NOT NULL,
  email TEXT,
  page TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_created_at ON messages (created_at);
