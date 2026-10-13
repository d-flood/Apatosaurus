# auth-worker

Stateless Cloudflare Worker that exchanges and refreshes storage-account OAuth tokens (ADR 0002). It has no storage bindings, and file contents never pass through it. The refresh token lives only in a sealed, HttpOnly `__Host-sa-<account>` cookie.

| Route                                    | Result                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `GET /auth/:provider/start?scopes=…`     | 302 to the provider with state and PKCE                                                                        |
| `GET /auth/:provider/callback`           | Exchanges the code, sets the account cookie, 302 to `<APP_ORIGIN><return_to>#account=<id>&provider=<provider>` |
| `POST /auth/:provider/token {accountId}` | `200 {accessToken, expiresAt, scopes}` or `401 {error: 'reauthorization-required'}`                            |
| `POST /auth/signout {accountId}`         | Clears the cookie, best-effort provider revoke, 204                                                            |

`:provider` is `dropbox` or `google`. Google accounts are `google:<sub>`, taken from the ID token.

`start` takes optional `scopes` (named extras: `drive` for Google, nothing for Dropbox; others are a 400), `login_hint` and `return_to`. `return_to` is a same-origin path, sealed into the pending cookie; a missing or off-site value, or a callback without a pending cookie, returns to `/data`, with errors as `#auth-error=<code>`. `scopes=drive` adds `https://www.googleapis.com/auth/drive` to the sign-in scopes with `include_granted_scopes=true`, and the callback's cookie replaces the account's old one. Only Add team location requests it.

## Configuration

| Name                    | Kind   | Notes                                                                                                      |
| ----------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| `APP_ORIGIN`            | var    | The app's origin, e.g. `https://apatosaurus.example`. The Worker must serve `/auth/*` on this same origin. |
| `COOKIE_SECRET`         | secret | 32 random bytes, base64 (`openssl rand -base64 32`). Rotating it signs every account out.                  |
| `DROPBOX_CLIENT_ID`     | secret | App key of a **Full Dropbox** scoped app.                                                                  |
| `DROPBOX_CLIENT_SECRET` | secret | App secret of the same app.                                                                                |
| `GOOGLE_CLIENT_ID`      | secret | Client ID of a Google OAuth **Web application** client.                                                    |
| `GOOGLE_CLIENT_SECRET`  | secret | Client secret of the same client.                                                                          |

The Dropbox app needs the scopes `account_info.read files.metadata.read files.metadata.write files.content.read files.content.write`, and `<APP_ORIGIN>/auth/dropbox/callback` as a redirect URI.

Google sign-in requests exactly `openid email profile https://www.googleapis.com/auth/drive.file` with `access_type=offline` and `prompt=consent`. Enable the Google Drive API on the project, add those scopes to the consent screen, and add `<APP_ORIGIN>/auth/google/callback` as an authorized redirect URI.

Google team locations also need the restricted `https://www.googleapis.com/auth/drive` scope on the consent screen and the Google Picker API enabled. The app reads `PUBLIC_GOOGLE_TEAM_LOCATIONS=true` (off until Google verifies the scope), `PUBLIC_GOOGLE_PICKER_API_KEY` (an API key restricted to the Picker API) and `PUBLIC_GOOGLE_APP_ID` (the Cloud project number) at build time.

While the consent screen's publishing status is **Testing**, Google refresh tokens expire after 7 days, so test accounts must sign in again weekly. Publish the app (and complete Google's verification) before real scholars use it.

Production: `wrangler secret put COOKIE_SECRET` (and the Dropbox and Google secrets), set `APP_ORIGIN`, and route `<app host>/auth/*` to the Worker.

## Development

Put the secrets in `packages/auth-worker/.dev.vars` (git-ignored):

```
COOKIE_SECRET=…
DROPBOX_CLIENT_ID=…
DROPBOX_CLIENT_SECRET=…
GOOGLE_CLIENT_ID=…
GOOGLE_CLIENT_SECRET=…
```

Register `http://localhost:3160/auth/dropbox/callback` on the Dropbox app and `http://localhost:3160/auth/google/callback` on the Google client, then run `pnpm --filter auth-worker dev` beside the app's `pnpm dev`. Vite's dev and preview servers proxy `/auth/*` to `http://127.0.0.1:8787`; set `AUTH_WORKER_ORIGIN` to change that, and `APP_ORIGIN` (`wrangler dev --var APP_ORIGIN:…`) if the app runs elsewhere.

`pnpm --filter auth-worker test` runs the specs in the Workers runtime with the Dropbox and Google token endpoints stubbed.
