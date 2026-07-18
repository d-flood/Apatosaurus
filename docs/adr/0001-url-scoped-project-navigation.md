# URL-scoped project navigation with flat document routes

Status: accepted

Projects own all transcriptions and collations, and the UI is organized around an "open project." We decided the open project is identified solely by the project id in the URL on project-scoped pages (`/projects/[id]/transcriptions`, `/projects/[id]/collations`, `/projects/[id]/settings`, `/projects/[id]/backup`), while document editor pages stay flat and are addressed by document id alone (`/transcription/[id]`, `/collation/[id]/[phase]`), deriving their project from document ownership. A last-opened project id in `localStorage` is used only to construct links (navbar, redirects, creation-page preselection) when no project is in the URL — it is never a source of truth for what a page displays.

## Considered Options

- **Ambient current-project state** — list pages at `/transcriptions` reading a persisted `currentProjectId`. Rejected: it makes "which project am I looking at?" answerable only by inspecting hidden state, prevents two tabs from showing two projects, and forces every test to seed state instead of navigating to a URL. This implicitness is what made the previous hash-tab navbar (`/projects#transcriptions`) confusing.
- **Fully nested document routes** — `/projects/[projectId]/transcription/[id]`. Rejected: document ids are globally unique and ownership already determines the project, so the nested form adds a redundant path segment that can contradict the true owner, and migrating every editor link and test buys no capability.

## Consequences

- The rule for implementers is mechanical: pages *about a project* carry the project id in the URL; pages *about a document* carry only the document id. Back-links from an editor to its project library are computed from ownership, not from navigation history.
- If the URL names a missing or deleted project, the page redirects (last-opened project, then most recently updated, then `/projects`) rather than rendering against fallback state.
