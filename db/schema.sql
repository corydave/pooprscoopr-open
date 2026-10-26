/* PooprScoopr online: the database tables.
   Run this once in the Cloudflare dashboard: D1 > your database > Console.
   Running it again is safe: "IF NOT EXISTS" skips tables that are there.
   (These notes use slash-star comments, not double dashes, because the
   Console squashes everything onto one line - and a double-dash comment
   would then swallow all the SQL after it.) */

/* One row per save code. The code itself is never stored - only its
   SHA-256 fingerprint (code_hash). save_json is the career, as the game
   saves it. Times are milliseconds since 1970. */
CREATE TABLE IF NOT EXISTS saves (
  code_hash   TEXT PRIMARY KEY,
  save_json   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

/* One leaderboard entry per save code (only for players who joined).
   progress = days won along the career path (0-20; 20 = champion).
   badges = a JSON list of badge IDs.
   hidden = 1 takes an entry off the board without deleting it. */
CREATE TABLE IF NOT EXISTS scores (
  code_hash   TEXT PRIMARY KEY,
  initials    TEXT NOT NULL,
  progress    INTEGER NOT NULL,
  earned      INTEGER NOT NULL,
  difficulty  TEXT NOT NULL,
  badges      TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  hidden      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS scores_rank ON scores (hidden, progress DESC, earned DESC, updated_at);

/* Rate limiting: request counts per (hashed, daily-changing) player key
   per time window. expires is seconds since 1970. Old rows are swept
   away automatically. */
CREATE TABLE IF NOT EXISTS hits (
  bucket   TEXT PRIMARY KEY,
  n        INTEGER NOT NULL,
  expires  INTEGER NOT NULL
);
