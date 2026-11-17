import { page } from '@vitest/browser/context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { transcriptionDocument } from '$lib/testing/editorFixtures';
import { waitFor } from '$lib/testing/editorHarnesses.svelte';

const mocks = vi.hoisted(() => ({
	emit: (_domain: string) => {},
	saveResults: [] as Array<{ verseSetChanged: boolean; external?: boolean }>,
	getTranscription: vi.fn(),
	getProjectTranscriptionStatusForOwnedTranscription: vi.fn(async () => null),
	listDocumentFileProblems: vi.fn(async () => []),
	listVerseIndexRowsForTranscription: vi.fn(async () => [
		{
			id: 1,
			transcription_id: 'route-spec',
			verse_identifier: 'B06K1V1',
			book: 'B06',
			chapter: '1',
			verse: '1',
		},
	]),
	updateTranscriptionContent: vi.fn(),
}));

vi.mock('$app/state', () => ({
	page: {
		params: { id: 'route-spec' },
		url: new URL('http://localhost/transcription/route-spec'),
	},
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/db/runtime', () => ({
	ensureLocalDbRuntime: vi.fn(async () => undefined),
	getLocalDbWorker: vi.fn(),
	checkpointLocalDb: vi.fn(),
	markIndexVerified: vi.fn(),
	reportRuntimeInitFailure: vi.fn(),
}));
vi.mock('$lib/db/client', async importOriginal => {
	const actual = await importOriginal<typeof import('$lib/db/client')>();
	mocks.emit = actual.emitLocalDbInvalidation;
	return {
		...actual,
		getTranscription: mocks.getTranscription,
		getProjectTranscriptionStatusForOwnedTranscription:
			mocks.getProjectTranscriptionStatusForOwnedTranscription,
		listDocumentFileProblems: mocks.listDocumentFileProblems,
		listVerseIndexRowsForTranscription: mocks.listVerseIndexRowsForTranscription,
		updateTranscriptionContent: mocks.updateTranscriptionContent,
	};
});

import Page from './+page.svelte';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Mirrors the worker: a save's invalidation reaches the page before its reply.
mocks.updateTranscriptionContent.mockImplementation(async () => {
	const result = mocks.saveResults.shift() ?? { verseSetChanged: false };
	await wait(20);
	if (result.external) mocks.emit('transcriptions');
	mocks.emit('transcriptions');
	await wait(20);
	return { verseSetChanged: result.verseSetChanged };
});

function requestCounts() {
	return {
		content: mocks.getTranscription.mock.calls.length,
		verseRows: mocks.listVerseIndexRowsForTranscription.mock.calls.length,
		status: mocks.getProjectTranscriptionStatusForOwnedTranscription.mock.calls.length,
	};
}

async function renderPage() {
	const screen = render(Page, { data: {} } as any);
	const editorElement = await waitFor(
		() => screen.container.querySelector<HTMLElement>('.ProseMirror'),
		10_000
	);
	await waitFor(() => screen.container.querySelector('.ProseMirror .page'));
	await waitFor(() => requestCounts().verseRows > 0 && requestCounts().status > 0);
	return (editorElement as any).editor;
}

async function autosave(editor: any) {
	const saves = mocks.updateTranscriptionContent.mock.calls.length;
	editor.view.dispatch(editor.state.tr.insertText('x', 3));
	await waitFor(() => mocks.updateTranscriptionContent.mock.calls.length > saves, 5000);
	await mocks.updateTranscriptionContent.mock.results.at(-1)!.value;
	await wait(100);
}

describe('/transcription/[id] own-save echo', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.saveResults = [];
		mocks.getTranscription.mockResolvedValue({
			id: 'route-spec',
			title: 'Route spec',
			content_json: JSON.stringify(transcriptionDocument({})),
			format: 'normalized_ast_v3',
			updated_at: '2026-01-01T00:00:00.000Z',
		});
	});

	it('refreshes only Version status after its own autosave', async () => {
		const editor = await renderPage();
		const before = requestCounts();

		await autosave(editor);

		expect(requestCounts()).toEqual({ ...before, status: before.status + 1 });
		await expect.element(page.getByText('Saved locally just now')).toBeInTheDocument();
	});

	it('reloads verse rows when its own save changed the verse set', async () => {
		const editor = await renderPage();
		const before = requestCounts();
		mocks.saveResults.push({ verseSetChanged: true });

		await autosave(editor);

		expect(requestCounts()).toEqual({
			content: before.content,
			verseRows: before.verseRows + 1,
			status: before.status + 1,
		});
	});

	it('reloads content and verse rows for an invalidation that is not its own', async () => {
		await renderPage();
		const before = requestCounts();

		mocks.emit('transcriptions');

		await waitFor(() => requestCounts().content > before.content);
		await waitFor(() => requestCounts().verseRows > before.verseRows);
		expect(requestCounts().status).toBe(before.status + 1);
	});

	it('reloads after its own save settles when an external change lands during it', async () => {
		const editor = await renderPage();
		const before = requestCounts();
		mocks.saveResults.push({ verseSetChanged: false, external: true });

		await autosave(editor);

		expect(requestCounts().content).toBe(before.content + 1);
		expect(requestCounts().verseRows).toBe(before.verseRows + 1);
	});
});
