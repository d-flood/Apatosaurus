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

const PANE_WIDTHS = [1400, 1200, 1000, 900, 700, 600] as const;

/** Distinct top offsets = distinct visual rows of the frame grid. */
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

describe('page layout at a constrained pane width', () => {
	it('keeps blank framed pages inside the pane with and without the IIIF workspace', async () => {
		for (const iiifWorkspaceOpen of [false, true]) {
			const harness = await mountTranscriptionEditor({
				document: FRAMED_PAGE_DOCUMENT,
				widthPx: PANE_WIDTHS[0],
				id: `layout-framed-${iiifWorkspaceOpen ? 'iiif' : 'editor'}`,
				props: { iiifWorkspaceOpen, toolbarTarget: document.body },
			});
			try {
				for (const widthPx of PANE_WIDTHS) {
					harness.viewport.style.width = `${widthPx}px`;
					await nextAnimationFrame();
					expect(harness.viewport.scrollWidth, `${widthPx}px pane`).toBe(
						harness.viewport.clientWidth
					);
				}
			} finally {
				harness.dispose();
			}
		}
	});

	it('uses the three-row frame where it fits and stacks every zone below that', async () => {
		const harness = await mountTranscriptionEditor({
			document: FRAMED_PAGE_DOCUMENT,
			widthPx: PANE_WIDTHS[0],
			id: 'layout-frame-rows',
		});
		try {
			for (const widthPx of PANE_WIDTHS) {
				harness.viewport.style.width = `${widthPx}px`;
				await nextAnimationFrame();
				const expectedRows = widthPx >= 900 ? 3 : 5;
				expect(frameRows(harness), `${widthPx}px pane`).toBe(expectedRows);
				if (expectedRows === 3) {
					expect(zoneRow(harness, 'left')).toBe(zoneRow(harness, 'center'));
					expect(zoneRow(harness, 'right')).toBe(zoneRow(harness, 'center'));
				}
			}
		} finally {
			harness.dispose();
		}
	});

	it('scrolls a long center line inside its column without widening the page or pane', async () => {
		const harness = await mountTranscriptionEditor({
			document: transcriptionDocument({
				pages: [
					transcriptionFramedPage({
						texts: [
							BLANK_LINES,
							BLANK_LINES,
							['x'.repeat(200)],
							BLANK_LINES,
							BLANK_LINES,
						],
					}),
				],
			}),
			widthPx: 1200,
			id: 'layout-long-center-line',
			props: { iiifWorkspaceOpen: true },
		});
		await nextAnimationFrame();
		try {
			const page = harness.container.querySelector<HTMLElement>('.page')!;
			const center = harness.container.querySelector<HTMLElement>(
				'.column[data-zone="center"]'
			)!;
			const line = center.querySelector<HTMLElement>('.line')!;
			expect(page.offsetWidth).toBe(harness.viewport.clientWidth);
			expect(harness.viewport.scrollWidth).toBe(harness.viewport.clientWidth);
			expect(line.scrollWidth).toBeGreaterThan(line.clientWidth);
		} finally {
			harness.dispose();
		}
	});

	it('keeps blank plain pages inside every pane width', async () => {
		const harness = await mountTranscriptionEditor({
			document: PLAIN_PAGE_DOCUMENT,
			widthPx: PANE_WIDTHS[0],
			id: 'layout-plain',
			props: { toolbarTarget: document.body },
		});
		try {
			for (const widthPx of PANE_WIDTHS) {
				harness.viewport.style.width = `${widthPx}px`;
				await nextAnimationFrame();
				expect(harness.viewport.scrollWidth).toBe(harness.viewport.clientWidth);
			}
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
			return {
				type: 'fw',
				attrs: createDefaultFormWorkAttrs(kind),
				content: [{ type: 'text', text }],
			};
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
			widthPx: 600,
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
			const lineNumberStyle = getComputedStyle(line, '::before');
			expect(lineNumberStyle.textAlign).toBe('left');
			expect(Number.parseFloat(lineNumberStyle.top)).toBeCloseTo(line.clientHeight / 2, 0);
			expect(lineNumberStyle.alignItems).toBe('center');
			expect(lineNumberStyle.transform).not.toBe('none');
			expect(getComputedStyle(line, '::after').content).toContain('↪');
			expect(
				Array.from(line.querySelectorAll('.fw-node')).map(node => node.textContent)
			).toEqual(['Label I', 'Romans', 'logos', 'XII']);
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
