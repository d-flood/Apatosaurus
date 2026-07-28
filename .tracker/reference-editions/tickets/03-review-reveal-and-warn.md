# 03 — Review, reveal, and warn on unconfirmed text

## What to build

Make unconfirmed text manageable rather than merely visible. Three additions on top of the mark from ticket 02:

1. **Explicit verse review** — a scholar whose manuscript agrees exactly with the text can mark a verse reviewed *without changing it*, clearing the mark across that verse.
2. **Visibility control and a count** — an entry in the editor's Layers menu to show/hide unconfirmed highlighting, and a count of how many verses still contain unconfirmed text.
3. **A non-blocking export warning** when a transcription containing unconfirmed text is exported.

Why review exists: agreement between manuscript and edition is the *common and correct* outcome. Edit-clearing alone means a scholar who does the job properly — reads the image, confirms the line, changes nothing — is left with a permanent warning. If doing it right leaves the warning on screen, scholars learn to ignore the warning, and the whole mechanism is decorative.

Demo: seed or paste text, review a verse without touching it, watch its highlighting clear. Toggle Layers → Unconfirmed off and the highlighting disappears. Export and see "N verses unconfirmed" without the export being blocked.

## Where to start

- The mark, its clearing rules, and its serialization: all delivered by ticket 02.
- `app/src/lib/components/transcriptionEditor/LayerToggles.svelte` — the Layers dropdown. Each entry is a checkbox bound to a key of `MarkVisibility`.
- `app/src/lib/components/transcriptionEditor/types.ts` — the `MarkVisibility` interface (line 15). Add a key.
- `app/src/lib/components/transcriptionEditor/StatusBar.svelte` — the likely home for the count.
- `app/src/lib/components/transcriptionEditor/editorCommands.ts` — prior art for editor commands, in particular `findPrecedingMilestoneNode` and `getCurrentMilestoneValues`, which already locate the verse containing the cursor.
- Export path: `app/src/lib/client/store/formats/tei.ts` (`transcriptionDocumentToTei`) and whatever UI triggers a TEI download.

## Contract

**The review unit is the verse.** Not the line, not the page, not a selection. The verse matches the milestone that seeding inserts by, matches what collation gathers, and is a unit scholars name out loud. Determining "the current verse" means the region between the preceding verse milestone and the next one, in document order — `getCurrentMilestoneValues` already does the lookup.

**Review clears; it does not set.** There is no way to mark confirmed text unconfirmed. If a scholar wants to re-flag something, they re-seed it.

**Review is not undone by later editing.** Once a verse is reviewed, editing inside it does not bring the mark back.

**The count is of verses containing any unconfirmed text**, not of marked characters or runs. "3 verses unconfirmed" is meaningful to a scholar; "412 unconfirmed characters" is not.

**The export warning never blocks.** Scholars export drafts constantly. A blocking gate trains them to clear marks to dismiss the dialog, which destroys the signal the mark exists to carry. It is a notice alongside the export, not a confirmation the scholar must dismiss to proceed.

**Visibility is display-only.** Hiding the layer must not alter the document, the export, or the count.

## Out of scope

- Warning or refusing to **collate** witnesses containing unconfirmed text. That is a natural follow-on and it is not in this epic.
- Navigating between unconfirmed regions ("jump to next unconfirmed"). Desirable, not required here.
- Bulk review — "review this page", "review all". The verse is the only unit.
- Changing the mark's clearing-on-edit semantics from ticket 02.
- Any change to how TEI export builds its header or source description. That is ticket 07.

## Acceptance criteria

- [ ] Browser spec: reviewing a verse with no other edit removes `<seg type="unconfirmed">` from that verse's text in the exported XML, and leaves an adjacent unconfirmed verse untouched.
- [ ] Browser spec: after reviewing a verse, editing a word inside it does not reintroduce the mark.
- [ ] Browser spec: toggling the Layers entry off changes no exported XML.
- [ ] Browser spec: the count reports verses, not runs — a verse with three separate unconfirmed runs counts as one.
- [ ] Browser or e2e spec: exporting a transcription with unconfirmed text surfaces a warning **and** still produces the file.
- [ ] Any new phosphor icon is added to `optimizeDeps.include` in `app/vite.config.ts`.

Commands:

```sh
cd app && pnpm run check && pnpm run test:unit -- --run && pnpm run test:e2e
```

Success = all exit 0.

## Blocked by

- 02 — the `unconfirmed` mark, its clearing rules, and its serialization.
