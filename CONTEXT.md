# Apatosaurus

A local-first progressive web app for New Testament textual criticism: scholars transcribe manuscripts, then collate transcriptions to analyze textual variants. Projects group transcriptions and collations and own their collation settings.

## Language

### Navigation

**Open project**:
The project a user is currently working inside. On project-scoped pages, identified solely by the project id in the URL — never by hidden app state.
_Avoid_: Current project, selected project, active project

**Last-opened project**:
The remembered id of the project most recently opened, used only to construct links (navbar, redirects) when no project is in the URL. Never a source of truth for what a page displays.

**Project-scoped page**:
A page about a project (its document lists, settings, backup). Its URL carries the project id.

**Document page**:
An editor page addressed by document id alone. Its project is derived from document ownership, never from the URL or navigation history.

**Dashboard**:
The home page (`/`): recent documents to resume, attention items, and creation shortcuts. The app's re-entry point for returning scholars.
_Avoid_: Home page, landing page

**Data & Storage page**:
The app-wide surface for storage durability, whole-account export, and database repair. The single click-through target for backup status. Per-project backup controls live on the project's backup page, never here.

### Collation

**Collation settings**:
Project-owned configuration for how collation interprets the project's witnesses: regularization rules, normalization toggles, witness treatments, and excluded hands. Lives on the project Settings page, not in the transcription library.

**Project transcription library**:
The project-scoped list of transcriptions a scholar works from — open, create, delete. Carries no collation configuration.
