import { fromProseMirror } from '@apatosaurus/tei-transcription';
import type { Editor } from '@tiptap/core';
import { DOMSerializer, Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { mount, unmount } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { importTEIDocument } from '$lib/tei/tei-importer';
import { editorPlainPage, transcriptionDocument } from '$lib/testing/editorFixtures';
import { mountTranscriptionEditor } from '$lib/testing/editorHarnesses.svelte';
import {
	coerceTranscriptionDocument,
	mergeWithCanonicalDocument,
	serializeTranscriptionDocument,
} from '$lib/transcription/content';
import witness2006Tei from '../../../static/igntp/Romans_Greek_transcriptions/NT_GRC_2006_Rom.xml?raw';
import { createColumnSplitTransaction } from './structure';

const { ensureLocalDbRuntime, updateTranscriptionContent } = vi.hoisted(() => ({
	ensureLocalDbRuntime: vi.fn(async () => undefined),
	updateTranscriptionContent: vi.fn(async (_input: { contentJson: string }) => undefined),
}));

vi.mock('$lib/db/client', () => ({
	createTranscription: vi.fn(),
	createTranscriptions: vi.fn(),
	ensureDefaultProject: vi.fn(),
	exportTranscriptionTei: vi.fn(),
	getTranscription: vi.fn(),
	listProjects: vi.fn(),
	updateTranscriptionMetadata: vi.fn(),
	updateTranscriptionContent,
}));
vi.mock('$lib/db/runtime', () => ({
	checkpointLocalDb: vi.fn(),
	ensureLocalDbRuntime,
}));

import TranscriptionEditor from './components/TranscriptionEditor.svelte';

const AUTOSAVE_DELAY_MS = 1000;

function wait(delayMs: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, delayMs));
}

async function waitForEditor(target: ParentNode): Promise<void> {
	const started = performance.now();
	while (!target.querySelector('.ProseMirror .page')) {
		if (performance.now() - started > 4000) throw new Error('editor mount timed out');
		await wait(16);
	}
}

async function mountEditor() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const component = mount(TranscriptionEditor, {
		target,
		props: {
			transcription: {
				id: 'autosave-spec',
				title: 'autosave spec',
				content_json: transcriptionDocument({}),
				format: 'normalized_ast_v3',
			} as any,
			data: {},
		},
	}) as Record<string, any>;
	await waitForEditor(target);
	return { component, target };
}

function editMountedDocument(target: ParentNode): void {
	const editorElement = target.querySelector<HTMLElement>('.ProseMirror');
	if (!editorElement) throw new Error('no mounted editor');
	const editor = (editorElement as any).editor;
	editor.view.dispatch(editor.state.tr.insertText('x'));
}

describe('transcription editor autosave', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		updateTranscriptionContent.mockResolvedValue(undefined);
	});

	it('does not save a clean document after mount', async () => {
		const { component, target } = await mountEditor();
		try {
			await wait(AUTOSAVE_DELAY_MS + 250);
			expect(updateTranscriptionContent).not.toHaveBeenCalled();
		} finally {
			await unmount(component);
			target.remove();
		}
	});

	it('flushes a pending edit through the public autosave interface', async () => {
		const { component, target } = await mountEditor();
		try {
			editMountedDocument(target);

			await expect(component.flushPendingAutosave()).resolves.toBe(true);
			expect(updateTranscriptionContent).toHaveBeenCalledOnce();
		} finally {
			await unmount(component);
			target.remove();
		}
	});

	it('flushes a pending edit when unmounted', async () => {
		const { component, target } = await mountEditor();
		editMountedDocument(target);

		await unmount(component);
		target.remove();
		await wait(0);

		expect(updateTranscriptionContent).toHaveBeenCalledOnce();
	});
});

function firstDifference(left: string, right: string): number {
	const length = Math.min(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		if (left[index] !== right[index]) return index;
	}
	return left.length === right.length ? -1 : length;
}

function contentPosition(editor: Editor, pageIndex: number): number {
	let pagePos = 0;
	for (let index = 0; index < pageIndex; index += 1) {
		pagePos += editor.state.doc.child(index).nodeSize;
	}
	let found = -1;
	editor.state.doc.child(pageIndex).descendants((node, pos) => {
		if (found !== -1) return false;
		if (node.isText) found = pagePos + 1 + pos + 1;
		return found === -1;
	});
	if (found !== -1) return found;
	let lineStart = -1;
	editor.state.doc.child(pageIndex).descendants((node, pos) => {
		if (lineStart === -1 && node.type.name === 'line') lineStart = pagePos + 1 + pos + 1;
		return lineStart === -1;
	});
	return lineStart;
}

function pagePosition(editor: Editor, pageIndex: number): number {
	let pos = 0;
	for (let index = 0; index < pageIndex; index += 1) {
		pos += editor.state.doc.child(index).nodeSize;
	}
	return pos;
}

describe('transcription editor cached autosave conversion', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		updateTranscriptionContent.mockResolvedValue(undefined);
	});

	it('saves the uncached conversion byte for byte across edits in witness 2006', async () => {
		const stored = coerceTranscriptionDocument(importTEIDocument(witness2006Tei))!;
		const harness = await mountTranscriptionEditor({
			id: 'autosave-cache-spec',
			document: structuredClone(stored),
		});
		const editor = (harness.container.querySelector('.ProseMirror') as any).editor as Editor;
		const { view } = editor;

		// Seeds generated page ids identically for the cached save and its oracle.
		const withSeededIds = <T>(run: () => T): T => {
			let next = 0;
			const spy = vi
				.spyOn(crypto, 'randomUUID')
				.mockImplementation(
					() => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}` as any
				);
			try {
				return run();
			} finally {
				spy.mockRestore();
			}
		};
		let previousSaved = '';
		const expectSavedAsUncached = async (label: string) => {
			updateTranscriptionContent.mockClear();
			const flushed = withSeededIds(() => harness.component.flushPendingAutosave());
			await expect(flushed, label).resolves.toBe(true);
			expect(updateTranscriptionContent, label).toHaveBeenCalledOnce();
			const saved = updateTranscriptionContent.mock.calls[0][0].contentJson;
			const oracle = withSeededIds(() =>
				serializeTranscriptionDocument(
					mergeWithCanonicalDocument(stored, fromProseMirror(editor.getJSON() as any))
				)
			);
			expect(firstDifference(saved, oracle), label).toBe(-1);
			expect(saved === previousSaved, `${label} changed the document`).toBe(false);
			previousSaved = saved;
		};
		const placeCursor = (pos: number) =>
			view.dispatch(
				view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos)))
			);
		const typeAt = (pos: number, text: string) => {
			placeCursor(pos);
			for (const character of text) {
				const { from } = view.state.selection;
				view.dispatch(view.state.tr.insertText(character, from, from));
			}
		};

		try {
			const middle = Math.floor(editor.state.doc.childCount / 2);
			expect(editor.state.doc.childCount).toBeGreaterThan(500);

			typeAt(contentPosition(editor, middle), 'αβγ δ');
			await expectSavedAsUncached('typing in the middle page');

			typeAt(contentPosition(editor, editor.state.doc.childCount - 1), 'ε');
			typeAt(contentPosition(editor, 0), 'ζη');
			await expectSavedAsUncached('typing on the first and last pages');

			const page = editor.schema.nodeFromJSON(
				editorPlainPage({ pageId: 'page-inserted', pageName: 'new' })
			);
			const unidentifiedPage = page.type.create(
				{ ...page.attrs, pageId: null },
				page.content
			);
			view.dispatch(
				view.state.tr.insert(
					pagePosition(editor, 10),
					Fragment.from([page, unidentifiedPage])
				)
			);
			await expectSavedAsUncached('inserting pages with and without an id');

			typeAt(contentPosition(editor, 11), 'θ');
			await expectSavedAsUncached('typing in an inserted page');

			view.dispatch(
				view.state.tr.insert(
					pagePosition(editor, 11),
					page.type.create({ ...page.attrs, pageId: null }, page.content)
				)
			);
			await expectSavedAsUncached('inserting another page without an id before it');

			const deleted = pagePosition(editor, 20);
			view.dispatch(
				view.state.tr.delete(deleted, deleted + editor.state.doc.child(20).nodeSize)
			);
			await expectSavedAsUncached('deleting a page');

			placeCursor(contentPosition(editor, middle) + 2);
			editor.commands.keyboardShortcut('Enter');
			await expectSavedAsUncached('splitting a line');

			placeCursor(contentPosition(editor, middle + 1) + 1);
			const columnSplit = createColumnSplitTransaction(view.state);
			expect(columnSplit).not.toBeNull();
			view.dispatch(columnSplit!);
			await expectSavedAsUncached('splitting a column');

			placeCursor(contentPosition(editor, middle + 2));
			view.pasteText('παστε λογος');
			await expectSavedAsUncached('pasting text');

			const copied = document.createElement('div');
			copied.appendChild(
				DOMSerializer.fromSchema(editor.schema).serializeFragment(
					Fragment.from(editor.state.doc.child(middle + 3))
				)
			);
			view.dispatch(
				view.state.tr.setSelection(
					TextSelection.near(view.state.doc.resolve(pagePosition(editor, middle + 3)))
				)
			);
			view.pasteHTML(copied.innerHTML);
			await expectSavedAsUncached('pasting a page');

			for (let step = 0; step < 4; step += 1) editor.commands.undo();
			await expectSavedAsUncached('undoing');

			editor.commands.redo();
			await expectSavedAsUncached('redoing');
		} finally {
			harness.dispose();
		}
	}, 180_000);
});
