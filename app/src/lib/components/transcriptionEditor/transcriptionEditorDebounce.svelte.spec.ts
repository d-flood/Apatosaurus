import { mount, unmount } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { transcriptionDocument } from '$lib/client/testing/editorFixtures';

const { syncVerseIndexFromDocument } = vi.hoisted(() => ({
	syncVerseIndexFromDocument: vi.fn(async () => undefined),
}));

vi.mock('$lib/client/transcription/verse-index', () => ({ syncVerseIndexFromDocument }));

import TranscriptionEditor from './TranscriptionEditor.svelte';

const VERSE_INDEX_SYNC_DELAY_MS = 1200;

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

async function mountEditor(attached: boolean) {
	const target = document.createElement('div');
	if (attached) document.body.appendChild(target);
	const component = mount(TranscriptionEditor, {
		target,
		props: {
			transcription: {
				id: 'debounce-spec',
				title: 'debounce spec',
				content_json: transcriptionDocument({}),
				format: 'normalized_ast_v3',
			} as any,
			data: {},
		},
	});
	await waitForEditor(target);
	return { component, target };
}

describe('transcription editor verse-index sync lifecycle', () => {
	beforeEach(() => {
		syncVerseIndexFromDocument.mockClear();
	});

	it('drops a pending sync when unmounted through the modal cleanup path', async () => {
		const { component, target } = await mountEditor(true);
		expect(document.getElementById('transcription-metadata-modal')).not.toBeNull();

		await unmount(component);
		target.remove();
		await wait(VERSE_INDEX_SYNC_DELAY_MS + 100);

		expect(syncVerseIndexFromDocument).not.toHaveBeenCalled();
	});

	it('drops a pending sync when unmounted through the cleanup path without a modal', async () => {
		const { component } = await mountEditor(false);
		expect(document.getElementById('transcription-metadata-modal')).toBeNull();

		await unmount(component);
		await wait(VERSE_INDEX_SYNC_DELAY_MS + 100);

		expect(syncVerseIndexFromDocument).not.toHaveBeenCalled();
	});

	it('syncs an edited document on the existing interval', async () => {
		const { component, target } = await mountEditor(true);
		try {
			await wait(VERSE_INDEX_SYNC_DELAY_MS + 100);
			syncVerseIndexFromDocument.mockClear();

			const editorElement = target.querySelector<HTMLElement>('.ProseMirror');
			if (!editorElement) throw new Error('no mounted editor');
			const editor = (editorElement as any).editor;
			editor.view.dispatch(editor.state.tr.insertText('x'));

			await wait(VERSE_INDEX_SYNC_DELAY_MS - 100);
			expect(syncVerseIndexFromDocument).not.toHaveBeenCalled();
			await wait(200);
			expect(syncVerseIndexFromDocument).toHaveBeenCalledOnce();
			expect(syncVerseIndexFromDocument).toHaveBeenCalledWith(
				'debounce-spec',
				expect.objectContaining({ type: 'transcriptionDocument' })
			);
		} finally {
			await unmount(component);
			target.remove();
		}
	});
});
