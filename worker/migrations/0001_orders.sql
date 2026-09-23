-- Orders recorded by the commerce Worker from Stripe webhooks.
-- Amounts are integer minor units; *_json columns hold JSON text.
-- stripe_session_id is UNIQUE so webhook retries insert at most once.
CREATE TABLE IF NOT EXISTS orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_session_id TEXT    NOT NULL UNIQUE,
  payment_intent    TEXT,
  email             TEXT,
  name              TEXT,
  amount_total      INTEGER NOT NULL DEFAULT 0,
  currency          TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'fulfilled', 'refunded', 'cancelled')),
  shipping_json     TEXT,
  items_json        TEXT    NOT NULL DEFAULT '[]',
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS orders_created_at ON orders (created_at);
CREATE INDEX IF NOT EXISTS orders_status ON orders (status);
