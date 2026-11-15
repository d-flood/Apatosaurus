import { page, userEvent } from '@vitest/browser/context';
import { mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import type { DocumentFileProblemListing } from '$lib/db/repositories/document-refresh';
import type { ProjectRecord } from '$lib/db/repositories/projects';
import { transcriptionDocument } from '$lib/testing/editorFixtures';

const { problem, updateTranscriptionContent } = vi.hoisted(() => ({
	problem: {
		path: 'transcriptions/pt-1.tei.xml',
		projectId: 'project',
		entityType: 'transcription',
		entityId: 'pt-1',
		code: 'invalid_tei',
		message: 'Opening and ending tag mismatch: "text" != "TEI"',
		detectedAt: '2026-11-14T10:00:00.000Z',
		kind: 'transcription',
		documentId: 'pt-1',
		projectTranscriptionId: 'pt-1',
		transcriptionId: 'tx-1',
		title: 'Codex Vaticanus',
	} satisfies DocumentFileProblemListing,
	updateTranscriptionContent: vi.fn(async () => undefined),
}));

vi.mock('$lib/db/client', () => ({
	deleteTranscription: vi.fn(),
	listConflictCopies: vi.fn(async () => []),
	subscribeLocalDbInvalidations: vi.fn(() => () => {}),
	listDocumentFileProblems: vi.fn(async () => [problem]),
	listProjectTranscriptionStatuses: vi.fn(async () => [
		{
			projectTranscriptionId: 'pt-1',
			projectOwnedTranscriptionId: 'tx-1',
			title: 'Codex Vaticanus',
			siglum: '03',
			updatedAt: '2026-11-14T10:00:00.000Z',
		},
		{
			projectTranscriptionId: 'pt-2',
			projectOwnedTranscriptionId: 'tx-2',
			title: 'Codex Sinaiticus',
			siglum: '01',
			updatedAt: '2026-11-14T10:00:00.000Z',
		},
	]),
	createTranscription: vi.fn(),
	createTranscriptions: vi.fn(),
	ensureDefaultProject: vi.fn(),
	getTranscription: vi.fn(),
	listProjects: vi.fn(),
	updateTranscriptionMetadata: vi.fn(),
	exportTranscriptionTei: vi.fn(),
	updateTranscriptionContent,
}));
vi.mock('$lib/db/runtime', () => ({
	checkpointLocalDb: vi.fn(),
	ensureLocalDbRuntime: vi.fn(async () => undefined),
}));

import DocumentFileProblemsReport from './DocumentFileProblemsReport.svelte';
import TranscriptionsPage from '../../../routes/projects/[id]/transcriptions/+page.svelte';
import TranscriptionEditor from '$lib/editor/components/TranscriptionEditor.svelte';

const project: ProjectRecord = {
	id: 'project',
	storageSlug: 'project',
	name: 'Romans',
	description: '',
	charter: '',
	collationSettings: null,
	createdAt: '2026-11-14',
	updatedAt: '2026-11-14',
};

describe('broken TEI files', () => {
	it('reports a file that no longer parses on the project', async () => {
		render(DocumentFileProblemsReport, { problems: [problem] });

		await expect
			.element(
				page.getByRole('heading', { name: /changed outside the app no longer parses/ })
			)
			.toBeVisible();
		await expect
			.element(page.getByRole('link', { name: 'Codex Vaticanus' }))
			.toHaveAttribute('href', expect.stringContaining('/transcription/tx-1'));
		await expect.element(page.getByText('invalid_tei')).toBeVisible();
		await expect.element(page.getByText('transcriptions/pt-1.tei.xml')).toBeVisible();
		await expect.element(page.getByText(problem.message)).toBeVisible();
		await expect.element(page.getByText(/Saving its document is blocked/)).toBeVisible();
	});

	it('links a broken collation and falls back to its id', async () => {
		render(DocumentFileProblemsReport, {
			problems: [
				{
					...problem,
					path: 'collations/col-1.tei.xml',
					entityType: 'collation',
					entityId: 'col-1',
					kind: 'collation',
					documentId: 'col-1',
					projectTranscriptionId: '',
					transcriptionId: null,
					title: null,
				},
			],
		});

		await expect
			.element(page.getByRole('link', { name: 'col-1' }))
			.toHaveAttribute('href', expect.stringContaining('/collation/col-1'));
	});

	it('renders nothing when every file parses', async () => {
		const { container } = render(DocumentFileProblemsReport, { problems: [] });
		expect(container.textContent?.trim()).toBe('');
	});

	it('marks the broken transcription in the transcriptions list at phone width', async () => {
		await page.viewport(375, 740);
		render(TranscriptionsPage, { data: { project } });

		await expect.element(page.getByText("File doesn't parse")).toBeVisible();
		await expect
			.element(page.getByText(/Saving is blocked until the file parses again/))
			.toBeVisible();
		expect(page.getByText("File doesn't parse").all()).toHaveLength(1);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
	});

	it('blocks editing and saving in the editor while the file is broken', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const component = mount(TranscriptionEditor, {
			target,
			props: {
				transcription: {
					id: 'tx-1',
					title: 'Codex Vaticanus',
					content_json: transcriptionDocument({}),
					format: 'normalized_ast_v3',
				} as any,
				data: {},
				readOnly: true,
			},
		});
		try {
			await vi.waitFor(() =>
				expect(target.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe(
					'false'
				)
			);
			await userEvent.click(target.querySelector('.ProseMirror')!);
			await userEvent.keyboard('overwrite');
			await new Promise(resolve => setTimeout(resolve, 1250));
			expect(updateTranscriptionContent).not.toHaveBeenCalled();
		} finally {
			await unmount(component);
			target.remove();
		}
	});
});
