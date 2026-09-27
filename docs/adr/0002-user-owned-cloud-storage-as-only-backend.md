# Users' own cloud storage is the only backend

Status: accepted

Scholars must own their data and we will not pay to store it, so project files live only in the browser and in a project location the scholar chooses: their Google Drive, their Dropbox, or a folder on their computer. A stateless Cloudflare Worker exists solely to exchange and refresh OAuth tokens (sealed into an HttpOnly cookie); it has no database and file contents never pass through it. The browser talks to storage providers directly.

## Considered Options

- **Browser-only OAuth** — no server at all. Rejected: Google issues no refresh tokens to browser-only clients, so scholars would be asked to reconnect roughly hourly.
- **Our own sync server and database** — Rejected: we would hold and pay for scholars' data, which is the opposite of the goal.

## Consequences

- Server-side session revocation is impossible short of rotating the Worker key; scholars revoke access at their provider.
- Team collaboration happens through folders the provider shares, which requires the broad storage scopes (full Drive, Full Dropbox) for team locations.
- The providers are deliberately asymmetric: Dropbox always uses Full Dropbox (one app registration), while Google asks for `drive.file` at sign-in and for full `drive` only when a team location is added, because Google's restricted-scope review would otherwise block every scholar.
