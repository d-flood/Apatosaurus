import { describe, expect, it } from 'vitest';

import {
	editorColumn,
	editorDocument,
	editorLine,
	editorPlainPage,
} from '$lib/client/testing/editorFixtures';
import { createTestEditor } from '$lib/client/testing/editorHarnesses.svelte';

import {
	applyAbbreviationMark,
	applyCorrectionMark,
	captureAbbreviationTarget,
	captureCorrectionTarget,
	removeCorrectionMark,
} from './editorInteractions';

const CORRECTIONS = [
	{
		hand: 'corrector',
		content: [{ type: 'text', text: 'alfa' }],
	},
];

function createEditor(content: Record<string, any>[]) {
	return createTestEditor({
		content: editorDocument({
			pages: [
				editorPlainPage({
					columns: [editorColumn({ lines: [editorLine({ content })] })],
				}),
			],
		}),
	});
}

function selectSubstring(editor: any, nodeText: string, substring: string) {
	let textPosition = -1;
	editor.state.doc.descendants((node: any, position: number) => {
		if (textPosition !== -1) return false;
		if (node.isText && node.text === nodeText) textPosition = position;
		return true;
	});
	if (textPosition === -1) throw new Error(`no text node "${nodeText}"`);
	const offset = nodeText.indexOf(substring);
	if (offset === -1) throw new Error(`"${substring}" is not in "${nodeText}"`);
	editor.commands.setTextSelection({
		from: textPosition + offset,
		to: textPosition + offset + substring.length,
	});
}

function textMarks(editor: any) {
	const result: Array<{ text: string; correction: boolean; punctuation: boolean }> = [];
	editor.state.doc.descendants((node: any) => {
		if (!node.isText) return true;
		result.push({
			text: node.text,
			correction: node.marks.some((mark: any) => mark.type.name === 'correction'),
			punctuation: node.marks.some((mark: any) => mark.type.name === 'punctuation'),
		});
		return true;
	});
	return result;
}

describe('word-level correction interactions', () => {
	it('assigns identity when creating correction and abbreviation marks', () => {
		const editor = createEditor([{ type: 'text', text: 'alpha' }]);
		selectSubstring(editor, 'alpha', 'alpha');

		expect(applyCorrectionMark(editor, captureCorrectionTarget(editor), CORRECTIONS)).toBe(
			true
		);
		selectSubstring(editor, 'alpha', 'alpha');
		expect(
			applyAbbreviationMark(editor, captureAbbreviationTarget(editor), {
				type: 'nomSac',
				expansion: 'alpha',
				rend: '¯',
			})
		).toBe(true);

		const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, ' ');
		expect(text).toContain('alpha');
		let ids: string[] = [];
		editor.state.doc.descendants((node: any) => {
			if (!node.isText) return;
			ids = node.marks
				.filter((mark: any) => ['correction', 'abbreviation'].includes(mark.type.name))
				.map((mark: any) => mark.attrs.id);
		});
		expect(ids).toHaveLength(2);
		expect(ids.every(id => typeof id === 'string' && id.length === 8)).toBe(true);
	});

	it('expands a partial-word selection to the complete word', () => {
		const editor = createEditor([{ type: 'text', text: 'before alpha after' }]);
		selectSubstring(editor, 'before alpha after', 'ph');

		expect(applyCorrectionMark(editor, captureCorrectionTarget(editor), CORRECTIONS)).toBe(
			true
		);
		expect(textMarks(editor)).toContainEqual({
			text: 'alpha',
			correction: true,
			punctuation: false,
		});
		expect(textMarks(editor).filter(node => node.correction)).toHaveLength(1);
	});

	it('does not absorb adjacent punctuation into the word-level correction', () => {
		const editor = createEditor([
			{ type: 'text', text: 'alpha' },
			{ type: 'text', text: '.', marks: [{ type: 'punctuation' }] },
		]);
		selectSubstring(editor, 'alpha', 'ph');

		expect(applyCorrectionMark(editor, captureCorrectionTarget(editor), CORRECTIONS)).toBe(
			true
		);
		expect(textMarks(editor)).toEqual([
			{ text: 'alpha', correction: true, punctuation: false },
			{ text: '.', correction: false, punctuation: true },
		]);
	});

	it('completes both endpoint words of a multi-word selection', () => {
		const editor = createEditor([{ type: 'text', text: 'before alpha beta after' }]);
		selectSubstring(editor, 'before alpha beta after', 'pha be');

		expect(applyCorrectionMark(editor, captureCorrectionTarget(editor), CORRECTIONS)).toBe(
			true
		);
		expect(
			textMarks(editor)
				.filter(node => node.correction)
				.map(node => node.text)
				.join('')
		).toBe('alpha beta');
	});

	it('removes the complete word-level correction from a partial selection', () => {
		const editor = createEditor([
			{
				type: 'text',
				text: 'alpha',
				marks: [{ type: 'correction', attrs: { corrections: CORRECTIONS } }],
			},
		]);
		selectSubstring(editor, 'alpha', 'ph');

		expect(removeCorrectionMark(editor, captureCorrectionTarget(editor))).toBe(true);
		expect(textMarks(editor)).toEqual([
			{ text: 'alpha', correction: false, punctuation: false },
		]);
	});

	it('applies a correction to the range captured when the drawer opened', () => {
		const editor = createEditor([{ type: 'text', text: 'alpha beta' }]);
		selectSubstring(editor, 'alpha beta', 'alpha');
		const target = captureCorrectionTarget(editor);
		selectSubstring(editor, 'alpha beta', 'beta');

		expect(applyCorrectionMark(editor, target, CORRECTIONS)).toBe(true);
		expect(
			textMarks(editor)
				.filter(node => node.correction)
				.map(node => node.text)
		).toEqual(['alpha']);
	});

	it('removes the correction captured when the drawer opened, not one under the new selection', () => {
		const editor = createEditor([
			{
				type: 'text',
				text: 'alpha',
				marks: [
					{ type: 'correction', attrs: { id: 'alpha-mark', corrections: CORRECTIONS } },
				],
			},
			{ type: 'text', text: ' ' },
			{
				type: 'text',
				text: 'beta',
				marks: [
					{ type: 'correction', attrs: { id: 'beta-mark', corrections: CORRECTIONS } },
				],
			},
		]);
		selectSubstring(editor, 'alpha', 'alpha');
		const target = captureCorrectionTarget(editor);
		selectSubstring(editor, 'beta', 'beta');

		expect(removeCorrectionMark(editor, target)).toBe(true);
		expect(
			textMarks(editor)
				.filter(node => node.correction)
				.map(node => node.text)
		).toEqual(['beta']);
	});
});
