import { cdp, userEvent } from '@vitest/browser/context';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';

import {
	editorColumn,
	editorDocument,
	editorLine,
	editorPlainPage,
	transcriptionDocument,
	transcriptionPlainPage,
} from '$lib/client/testing/editorFixtures';
import {
	createTestEditor,
	lineElement,
	mountTranscriptionEditor,
	tick,
} from '$lib/client/testing/editorHarnesses.svelte';

function editorFrom(container: ParentNode) {
	const editorElement = container.querySelector<HTMLElement>('.ProseMirror');
	if (!editorElement) throw new Error('no mounted editor');
	return (editorElement as any).editor;
}

function contentOf(line: HTMLElement): HTMLElement {
	const content = line.querySelector<HTMLElement>('.line-content');
	if (!content) throw new Error('line has no editable content');
	return content;
}

function selectedText(editor: any): string {
	return editor.state.doc.textBetween(
		editor.state.selection.from,
		editor.state.selection.to,
		'\n'
	);
}

function selectedLineIndex(editor: any): number | null {
	const position = editor.state.selection.$from;
	for (let depth = position.depth; depth > 0; depth -= 1) {
		if (position.node(depth).type.name === 'line') {
			return position.index(depth - 1) + 1;
		}
	}
	return null;
}

function textPoint(element: HTMLElement, offset: number): { x: number; y: number } {
	const text = element.firstChild;
	if (!(text instanceof Text)) throw new Error('editable content does not start with text');
	const range = document.createRange();
	range.setStart(text, offset);
	range.setEnd(text, offset);
	const rect = range.getBoundingClientRect();
	let x = rect.left;
	let y = rect.top + rect.height / 2;
	let currentWindow: Window = window;
	while (currentWindow.frameElement) {
		const frameRect = currentWindow.frameElement.getBoundingClientRect();
		x += frameRect.left;
		y += frameRect.top;
		currentWindow = currentWindow.parent;
	}
	return { x, y };
}

function elementPoint(element: HTMLElement, xOffset: number, yOffset: number) {
	const rect = element.getBoundingClientRect();
	let x = rect.left + xOffset;
	let y = rect.top + yOffset;
	let currentWindow: Window = window;
	while (currentWindow.frameElement) {
		const frameRect = currentWindow.frameElement.getBoundingClientRect();
		x += frameRect.left;
		y += frameRect.top;
		currentWindow = currentWindow.parent;
	}
	return { x, y };
}

async function clickElement(element: HTMLElement, horizontalRatio = 0.5) {
	await userEvent.click(element, {
		position: {
			x: element.clientWidth * horizontalRatio,
			y: element.clientHeight / 2,
		},
	});
}

async function dragPointer(from: { x: number; y: number }, to: { x: number; y: number }) {
	const session = cdp() as {
		send(method: string, params: Record<string, unknown>): Promise<unknown>;
	};
	await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from });
	await session.send('Input.dispatchMouseEvent', {
		type: 'mousePressed',
		button: 'left',
		buttons: 1,
		clickCount: 1,
		...from,
	});
	await session.send('Input.dispatchMouseEvent', {
		type: 'mouseMoved',
		button: 'left',
		buttons: 1,
		...to,
	});
	await session.send('Input.dispatchMouseEvent', {
		type: 'mouseReleased',
		button: 'left',
		buttons: 0,
		clickCount: 1,
		...to,
	});
}

async function clickPointer(at: { x: number; y: number }) {
	const session = cdp() as {
		send(method: string, params: Record<string, unknown>): Promise<unknown>;
	};
	await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
	await session.send('Input.dispatchMouseEvent', {
		type: 'mousePressed',
		button: 'left',
		buttons: 1,
		clickCount: 1,
		...at,
	});
	await session.send('Input.dispatchMouseEvent', {
		type: 'mouseReleased',
		button: 'left',
		buttons: 0,
		clickCount: 1,
		...at,
	});
}

describe('native selection and drop behaviour', () => {
	it('places the caret at the end of a line when its trailing area is clicked', async () => {
		const harness = await mountTranscriptionEditor({
			document: transcriptionDocument({
				pages: [transcriptionPlainPage({ texts: [['alpha', 'beta']] })],
			}),
			id: 'native-click-trailing-area',
		});
		try {
			const line = lineElement(harness.container, 0, 0, 0);
			const content = contentOf(line);
			const editor = editorFrom(harness.container);
			const expectedPosition = editor.view.posAtDOM(content, content.childNodes.length);
			const lineRect = line.getBoundingClientRect();
			const clickCoordinates = {
				left: lineRect.left + line.clientWidth * 0.9,
				top: lineRect.top + line.clientHeight / 2,
			};
			const hitTestPosition = editor.view.posAtCoords(clickCoordinates)?.pos;

			await clickElement(line, 0.9);
			await tick();

			expect(editor.state.selection.from).toBe(expectedPosition);
			expect(editor.state.selection.from).toBe(hitTestPosition);
		} finally {
			harness.dispose();
		}
	});

	it('leaves the caret unchanged when the line-number gutter is clicked', async () => {
		const harness = await mountTranscriptionEditor({
			document: transcriptionDocument({
				pages: [transcriptionPlainPage({ texts: [['alpha', 'beta']] })],
			}),
			id: 'native-click-gutter',
		});
		try {
			const firstLine = lineElement(harness.container, 0, 0, 0);
			const secondContent = contentOf(lineElement(harness.container, 0, 0, 1));
			const editor = editorFrom(harness.container);
			const originalPosition = editor.view.posAtDOM(secondContent, 0);
			editor.commands.setTextSelection(originalPosition);

			await clickPointer(elementPoint(firstLine, 8, firstLine.clientHeight / 2));
			await tick();

			expect(editor.state.selection.from).toBe(originalPosition);
		} finally {
			harness.dispose();
		}
	});

	it('places the caret in an empty line when it is clicked', async () => {
		const harness = await mountTranscriptionEditor({
			document: transcriptionDocument({
				pages: [transcriptionPlainPage({ texts: [['alpha', '', 'beta']] })],
			}),
			id: 'native-click-empty-line',
		});
		try {
			const emptyLine = lineElement(harness.container, 0, 0, 1);
			const editor = editorFrom(harness.container);

			await clickElement(emptyLine, 0.9);
			await tick();

			expect(selectedLineIndex(editor)).toBe(2);
		} finally {
			harness.dispose();
		}
	});

	it('drag-selects within and across lines and opens the selection toolbar', async () => {
		const harness = await mountTranscriptionEditor({
			document: transcriptionDocument({
				pages: [transcriptionPlainPage({ texts: [['alpha beta', 'gamma delta']] })],
			}),
			id: 'workaround-drag-selection',
		});
		try {
			const first = contentOf(lineElement(harness.container, 0, 0, 0));
			const second = contentOf(lineElement(harness.container, 0, 0, 1));
			const editor = editorFrom(harness.container);

			await dragPointer(textPoint(first, 1), textPoint(first, first.textContent!.length - 1));
			await tick();
			expect(selectedText(editor)).not.toBe('');

			await dragPointer(textPoint(first, 0), textPoint(second, second.textContent!.length));
			await tick();
			expect(selectedText(editor)).toContain('alpha beta');
			expect(selectedText(editor)).toContain('gamma delta');

			const toolbar = harness.container.querySelector<HTMLElement>(
				'[aria-label="Selection formatting"]'
			);
			expect(toolbar).not.toBeNull();
			expect(toolbar!.getBoundingClientRect().width).toBeGreaterThan(0);
		} finally {
			harness.dispose();
		}
	});

	it('moves selected text within the editor and accepts external text', async () => {
		const harness = await mountTranscriptionEditor({
			document: transcriptionDocument({
				pages: [transcriptionPlainPage({ texts: [['alpha', 'beta', 'gamma']] })],
			}),
			id: 'workaround-drops',
		});
		const external = document.createElement('div');
		external.textContent = 'external';
		external.draggable = true;
		external.addEventListener('dragstart', event => {
			event.dataTransfer?.setData('text/plain', 'external');
		});
		document.body.appendChild(external);
		try {
			const first = contentOf(lineElement(harness.container, 0, 0, 0));
			const second = contentOf(lineElement(harness.container, 0, 0, 1));
			const third = contentOf(lineElement(harness.container, 0, 0, 2));
			const editor = editorFrom(harness.container);
			let textPosition = -1;
			editor.state.doc.descendants((node: any, position: number) => {
				if (textPosition === -1 && node.isText && node.text === 'alpha')
					textPosition = position;
			});
			editor.commands.setTextSelection({ from: textPosition, to: textPosition + 5 });
			editor.commands.focus();

			await userEvent.dragAndDrop(first, second);
			await tick();
			expect(first.textContent).toBe('');
			expect(second.textContent).toContain('alpha');
			expect(second.textContent!.replace('alpha', '')).toBe('beta');

			await userEvent.dragAndDrop(external, third);
			await tick();
			expect(third.textContent).toContain('external');
			expect(third.textContent!.replace('external', '')).toBe('gamma');
		} finally {
			external.remove();
			harness.dispose();
		}
	});
});

describe('typing the first character into an empty line', () => {
	for (const scenario of [
		{ name: 'a single-line column', texts: [''], lineIndex: 0 },
		{ name: 'the middle of a multi-line column', texts: ['before', '', 'after'], lineIndex: 1 },
	]) {
		it(`works in ${scenario.name} without producing an appended transaction`, async () => {
			const editor = createTestEditor({
				attach: true,
				content: editorDocument({
					pages: [
						editorPlainPage({
							columns: [
								editorColumn({
									lines: scenario.texts.map((text, index) =>
										editorLine({
											text,
											lineId: `line-${index + 1}`,
										})
									),
								}),
							],
						}),
					],
				}),
			});
			const transactionBatchSizes: number[] = [];
			editor.registerPlugin(
				new Plugin({
					key: new PluginKey(`empty-line-observer-${scenario.lineIndex}`),
					appendTransaction(transactions) {
						transactionBatchSizes.push(transactions.length);
						return null;
					},
				})
			);
			const root = editor.view.dom;
			const host = root.parentElement;
			const bubbleMenu = host?.nextElementSibling;
			try {
				const line = root.querySelectorAll<HTMLElement>('.line')[scenario.lineIndex];
				const content = contentOf(line);
				editor.commands.setTextSelection(editor.view.posAtDOM(content, 0));
				editor.commands.focus();
				transactionBatchSizes.length = 0;

				await userEvent.keyboard('x');
				await tick();

				expect(
					scenario.texts.map(
						(_, index) =>
							contentOf(root.querySelectorAll<HTMLElement>('.line')[index])
								.textContent
					)
				).toEqual(
					scenario.texts.map((text, index) => (index === scenario.lineIndex ? 'x' : text))
				);
				expect(editor.state.selection.$from.parent.type.name).toBe('line');
				expect(editor.state.selection.$from.parentOffset).toBe(1);
				expect(transactionBatchSizes.length).toBeGreaterThan(0);
				expect(transactionBatchSizes.every(size => size === 1)).toBe(true);
			} finally {
				editor.destroy();
				host?.remove();
				bubbleMenu?.remove();
			}
		});
	}
});
