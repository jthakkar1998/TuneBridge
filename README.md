# TuneBridge v2 — songs and playlists across Spotify + Apple Music

A polished, mobile-first, dependency-free Node.js web app. Shares song URLs that redirect to listeners' saved streaming service and supports *authorized* playlist read → review matches → import workflows in both directions.

## Try the working demonstration (no credentials required)

1. Install **Node.js 20+**.
2. Run `npm start` in this folder and open `http://localhost:3000`.
3. Click **Try a song** for a verified two-platform example (automatically shows the opposite service if a listening preference was saved). Switch to **A playlist → Preview a playlist → See sample song matches** to explore the *illustrative* match review, including a borderline match and unavailable song. Nothing in the demo accesses a catalog or creates a playlist.
4. Choose **Spotify** or **Apple Music** from the header to save your preferred listening platform on this device.
5. The demo playlist **does not connect to streaming APIs or create playlists**. Real external song matching and playlist importing require the setup below.

Automated tests: `npm test`. The server has no third-party Node dependencies. The UI uses Google Fonts when connected to the internet (system fallbacks otherwise).

## Production services and access

| Feature | Required configuration | What it does |
| --- | --- | --- |
| Recognize and share the single demo song | None | Demonstrates Spotify ↔ Apple Music song URLs and smart link preference |
| Match arbitrary song links | `MUSICLINK_API_KEY` server environment | Calls MusicLink v2 from the server; no secret exposed to browser |
| Read Spotify playlists and create Spotify playlists | `spotifyClientId` in **public** `config.js` | Spotify OAuth 2.0 with PKCE; only playlists owned by / collaboratively accessible to the signed-in Spotify user in developer mode |
| Read Apple catalog playlists / match Apple tracks | Apple Music developer credentials, server environment | Uses Apple Music API catalog endpoints |
| Read personal Apple playlists and create Apple Music playlists | Apple developer credentials + MusicKit Web JS user authorization | Recipient's Apple Music account must authorize the import |
| Persistent shareable playlist snapshots on Vercel | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` server environment, SQL below | Stores a copy of source metadata and track list; not source playlist contents that change later |
| Email sign-in and synced music preference | `supabaseUrl`, `supabaseAnonKey` in public `config.js` | Supabase magic email link, profile upsert and optional access authorization |

**Spotify important**: Spotify development-mode API access presently allows only **five authorized Spotify users** per app, and the Spotify developer must have Premium. Reading playlist *contents* is limited to playlists owned by or collaborative with the connected Spotify account. Spotify song search is currently available but subject to rate / quota limits. Broader consumer availability requires review of Spotify's developer policies. Do not claim to support any publicly viewable Spotify playlist.

**Apple important**: Creating a library playlist via Apple's API may **not** produce a public share URL. TuneBridge opens the personal copy in the user's library; it does not promise a public playlist link. Availability and matching can differ by region. The Apple user must authorize writes.

### A. Set up live song matching

Sign up at https://musiclink.one/ and set `MUSICLINK_API_KEY` as a **server environment variable**. The free tier is for personal experiments; see their current commercial/attribution terms. Do **not** put this key in `config.js` or in the browser.

### B. Spotify integration

1. Register an app in the [Spotify developer dashboard](https://developer.spotify.com/dashboard).
2. Add the full redirect URI to Spotify's allowlist. It must match the browser exactly. **For local Spotify OAuth, use a supported loopback origin such as `http://127.0.0.1:3000/` rather than `http://localhost:3000/`**, if the current Spotify dashboard rejects localhost. Production uses an HTTPS domain such as `https://example.vercel.app/`.
3. Put its **Client ID** (not client secret) in `config.js` as `spotifyClientId`.
4. Start from that same origin. For local use, `http://127.0.0.1:3000/`.
5. Paste your own Spotify playlist link. The app will prompt Spotify OAuth PKCE, request playlist read/write scopes, then return to the app.

Spotify tokens stay in browser **sessionStorage** and are passed to the TuneBridge server only when that server needs to invoke the Spotify API. The server does not persist user tokens. OAuth uses state and PKCE challenge and does not require a Spotify client secret. Spotify does not auto-connect just because the user selected Spotify as a preference.

### C. Apple Music integration

1. In the Apple Developer account, enable MusicKit / media services and create a MusicKit signing key and app identifier as required by Apple.
2. Set server variables `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (PEM text, newline escaped if necessary). Alternatively use an unexpired `APPLE_DEVELOPER_TOKEN` for short-term testing.
3. Specify `APPLE_ORIGIN` if required by your MusicKit developer token configuration. Configure the actual site origin according to Apple's MusicKit requirements.
4. For imports to Apple Music, the **recipient** authorizes MusicKit on the web via Apple's authorization dialog. The server then sends the resulting user token to Apple's authenticated library endpoints. Do not put the developer key in public files.
5. Apple Music catalog playlist URLs are readable via Apple developer credentials; a personal library playlist may require Apple Music account authorization.

### D. Supabase auth + share storage (recommended for deployment)

1. Create a Supabase project, then execute `supabase.sql` in SQL Editor.
2. Set the **server** environment variables `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (a server-only secret).
3. Add only the **public** `supabaseUrl` and `supabaseAnonKey` to `config.js`.
4. Enable email OTP / magic link sign-in in Supabase Auth, and configure the exact production redirect URL on Supabase's auth settings.
5. Sign into TuneBridge when publishing a shareable playlist URL. Recipients can read that share URL without signing in, but they must connect their *destination* music account before importing.

Local-only demo storage works without Supabase by writing `data/shares.json`. Local sharing is for testing and **is not durable in a serverless host**. Real production requires Supabase to save share snapshots. Do not commit `data/shares.json` when it contains personal playlist names/tracks.

### E. Deploy to Vercel

Import this directory into Vercel as a Node.js project, **no build command**, and add server environment variables in Vercel project settings. `api/*` files use a shared Node handler and `vercel.json` supplies basic headers. Set Spotify and Supabase callback allowlists to your production URL. Ensure `/app.js`, `/styles.css`, `/api/*` and `/` resolve on the public domain. This version has **not** been deployed, and no real streaming credentials have been provided for external end-to-end testing.

## User flow

- **Songs**: Paste a track link (including common `spotify.link` short links) → TuneBridge resolves platform equivalents → copy a smart link → recipient opens it; if they have a saved preference, TuneBridge redirects to the corresponding platform. If they have no preference, they select one. A browser/OS ultimately decides whether an installed native app opens.
- **Playlists (Spotify → Apple)**: Owner authorizes Spotify and opens a playlist they own / collaborate on → reads track metadata → publishes a TuneBridge link → recipient opens link, selects Apple Music, taps **Match songs for import**, reviews exact / approximate / missing matches, then authorizes Apple Music and explicitly creates their personal playlist.
- **Playlists (Apple → Spotify)**: Same steps reversed, requiring an Apple catalog or accessible library playlist and Spotify destination authorization.
- A **TuneBridge link** for a playlist is a share of the source track list. It is *not* automatically a public destination Spotify/Apple playlist.

## Limitations / honest status

- End-to-end live Spotify and Apple imports are **implemented but not verified against real accounts**, because credentials, developer accounts and approvals are not supplied. Test with an allowlisted Spotify account and an authorized Apple Music subscriber after setup.
- First version imports up to **300 tracks** from a source playlist. Larger playlists are marked truncated. Matching runs in batches; API rate limits and hosting runtime limits can affect performance. Not all live recordings or region-limited songs will be available.
- No continuous synchronization; copies are snapshots. Duplicates are preserved where both catalogs identify the same recording. The user must confirm before the playlist is written.
- Exact Apple matches are automatically selected, approximate matches require confirmation; a missing match is excluded. Check source/target territory and licensing.
- A *regular Spotify or Apple link sent directly through iMessage* isn't intercepted or rewritten by TuneBridge. To use this feature, share the TuneBridge URL.
- A Spotify playlist need not be public to be read if the owner authorizes it; arbitrary public Spotify playlist contents are intentionally **not** scraped/bypassed.

## Technical notes

- Node built-in `http`, no runtime npm packages; MusicKit Web JS and optional Supabase browser SDK are loaded on demand.
- Endpoints: `/api/expand`, `/api/resolve`, `/api/demo`, `/api/status`, `/api/spotify/playlist`, `/api/spotify/match`, `/api/spotify/create`, `/api/apple/token`, `/api/apple/playlist`, `/api/apple/match`, `/api/apple/create`, `/api/shares`.
- Playlists are created as *private* on Spotify. Source playlist snapshots in shared links can be read by anyone with the TuneBridge URL.
- No secret keys in `config.js`. Before launching to a public audience, add an external rate-limit and abuse prevention service, privacy policy, data deletion, monitoring, and more rigorous OAuth security review.

## Source docs

- https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
- https://developer.spotify.com/documentation/web-api/reference/create-playlist
- https://developer.apple.com/documentation/applemusicapi/create-a-new-library-playlist
- https://developer.apple.com/documentation/applemusicapi/add-tracks-to-a-library-playlist
- https://musiclink.one/blog/whats-new-v2
