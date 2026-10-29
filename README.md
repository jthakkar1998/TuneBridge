# TuneBridge v4 — Your music, one paste away

A mobile-first web app for people whose friends use the other music service. **The sender shares a normal Spotify or Apple Music URL. The recipient opens TuneBridge, pastes it once, and uses their saved preferred streaming app.** Songs open at the matching recording; accessible playlists are reconstructed in the recipient's library after match review and explicit approval. Two-way support is designed in, with important platform access constraints below.

## Vercel Hobby deployment (fixed in this edition)

This version fixes the **"No more than 12 Serverless Functions"** deployment failure in v4. The old 13 endpoint files have been consolidated into **one** `api/index.js` Vercel Function. `vercel.json` routes all public `/api/*` URLs through that function without changing the frontend URLs. You **do not need Vercel Pro** to address this limit.

1. Replace the contents of your existing TuneBridge GitHub repository with **this entire project's contents** (including deleting the old `api/apple/`, `api/spotify/` and other endpoint files). Keep the repository root as the Vercel Root Directory. Do not simply add the new `api/index.js` next to the old API files: that would **increase** your function count.
2. Confirm `api/` contains **only** `index.js` and `lib/resolve.js` now lives under `lib/` (not `api/`). The ZIP is arranged this way already.
3. Push the changes to GitHub. Vercel should create a new Preview deployment. You can also redeploy the new commit from the Vercel dashboard.
4. Open `https://YOUR-DEPLOYMENT.vercel.app/api/status` and `https://YOUR-DEPLOYMENT.vercel.app/api/demo`. Both should return JSON. Then open the homepage and test the demo song/playlist.
5. Add any API keys separately in Vercel Environment Variables to activate live integrations. This deployment fix **does not** itself activate Spotify, Apple Music, MusicLink or MusicAPI.

The route behavior is covered by automated tests. **The actual Vercel deployment has not been run** from this offline environment, so if you encounter a new build/runtime issue, share the new Vercel log.

## What this version actually does

- **One paste box** recognizes Spotify / Apple Music songs vs. playlists automatically (Spotify `spotify.link` shortened URLs are expanded). A service preference is saved in the browser. Same-service links bypass conversion and open directly.
- **Songs:** after a successful match, attempts to navigate directly to your preferred app's song URL, and shows a persistent Open button as a fallback for browsers that block native app opening. Uses MusicLink v2. When no MusicLink key is present, one *labeled example* song works; arbitrary live matches do not.
- **Playlists:** retrieves accessible metadata and ordered track lists; searches the destination catalog by ISRC and name/artist; distinguishes exact matches, approximate matches requiring individual selection, and unmatched tracks; only creates a playlist after the user confirms. Imports are snapshots, not synced playlists. Same-service playlist links open directly.
- **Playlist from an unrelated Spotify friend:** the official Spotify development API **does not** let your logged-in account read their playlist's tracks. An **optional** adapter to MusicAPI's documented public playlist catalog endpoint is implemented. It is OFF until MusicAPI credentials are provided and its terms/costs have been reviewed. **The adapter was unit-tested with mock responses; not tested live.** No scraping or bypassing Spotify's API restrictions is built in.
- **Connections:** optional Spotify PKCE login with browser-local access/refresh tokens so Spotify users don't have to authorize every visit; Apple Music authorization via MusicKit Web JS when adding a playlist. Apple MusicKit may reuse its prior authorization where allowed. A browser can lose or revoke connections; no permanent login is guaranteed.
- **Account syncing:** optional Supabase email magic links and synced preference. *Streaming tokens are not synced between devices*. Supabase share snapshots from v3 remain available but the UI now prioritizes receiving rather than publishing music.

The demo is deliberately honest. It **does not** create a real playlist or claim to have queried any catalog.

## Run locally

1. Install Node.js 20.6 or later.
2. From the extracted folder run `npm test`, then `npm start`.
3. Visit `http://127.0.0.1:3000/` (use **127.0.0.1** for Spotify OAuth localhost testing).
4. Choose your music app once; tap **Try a song** or **Preview a playlist** for no-credentials demonstrations.

To use a `.env` file locally, run `node --env-file=.env server.js` instead of `npm start` — the default Node command does not load `.env` automatically. Never commit your `.env`.

## Credentials and activation checklist

| Feature | Credential | Where to put it |
| --- | --- | --- |
| Arbitrary songs | `MUSICLINK_API_KEY` | Private server environment (not `config.js`) |
| Spotify connection, playlist destination, your own Spotify playlists | Spotify OAuth **Client ID** | `spotifyClientId` in public `config.js` |
| Apple Music catalog + playlist creation | `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | Private server environment |
| Friend's public playlists without connecting the source account (optional, unverified) | `MUSICAPI_CLIENT_ID` and optionally `MUSICAPI_CLIENT_SECRET` | Private server environment |
| Email sign-in + optional synced preference | Supabase Project URL and publishable key | `supabaseUrl`, `supabaseAnonKey` in `config.js` |
| Supabase shared playlist storage | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Private server environment; legacy `SUPABASE_SERVICE_ROLE_KEY` also supported |

**MusicLink**: https://musiclink.one/. Its free tier covers 300 requests per month for personal use and requires attribution. Check the current pricing/terms before distributing the app.

**Spotify**: https://developer.spotify.com/dashboard — create an app and register an **exact** redirect URI (e.g. `http://127.0.0.1:3000/` for local, `https://YOUR-DOMAIN.vercel.app/` for production). Spotify development-mode apps require a Premium owner and are limited to five allowlisted users. Playlist item retrieval is only permitted for playlists the signed-in Spotify user owns or collaborates on in this mode: https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide.

**Apple**: https://developer.apple.com/musickit/ — paid developer account (typically $99 USD/year) and a valid MusicKit media key. Put the `.p8` key **only on the server**. `APPLE_ORIGIN` is optional; if supplied it is encoded as an array claim in the developer JWT. An Apple subscriber must authorize their library before importing. Apple-created *library* playlists may not have a public, navigable URL; TuneBridge can take you to your playlists library but not reliably to that exact newly created playlist across devices.

**MusicAPI public-playlist adapter (optional)**: https://musicapi.com/docs/reference/get-public-playlist-items. Uses `POST /public/inspect/url` and paginated `POST /public/inspect/playlistItems` (50 items per page), with a 300-track per-import cap. Verify the provider's authorization, data rights, compliance, availability and pricing for your use case before you turn it on. Current provider documents describe a **€500/month minimum for managed integrations**; some self-managed plans have no minimum. Don't subscribe on this app's behalf or assume a free tier: https://musicapi.com/docs/billing/billing-and-usage. A configured provider may still decline or fail for some links. Spotify's official restriction still exists, irrespective of third-party claims.

**Supabase**: Create a project at https://supabase.com and run `supabase.sql` if you need cloud-stored share links. The browser may use a `sb_publishable_...` key, never a server secret. Set a `sb_secret_...` key in `SUPABASE_SECRET_KEY` on the server. Enable email OTP/magic links and configure the same application URL as an auth redirect. Supabase is not required for the one-device preference and paste flow.

## User flow

1. Recipient visits TuneBridge and chooses Spotify or Apple Music once.
2. Recipient optionally connects that service for **playlist writes** (song opening itself does not require music account authorization).
3. Friend texts an ordinary Spotify/Apple Music link — **they need not use TuneBridge**.
4. Recipient pastes that URL in TuneBridge. For songs: a successful live match opens the preferred destination link. For playlists: TuneBridge reads available tracks, matches them automatically, shows uncertain/missing songs, and asks for approval before creating a native personal playlist in the recipient's library.
5. Same-service links open as-is without extra API calls.

### Limitations / security / remaining verification

- **Not fully activated or publicly deployed.** No private API credentials were supplied. Live playlist transfers and phone-level app launches cannot be verified here. Automated tests cover validation, matching, API adapter pagination, error handling and mock create calls; browser interaction testing uses offline mocked API responses.
- **Public Spotify playlist reading is the unresolved prerequisite** for arbitrary unrelated friends unless you activate and validate an authorized provider. The code explains missing access rather than claiming success. Do not treat provider marketing claims as proof of permission or future availability.
- **Persistence tradeoff:** Spotify PKCE tokens are stored in the browser's `localStorage` to reduce repeat login. This is appropriate only for a trusted personal test environment, not a hardened, public multiuser product. A production deployment should use encrypted server-side token storage with per-user access controls, explicit disconnect/revocation, and a security review. Apple MusicKit user-token persistence varies by browser and device.
- Phone operating systems decide whether HTTPS service URLs actually launch native apps. TuneBridge cannot intercept ordinary iMessage links or force an installed app to open in all cases.
- Music data matching is best-effort. ISRC and track/artist/duration scores are used. Live edits, remixes, regional restrictions, local files, missing tracks and API quotas can reduce results. The preview shows precisely what's missing or uncertain, not invented tracks.
- The playlist limit is **300 songs** per import; larger playlists are flagged as truncated. Third-party API calls and matching can be expensive/slow on low-tier plans. Rate limiting is per Node instance, not a production-wide gateway.
- Apple Music import returns the created playlist ID but **not a guaranteed deep link** to the specific library playlist. Public native playlist sharing isn't guaranteed. The app links to the user's library view instead.
- Spotify user data is not downloaded as audio and no streaming playback is implemented.

## Deploy to Vercel

Upload the **folder contents** to GitHub. Import the repository in Vercel with the Other framework preset, project root at this folder, no build command, and Node >=20. The `api/*` wrappers (including `api/public/playlist.js`) route requests through `server.js`, while root HTML/CSS/JS are static. Supply private variables through Vercel Settings → Environment Variables and redeploy. Configure the resulting HTTPS origin as an allowlisted Spotify OAuth redirect and Supabase sign-in URL. See `/api/status` to inspect whether keys are *present* (not whether they actually work). Check Spotify and Apple Music terms before any wider rollout.

## Test and structure

Run `npm test` for **22 tests** using Node's built-in test runner (no npm dependencies). UI interaction smoke checks were run with mocked API responses at desktop and iPhone viewport sizes; screenshots are included as separate preview files. `lib/public-playlists.js` is the optional metadata provider adapter, `lib/spotify.js` / `lib/apple.js` are streaming integrations, `app.js` implements the receive-first frontend, `server.js` contains the routes and validation, and `supabase.sql` is optional account/share storage.
