# PooprScoopr online - setup (leaderboard + save codes)

pooprscoopr.com runs on Cloudflare as a **Worker with static assets**: Cloudflare serves the repo's files as the website, and a small piece of server code answers `/api/...` for the leaderboard and save codes. Until the setup below is finished, the game works as normal and the Leaderboard window just says it can't reach the server.

## What's in the repo for this

- `worker.js` - the front door. Real files are served as usual; `/api/...` requests go to the leaderboard code.
- `functions/api/[[path]].js` - the leaderboard and save-code code itself. The brackets are part of the file name.
- `wrangler.jsonc` - the Worker's settings: its name (`pooprscoopr`), the front door, and the database connection (`DB`, with the database ID).
- `.assetsignore` - files that must not be public on the website: the server code, settings, `db/`, notes and backups.
- `db/schema.sql` - the database tables, run once.

## One-time setup

1. **Database** - done: D1 database `pooprscoopr`, ID `818908a5-a0d2-41b4-a31d-7b715c6a09ca` (already filled in `wrangler.jsonc`).
2. **Tables.** In the dashboard, go to Storage & Databases → D1 SQL Database → `pooprscoopr` → Console. Paste all of `db/schema.sql` and click Execute. The Tables tab should then list `saves`, `scores` and `hits`.
3. **Secret salt.** Go to Workers & Pages → `pooprscoopr` → Settings → Variables and Secrets → Add. Set the type to **Secret**, the name to `SECRET_SALT`, and the value to 40 or more random characters (on a Mac, run `openssl rand -hex 32` in Terminal). Keep a copy in your password manager, and never change it - changing it makes every save code stop working. Secrets survive deploys, but plain-text variables added in the dashboard would be replaced by `wrangler.jsonc`, so always use **Secret**.
4. **Push** `worker.js`, `wrangler.jsonc` and `.assetsignore` to GitHub, next to `index.html`. Cloudflare builds and deploys by itself.
5. **Check.** `https://pooprscoopr.com/api/scores` should show `{"scores":[]}`, and `https://pooprscoopr.com/worker.js` should now be "not found".

If a build fails, the site stays on the previous version. The build log is under Workers & Pages → `pooprscoopr` → Deployments, and the usual cause is the `name` in `wrangler.jsonc` not matching the Worker's name.

## Looking after the leaderboard (D1 → Console)

- See the board: `SELECT initials, progress, earned, difficulty, updated_at FROM scores ORDER BY progress DESC, earned DESC;`
- Hide an entry: `UPDATE scores SET hidden = 1 WHERE initials = 'XYZ';` (set it back to 0 to show it again)
- Remove an entry for good: `DELETE FROM scores WHERE initials = 'XYZ';`

## Initials blocklist

`BLOCKED_INITIALS`, near the top of `functions/api/[[path]].js`, is a starter list - please vet it and add to it. It's checked on the server, which is the only check that counts.

## How it works and what is stored

- **Save codes** are three family-friendly words, with over 21 million combinations. Only a scrambled fingerprint (SHA-256 hash with the secret salt) of each code is stored. Wrong codes are limited to 20 an hour per player.
- **Leaderboard**: one entry per save code, ranked by days won along the career, then by cash earned. The score is worked out from the saved career itself. A jump of more than one day between posts is refused, and so are careers that used Charlie mode.
- **Privacy**: no names, emails, accounts or IP addresses are stored. Rate limiting uses a daily-changing hash. Nothing is sent until a player makes a code or joins the board.
- **Free plan**: D1 allows 5 million rows read and 100,000 written a day; Workers allow 100,000 requests a day. Plain file downloads don't count against the Worker limit.

## Honest limits

- A determined player could fake a score, because the browser reports it. The checks keep the board believable; use `hidden` for anything silly.
- Anyone with a player's save code can load or overwrite that career. The game tells players to keep their code secret.
