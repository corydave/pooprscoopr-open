// =====================================================================
// PooprScoopr - the Worker's front door
// =====================================================================
// Cloudflare runs pooprscoopr.com as a "Worker with static assets":
// every file in the repo (index.html, sw.js, the icons...) is served as
// it is. This little file only wakes up for addresses that are NOT one
// of those files - in practice, the online features under /api/...
//
// It passes those requests to the leaderboard / save-code code, which
// lives in functions/api/[[path]].js (written for Cloudflare "Pages
// Functions", hence the odd file name). Reusing it means there is only
// ONE copy of the server code to read and look after.
//
// Settings for this file (its name, the database connection) are in
// wrangler.jsonc. See ONLINE-SETUP.md for the dashboard steps.
// =====================================================================

import { onRequest } from './functions/api/[[path]].js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // The online features: /api/save, /api/load, /api/scores, /api/leave.
    if (url.pathname.startsWith('/api/')) {
      // Pages Functions hand the code the part after /api/ as a list,
      // e.g. "/api/scores" -> ["scores"]. Do the same here.
      const path = url.pathname.slice('/api/'.length).split('/').filter(Boolean);
      return onRequest({ request, env, ctx, params: { path } });
    }

    // Anything else that is not a real file: the normal "not found".
    // (env.ASSETS is the site's own files; asking it again gives the
    // same answer Cloudflare would give without this Worker.)
    return env.ASSETS.fetch(request);
  }
};
