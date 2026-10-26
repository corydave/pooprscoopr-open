# PooprScoopr

A browser game. Open `index.html` in a browser, or host the folder on any
static web host. Once it has loaded, it can keep working offline.

## Online features (optional)

The leaderboard and save codes need a small server part on Cloudflare: a D1
database plus this Worker. See [ONLINE-SETUP.md](ONLINE-SETUP.md).

Before deploying, copy `wrangler.jsonc` and replace `REPLACE_WITH_YOUR_D1_DATABASE_ID`
with the ID of your own database.

## License

MIT. See [LICENSE](LICENSE).
