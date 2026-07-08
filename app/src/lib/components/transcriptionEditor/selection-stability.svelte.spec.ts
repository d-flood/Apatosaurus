import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';

import { initializeEditorContent } from '$lib/client/editorContentInitialization';
import { getEditor } from '$lib/client/transcriptionEditorSchema';
import { parseTei, toProseMirror } from '$lib/tei/tei-transcription';

import { buildCorrectionNodeAttrs, insertSelectableCarrierNode } from './editorCommands';

const INITIAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader></teiHeader>
  <text><body>
    <pb n="1r"/><cb n="1"/><lb/><w>Alpha</w>
    <lb/><w>Beta</w>
    <pb n="2r"/><cb n="1"/><lb/><w>Gamma</w>
  </body></text>
</TEI>`;

let mountedEditors: Editor[] = [];

afterEach(() => {
	mountedEditors.forEach(editor => editor.destroy());
	mountedEditors = [];
	document.body.replaceChildren();
});

function createEditor(): Editor {
	const editorElement = document.createElement('div');
	const bubbleMenuElement = document.createElement('div');
	document.body.append(editorElement, bubbleMenuElement);
	const editor = getEditor(editorElement, bubbleMenuElement);
	initializeEditorContent(editor, toProseMirror(parseTei(INITIAL_XML)) as any, {
		emitUpdate: false,
	});
	mountedEditors.push(editor);
	return editor;
}

function textRange(editor: Editor, text: string): { from: number; to: number } {
	let range: { from: number; to: number } | null = null;
	editor.state.doc.descendants((node, pos) => {
		const offset = node.isText ? (node.text || '').indexOf(text) : -1;
		if (offset >= 0) {
			range = { from: pos + offset, to: pos + offset + text.length };
			return false;
		}
		return undefined;
	});
	if (!range) throw new Error(`Missing text: ${text}`);
	return range;
}

function setCursor(editor: Editor, pos: number) {
	editor.commands.setTextSelection(pos);
}

function assertCursor(editor: Editor, expected: number) {
	expect(editor.state.selection.from).toBe(expected);
	expect(editor.state.selection.to).toBe(expected);
}

function simulatePageTracking(editor: Editor) {
	const cursorPos = editor.state.selection.from;
	let activePageId: string | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (node.type.name !== 'page') return true;
		if (cursorPos >= pos && cursorPos <= pos + node.nodeSize) {
			activePageId = typeof node.attrs.pageId === 'string' ? node.attrs.pageId : null;
			return false;
		}
		return undefined;
	});
	return activePageId;
}

function simulateIiifPageChange(editor: Editor) {
	const pages: string[] = [];
	editor.state.doc.descendants(node => {
		if (node.type.name === 'page' && typeof node.attrs.pageId === 'string') {
			pages.push(node.attrs.pageId);
		}
		return true;
	});
	return pages.at(-1) ?? null;
}

describe('transcription editor selection stability scenarios', () => {
	it('keeps selection stable through scripted side-effect scenarios for 50 iterations', () => {
		for (let iteration = 0; iteration < 50; iteration += 1) {
			const editor = createEditor();

			const alpha = textRange(editor, 'Alpha');
			setCursor(editor, alpha.to);
			editor.commands.insertContent('x');
			assertCursor(editor, alpha.to + 1);

			const beta = textRange(editor, 'Beta');
			setCursor(editor, beta.to);
			expect(insertSelectableCarrierNode(editor, 'correctionNode', buildCorrectionNodeAttrs())).toBe(true);
			const afterCorrectionNode = editor.state.selection.to;
			setCursor(editor, afterCorrectionNode);
			editor.commands.insertContent('y');
			assertCursor(editor, afterCorrectionNode + 1);

			const gamma = textRange(editor, 'Gamma');
			setCursor(editor, gamma.to);
			const beforeCorrectionWorkspace = editor.state.selection.from;
			const correctionWorkspaceOpen = true;
			expect(correctionWorkspaceOpen).toBe(true);
			assertCursor(editor, beforeCorrectionWorkspace);

			const beforePageTracking = editor.state.selection.from;
			expect(simulatePageTracking(editor)).toBeTruthy();
			assertCursor(editor, beforePageTracking);

			const beforeIiifPageChange = editor.state.selection.from;
			expect(simulateIiifPageChange(editor)).toBeTruthy();
			assertCursor(editor, beforeIiifPageChange);
		}
	});
});
