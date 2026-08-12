import { mount, unmount } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { transcriptionDocument } from '$lib/client/testing/editorFixtures';

const { ensureLocalDbRuntime, updateTranscriptionContent } = vi.hoisted(() => ({
	ensureLocalDbRuntime: vi.fn(async () => undefined),
	updateTranscriptionContent: vi.fn(async () => undefined),
}));

vi.mock('$lib/client/db/client', () => ({
	createTranscription: vi.fn(),
	createTranscriptions: vi.fn(),
	ensureDefaultProject: vi.fn(),
	getTranscription: vi.fn(),
	listProjects: vi.fn(),
	updateTranscriptionMetadata: vi.fn(),
	updateTranscriptionContent,
}));
vi.mock('$lib/client/db/runtime', () => ({
	checkpointLocalDb: vi.fn(),
	ensureLocalDbRuntime,
}));

import TranscriptionEditor from './TranscriptionEditor.svelte';

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

	it('saves one canonical document after an edit and the autosave delay', async () => {
		const { component, target } = await mountEditor();
		try {
			editMountedDocument(target);
			await wait(AUTOSAVE_DELAY_MS - 100);
			expect(updateTranscriptionContent).not.toHaveBeenCalled();
			await wait(200);

			expect(updateTranscriptionContent).toHaveBeenCalledOnce();
			expect(updateTranscriptionContent).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'autosave-spec',
					document: expect.objectContaining({ type: 'transcriptionDocument' }),
				})
			);
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
