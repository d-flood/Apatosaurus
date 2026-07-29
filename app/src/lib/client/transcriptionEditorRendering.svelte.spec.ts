/**
 * What `renderHTML` actually emits, for ticket 01 of the
 * `refactor-transcription-editor` epic.
 *
 * `renderHTML` is not only the view: it is also the clipboard serializer and
 * the input to `renderCorrectionContent`'s `generateHTML`, and `parseHTML` is
 * expected to invert it. These tests check that round trip. Assertions tagged
 * DEFECT record behaviour the inventory marks as wrong.
 *
 * See `.tracker/refactor-transcription-editor/INVENTORY.md`.
 */
import { Editor, generateHTML } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { beforeAll, describe, expect, it } from 'vitest';

import { editorDocument } from './testing/editorFixtures';
import { createTestEditor } from './testing/editorHarnesses.svelte';
import { getCorrectionRenderExtensions } from './transcriptionEditorSchema';

type Json = Record<string, any>;

beforeAll(async () => {
	const css = (await import('../../app.css?inline')).default as string;
	const style = document.createElement('style');
	style.textContent = css;
	document.head.appendChild(style);
});

function markedText(text: string, markType: string, attrs: Json): Json {
	return { type: 'text', text, marks: [{ type: markType, attrs }] };
}

const incrementalCarrierCases = [
	{
		type: 'correctionNode',
		selector: '.tei-inline-badge-shell',
		attrs: { corrections: [{ hand: 'm1', content: [{ type: 'text', text: 'alpha' }] }] },
		nextAttrs: { corrections: [{ hand: 'm2', content: [{ type: 'text', text: 'beta' }] }] },
	},
	{
		type: 'editorialAction',
		selector: '.editorial-action-node',
		attrs: { summary: 'transpose', structure: { kind: 'transpose', targets: ['#a'] } },
		nextAttrs: { summary: 'transpose #b', structure: { kind: 'transpose', targets: ['#b'] } },
	},
	{
		type: 'metamark',
		selector: '.metamark-node',
		attrs: { summary: 'metamark:addition', teiAttrs: { function: 'addition' } },
		nextAttrs: { summary: 'metamark:deletion', teiAttrs: { function: 'deletion' } },
	},
	{
		type: 'teiAtom',
		selector: '.tei-atom-node',
		attrs: {
			tag: 'note',
			summary: 'note:local:alpha',
			text: 'alpha',
			teiAttrs: { type: 'local' },
		},
		nextAttrs: {
			tag: 'note',
			summary: 'note:editorial:beta',
			text: 'beta',
			teiAttrs: { type: 'editorial' },
		},
	},
	{
		type: 'teiWrapper',
		selector: '.tei-wrapper-node',
		attrs: { tag: 'foreign', summary: 'alpha', teiAttrs: { 'xml:lang': 'la' } },
		nextAttrs: { tag: 'foreign', summary: 'beta', teiAttrs: { 'xml:lang': 'grc' } },
	},
	{
		type: 'handShift',
		selector: '.tei-inline-badge-shell',
		attrs: { teiAttrs: { new: '#m1', medium: 'ink' } },
		nextAttrs: { teiAttrs: { new: '#m2', medium: 'pencil' } },
	},
	{
		type: 'teiMilestone',
		selector: '.tei-milestone-node',
		attrs: { teiAttrs: { unit: 'section', n: 'A' } },
		nextAttrs: { teiAttrs: { unit: 'section', n: 'B' } },
	},
	{
		type: 'gap',
		selector: '.gap-milestone',
		attrs: { reason: 'lost', unit: 'chars', extent: '2' },
		nextAttrs: { reason: 'illegible', unit: 'words', extent: '3' },
	},
	{
		type: 'space',
		selector: '.space-milestone',
		attrs: { teiAttrs: { unit: 'chars', extent: '1' } },
		nextAttrs: { teiAttrs: { unit: 'words', extent: '2' } },
	},
	{
		type: 'untranscribed',
		selector: '.untranscribed-milestone',
		attrs: { reason: 'damage', extent: 'partial' },
		nextAttrs: { reason: 'illegible', extent: 'full' },
	},
	...(['lineBreak', 'columnBreak', 'pageBreak'] as const).map(type => ({
		type,
		selector: `.${type.replace('Break', '-break')}-marker`,
		attrs: { teiAttrs: { n: '1', break: 'no' } },
		nextAttrs: { teiAttrs: { n: '2', ed: 'NA28' } },
	})),
	{
		type: 'fw',
		selector: '.fw-node',
		attrs: {
			type: 'header',
			entryPoint: 'page',
			category: 'Page Header',
			placementConcept: 'unknown',
		},
		nextAttrs: {
			type: 'runningTitle',
			entryPoint: 'page',
			category: 'Running Title',
			placementConcept: 'unknown',
		},
		content: [{ type: 'text', text: 'Alpha' }],
	},
] as const;

function createCarrierEditor(carrier: (typeof incrementalCarrierCases)[number]) {
	if (['lineBreak', 'columnBreak', 'pageBreak'].includes(carrier.type)) {
		return new Editor({
			extensions: getCorrectionRenderExtensions() as any,
			content: {
				type: 'correctionDoc',
				content: [{ type: carrier.type, attrs: carrier.attrs }],
			},
		});
	}
	return createTestEditor({
		content: editorDocument({
			interestingLineContent: [
				{
					type: carrier.type,
					attrs: carrier.attrs,
					content: 'content' in carrier ? carrier.content : undefined,
				},
			],
		}),
	});
}

function renderingSignature(root: HTMLElement) {
	return [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))].map(element => ({
		tag: element.tagName.toLowerCase(),
		attributes: Array.from(element.attributes)
			.filter(attribute => attribute.name !== 'contenteditable')
			.map(attribute => [attribute.name.toLowerCase(), attribute.value])
			.sort(([left], [right]) => left.localeCompare(right)),
		text: element.childElementCount === 0 ? element.textContent : null,
	}));
}

describe('renderHTML round trip', () => {
	it('updates an inspector-edited carrier badge without replacing its DOM', () => {
		const editor = createTestEditor({
			content: editorDocument({
				interestingLineContent: [
					{ type: 'gap', attrs: { reason: 'lost', unit: 'chars', extent: '2' } },
				],
			}),
		});
		try {
			const badge = editor.view.dom.querySelector<HTMLElement>('.gap-milestone')!;
			let gapPos = -1;
			editor.state.doc.descendants((node: any, pos: number) => {
				if (node.type.name === 'gap') gapPos = pos;
			});

			editor.view.dispatch(
				editor.state.tr.setNodeMarkup(gapPos, undefined, {
					reason: 'illegible',
					unit: 'words',
					extent: '3',
				})
			);

			expect(editor.view.dom.querySelector('.gap-milestone')).toBe(badge);
			expect(badge.dataset.reason).toBe('illegible');
			expect(badge.title).toBe('illegible (words, 3)');
		} finally {
			editor.destroy();
		}
	});

	it('keeps every inspector-edited carrier DOM aligned with renderHTML while updating in place', () => {
		for (const carrier of incrementalCarrierCases) {
			const editor = createCarrierEditor(carrier);
			try {
				let position = -1;
				editor.state.doc.descendants((node: any, pos: number) => {
					if (node.type.name === carrier.type && position === -1) position = pos;
				});
				const nodeDom = editor.view.nodeDOM(position) as HTMLElement;

				editor.view.dispatch(
					editor.state.tr.setNodeMarkup(position, undefined, {
						...editor.state.doc.nodeAt(position)!.attrs,
						...carrier.nextAttrs,
					})
				);

				expect(editor.view.nodeDOM(position), carrier.type).toBe(nodeDom);
				const serialized = new DOMParser()
					.parseFromString(editor.getHTML(), 'text/html')
					.querySelector<HTMLElement>(carrier.selector)!;
				expect(renderingSignature(nodeDom), carrier.type).toEqual(
					renderingSignature(serialized)
				);
			} finally {
				editor.destroy();
			}
		}
	});

	it('round-trips every incremental carrier through renderHTML and parseHTML', () => {
		for (const carrier of incrementalCarrierCases) {
			const editor = createCarrierEditor(carrier);
			const html = editor.getHTML();
			const parsedEditor = ['lineBreak', 'columnBreak', 'pageBreak'].includes(carrier.type)
				? new Editor({ extensions: getCorrectionRenderExtensions() as any, content: html })
				: createTestEditor({ content: html as any });
			try {
				let original: Json | null = null;
				let parsed: Json | null = null;
				editor.state.doc.descendants(node => {
					if (node.type.name === carrier.type && original === null)
						original = node.toJSON();
				});
				parsedEditor.state.doc.descendants(node => {
					if (node.type.name === carrier.type && parsed === null) parsed = node.toJSON();
				});
				expect(parsed, carrier.type).toEqual(original);
			} finally {
				parsedEditor.destroy();
				editor.destroy();
			}
		}
	});

	it('copies a NodeView carrier through its renderHTML clipboard form', () => {
		const carrier = incrementalCarrierCases.find(candidate => candidate.type === 'gap')!;
		const editor = createCarrierEditor(carrier);
		try {
			let position = -1;
			editor.state.doc.descendants((node, pos) => {
				if (node.type.name === 'gap') position = pos;
			});
			editor.view.dispatch(
				editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, position))
			);
			const clipboardData = new DataTransfer();
			const event = new ClipboardEvent('copy', {
				bubbles: true,
				cancelable: true,
				clipboardData,
			});

			editor.view.dom.dispatchEvent(event);

			expect(event.defaultPrevented).toBe(true);
			expect(clipboardData.getData('text/html')).toContain(
				'<span data-reason="lost" data-unit="chars" data-extent="2"'
			);
			expect(clipboardData.getData('text/html')).toContain('class="gap-milestone');
		} finally {
			editor.destroy();
		}
	});

	it('does not dispatch a selection write while incrementally updating a carrier', () => {
		const carrier = incrementalCarrierCases.find(candidate => candidate.type === 'gap')!;
		const editor = createCarrierEditor(carrier);
		try {
			let position = -1;
			editor.state.doc.descendants((node, pos) => {
				if (node.type.name === 'gap') position = pos;
			});
			editor.view.dispatch(
				editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, position))
			);
			let transactions = 0;
			editor.on('transaction', () => {
				transactions += 1;
			});
			const transaction = editor.state.tr.setNodeMarkup(
				position,
				undefined,
				carrier.nextAttrs
			);
			const expectedSelection = transaction.selection.toJSON();

			editor.view.dispatch(transaction);

			expect(transactions).toBe(1);
			expect(editor.state.selection.toJSON()).toEqual(expectedSelection);
		} finally {
			editor.destroy();
		}
	});

	it('lets ProseMirror rebuild a NodeView for a different type or rendered shape', () => {
		const carrier = incrementalCarrierCases.find(candidate => candidate.type === 'gap')!;
		const typeEditor = createCarrierEditor(carrier);
		try {
			let position = -1;
			typeEditor.state.doc.descendants((node, pos) => {
				if (node.type.name === 'gap') position = pos;
			});
			const gapDom = typeEditor.view.nodeDOM(position);
			typeEditor.view.dispatch(
				typeEditor.state.tr.setNodeMarkup(position, typeEditor.schema.nodes.space, {
					teiAttrs: { extent: '1' },
				})
			);
			expect(typeEditor.view.nodeDOM(position)).not.toBe(gapDom);
			expect(typeEditor.view.nodeDOM(position)).toHaveClass('space-milestone');
		} finally {
			typeEditor.destroy();
		}

		const shapeCarrier = incrementalCarrierCases.find(
			candidate => candidate.type === 'teiAtom'
		)!;
		const shapeEditor = createCarrierEditor(shapeCarrier);
		try {
			let position = -1;
			shapeEditor.state.doc.descendants((node, pos) => {
				if (node.type.name === 'teiAtom') position = pos;
			});
			const noteDom = shapeEditor.view.nodeDOM(position);
			shapeEditor.view.dispatch(
				shapeEditor.state.tr.setNodeMarkup(position, undefined, {
					tag: 'gb',
					summary: 'gb:1',
					teiAttrs: { n: '1' },
				})
			);
			expect(shapeEditor.view.nodeDOM(position)).not.toBe(noteDom);
			expect(shapeEditor.view.nodeDOM(position)).toHaveAttribute('data-tag', 'gb');
		} finally {
			shapeEditor.destroy();
		}
	});

	it('keeps page, column, and line chrome outside their content DOM structure', () => {
		const editor = createTestEditor({
			content: editorDocument({
				pages: [
					{
						type: 'page',
						attrs: { pageId: 'page-1', pageName: '1r' },
						content: [
							{
								type: 'column',
								attrs: { columnId: 'column-1', zone: 'left' },
								content: [
									{
										type: 'line',
										attrs: { lineId: 'line-1', wrapped: true },
										content: [{ type: 'text', text: 'Alpha' }],
									},
								],
							},
						],
					},
				],
			}),
		});
		try {
			const page = editor.view.dom.querySelector<HTMLElement>('.page')!;
			const column = page.querySelector<HTMLElement>('.column')!;
			const line = column.querySelector<HTMLElement>('.line')!;

			expect(page.querySelector(':scope > [contenteditable="false"]')).toBeNull();
			expect(column.querySelector(':scope > [contenteditable="false"]')).toBeNull();
			expect(line.querySelector(':scope > [contenteditable="false"]')).toBeNull();
			expect(page.children).toHaveLength(1);
			expect(column.children).toHaveLength(1);
			expect(line.children).toHaveLength(1);
			expect(line.firstElementChild).toHaveClass('line-content');
			expect(page.dataset.pageName).toBe('1r');
			expect(column.dataset.columnLabel).toBe('Left Commentary');
			expect(line.dataset.wrapped).toBe('true');
		} finally {
			editor.destroy();
		}
	});

	it('keeps teiAttrs on marks that read them from the mark, not from HTMLAttributes', () => {
		const editor = createTestEditor({
			content: editorDocument({
				interestingLineContent: [
					markedText('alpha', 'damage', { teiAttrs: { agent: 'water' } }),
				],
			}),
		});
		try {
			const html = editor.getHTML();
			expect(html).toContain('data-tei-attrs="{&quot;agent&quot;:&quot;water&quot;}"');
		} finally {
			editor.destroy();
		}
	});

	it('keeps `lacunose` and `unclear` teiAttrs through HTML serialization and parsing', () => {
		for (const markType of ['lacunose', 'unclear']) {
			const editor = createTestEditor({
				content: editorDocument({
					interestingLineContent: [
						markedText('alpha', markType, {
							teiAttrs: { reason: 'lost', cert: 'low' },
						}),
					],
				}),
			});
			try {
				const html = editor.getHTML();
				expect(html).toContain(
					'data-tei-attrs="{&quot;reason&quot;:&quot;lost&quot;,&quot;cert&quot;:&quot;low&quot;}"'
				);

				const parsedEditor = createTestEditor({ content: html as any });
				let stored: unknown = null;
				parsedEditor.state.doc.descendants((node: any) => {
					const mark = node.marks.find(
						(candidate: any) => candidate.type.name === markType
					);
					if (mark) stored = mark.attrs.teiAttrs;
				});
				expect(stored).toEqual({ reason: 'lost', cert: 'low' });
				parsedEditor.destroy();
			} finally {
				editor.destroy();
			}
		}
	});

	it('renders correction, correctionNode and abbreviation deterministically', () => {
		const corrections = [{ hand: 'm2', content: [{ type: 'text', text: 'beta' }] }];
		const documents = [
			{
				type: 'correctionDoc',
				content: [markedText('alpha', 'correction', { corrections })],
			},
			{
				type: 'correctionDoc',
				content: [{ type: 'correctionNode', attrs: { corrections } }],
			},
			{
				type: 'correctionDoc',
				content: [
					markedText('alpha', 'abbreviation', { type: 'nomSac', expansion: 'alpha' }),
				],
			},
		];

		for (const document of documents) {
			const first = generateHTML(document, getCorrectionRenderExtensions() as any);
			const second = generateHTML(document, getCorrectionRenderExtensions() as any);
			expect(second).toBe(first);
			expect(first).not.toMatch(/data-(?:mark|node)-id=/);
		}
	});

	it('parses the rendered correction, correctionNode and abbreviation forms without changing them', () => {
		const corrections = [{ hand: 'm2', content: [{ type: 'text', text: 'beta' }] }];
		const documents = [
			{
				type: 'correctionDoc',
				content: [markedText('alpha', 'correction', { id: 'correction-1', corrections })],
			},
			{
				type: 'correctionDoc',
				content: [{ type: 'correctionNode', attrs: { id: 'node-1', corrections } }],
			},
			{
				type: 'correctionDoc',
				content: [
					markedText('alpha', 'abbreviation', {
						id: 'abbreviation-1',
						type: 'nomSac',
						expansion: 'alpha',
					}),
				],
			},
		];

		for (const document of documents) {
			const html = generateHTML(document, getCorrectionRenderExtensions() as any);
			const editor = new Editor({
				extensions: getCorrectionRenderExtensions() as any,
				content: html,
			});
			try {
				expect(editor.getHTML()).toBe(html);
			} finally {
				editor.destroy();
			}
		}
	});

	it('renders correction and abbreviation tooltips inline with neighbouring words', () => {
		for (const [markType, attrs] of [
			[
				'correction',
				{
					id: 'correction-id',
					corrections: [{ hand: 'm2', content: [{ type: 'text', text: 'beta' }] }],
				},
			],
			['abbreviation', { id: 'abbreviation-id', type: 'nomSac', expansion: 'alpha' }],
		] as const) {
			const editor = createTestEditor({
				content: editorDocument({
					interestingLineContent: [
						{ type: 'text', text: 'before ' },
						markedText('alpha', markType, attrs),
						{ type: 'text', text: ' after' },
					],
				}),
			});
			document.body.appendChild(editor.view.dom);
			try {
				const tooltip = editor.view.dom.querySelector<HTMLElement>(`.${markType}.tooltip`)!;
				expect(tooltip.tagName).toBe('SPAN');
				expect(getComputedStyle(tooltip).display).toBe('inline');

				const lineContent = tooltip.closest('.line-content')!;
				const neighbour = lineContent.firstChild!;
				const range = document.createRange();
				range.selectNode(neighbour);
				expect(Math.round(tooltip.getBoundingClientRect().top)).toBe(
					Math.round(range.getBoundingClientRect().top)
				);
			} finally {
				editor.view.dom.remove();
				editor.destroy();
			}
		}
	});

	it('lets CSS activate frame layout when a rendered column gains a zone', () => {
		const editor = createTestEditor({
			content: editorDocument({ interestingLineContent: [{ type: 'text', text: 'alpha' }] }),
		});
		try {
			const page = editor.view.dom.querySelector('.page')!;
			expect(page.querySelector('.frame-grid')).not.toBeNull();
			expect(page.querySelector('.frame-grid:has(> .column[data-zone])')).toBeNull();

			let columnPos = -1;
			editor.state.doc.descendants((node: any, pos: number) => {
				if (node.type.name === 'column' && columnPos === -1) columnPos = pos;
				return true;
			});
			editor.view.dispatch(
				editor.state.tr.setNodeMarkup(columnPos, undefined, {
					...editor.state.doc.nodeAt(columnPos)!.attrs,
					zone: 'center',
				})
			);

			expect(editor.view.dom.querySelector('.column[data-zone="center"]')).not.toBeNull();
			expect(page.querySelector('.frame-grid:has(> .column[data-zone])')).not.toBeNull();
		} finally {
			editor.destroy();
		}
	});
});
