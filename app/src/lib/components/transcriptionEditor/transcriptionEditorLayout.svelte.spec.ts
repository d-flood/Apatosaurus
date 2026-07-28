/**
 * Layout measurements for the page/column model, taken from a real mounted
 * editor in Chromium with the real stylesheet applied.
 *
 * Written for ticket 01 of the `refactor-transcription-editor` epic. `SPEC.md`
 * § D3 left one caveat open: a *blank* framed page did not overflow in
 * isolation, so the reported blank-page horizontal scroll was unexplained.
 * These tests close it. See `.tracker/refactor-transcription-editor/INVENTORY.md`.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import {
	transcriptionDocument,
	transcriptionFramedPage,
	transcriptionPlainPage,
} from '$lib/client/testing/editorFixtures';
import {
	mountTranscriptionEditor,
	nextAnimationFrame,
	type TranscriptionEditorHarness as Harness,
} from '$lib/client/testing/editorHarnesses.svelte';

// The measurements below are only meaningful with the app's real utility CSS
// applied; without it `.page`, `.column` and `.line` have no padding, and the
// Tailwind `min-w-max` on the editor root does nothing.
beforeAll(async () => {
	const css = (await import('../../../app.css?inline')).default as string;
	const style = document.createElement('style');
	style.textContent = css;
	document.head.appendChild(style);
});

const BLANK_LINES = ['', '', '', ''];
const FRAMED_PAGE_DOCUMENT = transcriptionDocument({
	pages: [
		transcriptionFramedPage({
			id: '1r',
			pageId: 'framed-1',
			texts: Array.from({ length: 5 }, () => BLANK_LINES),
		}),
	],
});
const PLAIN_PAGE_DOCUMENT = transcriptionDocument({
	pages: [
		transcriptionPlainPage({
			id: '1r',
			pageId: 'plain-1',
			texts: [BLANK_LINES, BLANK_LINES],
		}),
	],
});

/** The `min-w-max` wrapper the editor mounts its content inside. */
function editorRoot(harness: Harness): HTMLElement {
	const root = harness.container.querySelector<HTMLElement>('.min-w-max');
	if (!root) throw new Error('no min-w-max editor root');
	return root;
}

/** Distinct top offsets = distinct visual rows of the wrapping frame grid. */
function frameRows(harness: Harness): number {
	const grid = harness.container.querySelector('.frame-grid');
	if (!grid) throw new Error('no frame grid');
	const tops = new Set(
		Array.from(grid.children).map(child => Math.round(child.getBoundingClientRect().top))
	);
	return tops.size;
}

/** Rounded top offset of a frame zone, used to tell rows apart. */
function zoneRow(harness: Harness, zone: string): number {
	const element = harness.container.querySelector<HTMLElement>(`.column[data-zone="${zone}"]`);
	if (!element) throw new Error(`no ${zone} zone`);
	return Math.round(element.getBoundingClientRect().top);
}

describe('page layout at a constrained viewport width', () => {
	it('DEFECT F15: a blank framed page overflows a 1000px pane', async () => {
		const harness = await mountTranscriptionEditor({
			document: FRAMED_PAGE_DOCUMENT,
			widthPx: 1000,
			id: 'layout-framed-overflow',
		});
		await nextAnimationFrame();
		try {
			expect(harness.viewport.scrollWidth).toBeGreaterThan(harness.viewport.clientWidth);
		} finally {
			harness.dispose();
		}
	});

	it('DEFECT F15: the overflow comes from `min-w-max` on the editor root, not from the page', async () => {
		const harness = await mountTranscriptionEditor({
			document: FRAMED_PAGE_DOCUMENT,
			widthPx: 1000,
			id: 'layout-framed-cause',
		});
		await nextAnimationFrame();
		try {
			const root = editorRoot(harness);
			expect(getComputedStyle(root).minWidth).toBe('max-content');
			const overflowing = harness.viewport.scrollWidth;

			// `.page { min-width: fit-content }` clamps to the space available, so it
			// cannot overflow on its own. It only overflows because `min-w-max` on
			// the ancestor removes the constraint the clamp measures against.
			root.style.minWidth = '0px';
			await new Promise(resolve => requestAnimationFrame(() => resolve(null)));

			expect(harness.viewport.scrollWidth).toBeLessThan(overflowing);
			expect(harness.viewport.scrollWidth).toBe(harness.viewport.clientWidth);
		} finally {
			harness.dispose();
		}
	});

	it('DEFECT F16: `.column { min-width: 20rem }` breaks the three-across frame at 1000px', async () => {
		const harness = await mountTranscriptionEditor({
			document: FRAMED_PAGE_DOCUMENT,
			widthPx: 1000,
			id: 'layout-framed-columns',
		});
		await nextAnimationFrame();
		try {
			const root = editorRoot(harness);
			root.style.minWidth = '0px';
			await new Promise(resolve => requestAnimationFrame(() => resolve(null)));

			const column = harness.container.querySelector<HTMLElement>('.column')!;
			expect(getComputedStyle(column).minWidth).toBe('320px');

			// Wanted: top / left+center+right / bottom == 3 rows. The 320px floor on
			// each zone exceeds the space, so `right` wraps onto its own row.
			expect(frameRows(harness)).toBe(4);
			expect(zoneRow(harness, 'left')).toBe(zoneRow(harness, 'center'));
			expect(zoneRow(harness, 'right')).not.toBe(zoneRow(harness, 'center'));

			for (const element of Array.from(
				harness.container.querySelectorAll<HTMLElement>('.column')
			)) {
				element.style.minWidth = '0px';
			}
			await new Promise(resolve => requestAnimationFrame(() => resolve(null)));

			// Removing the floor alone is NOT enough at this width: the declared flex
			// bases (`1 1 16rem` + `2 1 24rem` + `1 1 16rem` = 56rem) plus the page's
			// padding and the grid gaps still exceed 1000px, so `right` keeps
			// wrapping. Any fix has to address the bases, not just the min-width.
			expect(zoneRow(harness, 'left')).toBe(zoneRow(harness, 'center'));
			expect(zoneRow(harness, 'right')).not.toBe(zoneRow(harness, 'center'));
		} finally {
			harness.dispose();
		}
	});

	it('the frame is correct at 1400px, where the 320px floor still fits', async () => {
		const harness = await mountTranscriptionEditor({
			document: FRAMED_PAGE_DOCUMENT,
			widthPx: 1400,
			id: 'layout-framed-wide',
		});
		await nextAnimationFrame();
		try {
			expect(zoneRow(harness, 'left')).toBe(zoneRow(harness, 'center'));
			expect(zoneRow(harness, 'right')).toBe(zoneRow(harness, 'center'));
			expect(frameRows(harness)).toBe(3);
		} finally {
			harness.dispose();
		}
	});

	it('a blank plain page does not overflow the same pane', async () => {
		const harness = await mountTranscriptionEditor({
			document: PLAIN_PAGE_DOCUMENT,
			widthPx: 1000,
			id: 'layout-plain',
		});
		await nextAnimationFrame();
		try {
			expect(harness.viewport.scrollWidth).toBe(harness.viewport.clientWidth);
		} finally {
			harness.dispose();
		}
	});
});
