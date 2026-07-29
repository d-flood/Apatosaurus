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
	transcriptionColumn,
	transcriptionFramedPage,
	transcriptionLine,
	transcriptionPlainPage,
} from '$lib/client/testing/editorFixtures';
import {
	mountTranscriptionEditor,
	nextAnimationFrame,
	type TranscriptionEditorHarness as Harness,
} from '$lib/client/testing/editorHarnesses.svelte';
import { createDefaultFormWorkAttrs } from './pageFormwork';

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

describe('presentational numbering', () => {
	it('renders plain-page column and line ordinals with CSS counters', async () => {
		const harness = await mountTranscriptionEditor({
			document: transcriptionDocument({
				pages: [
					transcriptionPlainPage({
						texts: [
							['a1', 'a2', 'a3'],
							['b1', 'b2', 'b3'],
						],
					}),
				],
			}),
			id: 'numbering-plain',
		});
		await nextAnimationFrame();
		try {
			const page = harness.container.querySelector<HTMLElement>('.page')!;
			const columns = page.querySelectorAll<HTMLElement>('.column');
			const lines = columns[1].querySelectorAll<HTMLElement>('.line');

			expect(getComputedStyle(page).counterReset).toContain('transcription-column');
			expect(getComputedStyle(columns[1]).counterIncrement).toContain('transcription-column');
			expect(getComputedStyle(columns[1]).counterReset).toContain('transcription-line');
			expect(getComputedStyle(lines[2]).counterIncrement).toContain('transcription-line');
			expect(getComputedStyle(columns[1], '::before').content).toContain(
				'counter(transcription-column)'
			);
			expect(getComputedStyle(lines[2], '::before').content).toContain(
				'counter(transcription-line)'
			);
		} finally {
			harness.dispose();
		}
	});

	it('fills a short line with editable content and renders all editorial chrome', async () => {
		const formWork = (
			kind: 'pageLabel' | 'runningTitle' | 'catchword' | 'quireSignature',
			text: string
		) => {
			const { content, ...attrs } = createDefaultFormWorkAttrs(kind, text);
			return { type: 'fw', attrs, content };
		};
		const harness = await mountTranscriptionEditor({
			document: transcriptionDocument({
				pages: [
					transcriptionPlainPage({
						id: 'folio 1r',
						columns: [
							transcriptionColumn({
								lines: [
									transcriptionLine({
										items: [
											{ type: 'text', text: 'Alpha ' },
											formWork('pageLabel', 'Label I'),
											formWork('runningTitle', 'Romans'),
											formWork('catchword', 'logos'),
											formWork('quireSignature', 'XII'),
										],
										attrs: { wrapped: true },
									}),
								],
							}),
						],
					}),
				],
			}),
			id: 'editorial-chrome',
		});
		await nextAnimationFrame();
		try {
			const page = harness.container.querySelector<HTMLElement>('.page')!;
			const column = page.querySelector<HTMLElement>('.column')!;
			const line = column.querySelector<HTMLElement>('.line')!;
			const content = line.querySelector<HTMLElement>('.line-content')!;
			const lineWidth = line.getBoundingClientRect().width;
			const deadZoneRatio = (lineWidth - content.getBoundingClientRect().width) / lineWidth;

			expect(deadZoneRatio).toBeLessThan(0.05);
			expect(getComputedStyle(page, '::before').content).toBe('"Page: folio 1r"');
			expect(getComputedStyle(column, '::before').content).toContain(
				'counter(transcription-column)'
			);
			expect(getComputedStyle(line, '::before').content).toContain(
				'counter(transcription-line)'
			);
			expect(getComputedStyle(line, '::after').content).toContain('↪');
			expect(Array.from(line.querySelectorAll('.fw-node')).map(node => node.textContent)).toEqual([
				'Label I',
				'Romans',
				'logos',
				'XII',
			]);
		} finally {
			harness.dispose();
		}
	});

	it('resets line ordinals independently in every framed-page zone', async () => {
		const harness = await mountTranscriptionEditor({
			document: FRAMED_PAGE_DOCUMENT,
			id: 'numbering-framed',
		});
		await nextAnimationFrame();
		try {
			const columns = harness.container.querySelectorAll<HTMLElement>('.column[data-zone]');
			expect(columns).toHaveLength(5);
			for (const column of columns) {
				expect(getComputedStyle(column).counterReset).toContain('transcription-line');
				expect(column.querySelectorAll('.line')).toHaveLength(4);
			}
		} finally {
			harness.dispose();
		}
	});
});
