import { page } from '@vitest/browser/context';
import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TranscriptionRecord } from '$lib/transcription/model';
import { buildHarnessTranscriptionCreatePayload } from '$lib/testing/transcriptionEditorHarness';

vi.mock('$lib/db/client', () => ({
	createTranscription: vi.fn(),
	createTranscriptions: vi.fn(),
	ensureDefaultProject: vi.fn(),
	getTranscription: vi.fn(),
	listProjects: vi.fn(),
	updateTranscriptionMetadata: vi.fn(),
}));
vi.mock('$lib/db/runtime', () => ({
	checkpointLocalDb: vi.fn(),
	ensureLocalDbRuntime: vi.fn(async () => undefined),
}));

import TranscriptionForm from './TranscriptionForm.svelte';

it('keeps an edit-session title draft when the transcription record is replaced', async () => {
	const transcription: TranscriptionRecord = {
		...buildHarnessTranscriptionCreatePayload('2026-10-14T00:00:00Z'),
		id: 'draft-record',
		project_id: 'project',
		origin_type: 'original',
		origin_project_id: null,
		origin_transcription_id: null,
		origin_revision_id: '',
		origin_content_hash: '',
		origin_captured_at: '',
		current_revision_id: '',
		current_content_hash: '',
		tags: [],
	};
	const view = render(TranscriptionForm, { data: {}, transcription });
	const title = page.getByRole('textbox', { name: 'Title*', exact: true });
	await expect.element(title).toHaveValue(transcription.title);
	await title.fill('Unsaved title');
	await view.rerender({ transcription: { ...transcription, title: 'Reloaded title' } });
	await expect.element(title).toHaveValue('Unsaved title');
});
