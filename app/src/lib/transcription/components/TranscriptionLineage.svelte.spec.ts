import { page } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import type { ProjectTranscriptionStatus } from '$lib/db/repositories/projects';

import TranscriptionLineage from './TranscriptionLineage.svelte';

const browserPage = page as any;

function statusWithSource(
	overrides: Partial<ProjectTranscriptionStatus>
): ProjectTranscriptionStatus {
	return {
		projectId: 'target-project',
		projectName: 'Target Project',
		projectTranscriptionId: 'pt-target',
		projectOwnedTranscriptionId: 'tx-target',
		siglum: 'B',
		title: 'Copied witness',
		description: '',
		updatedAt: '2026-01-01T00:00:00.000Z',
		isProjectOwned: true,
		canonicalSource: {
			transcriptionId: 'tx-source',
			projectId: 'source-project',
			projectName: 'Source Project',
			title: 'Source witness',
			siglum: 'A',
			state: null,
		},
		immediateSource: {
			sourceType: 'project_copy',
			sourceProjectId: 'source-project',
			sourceProjectName: 'Source Project',
			sourceTranscriptionId: 'tx-source',
			sourceRevisionId: 'rev-source-current',
			sourceContentHash: 'hash-source-current',
			sourceCapturedAt: null,
			sourceVersionLabel: 'Version 2',
		},
		currentCheckpoint: null,
		workingContentHash: 'hash-target-working',
		dirtyToCheckpoint: false,
		commitState: 'clean',
		sourceState: { kind: 'up-to-date', sourceTranscriptionId: 'tx-source' },
		...overrides,
	};
}

describe('TranscriptionLineage', () => {
	it('renders copied origin project and version label for a current source', async () => {
		render(TranscriptionLineage, { status: statusWithSource({}) });

		await expect
			.element(browserPage.getByTestId('transcription-lineage'))
			.toHaveTextContent('Copied from Source Project @ Version 2');
		await expect
			.element(browserPage.getByTestId('transcription-lineage-state'))
			.toHaveTextContent('Source current');
	});

	it('marks lineage stale exactly when the source changed', async () => {
		render(TranscriptionLineage, {
			status: statusWithSource({
				sourceState: { kind: 'source-changed', sourceTranscriptionId: 'tx-source' },
			}),
		});

		await expect
			.element(browserPage.getByTestId('transcription-lineage-state'))
			.toHaveTextContent('Source changed');
	});

	it('renders a Current source with its capture time and no ids', async () => {
		render(TranscriptionLineage, {
			status: statusWithSource({
				immediateSource: {
					sourceType: 'project_snapshot',
					sourceProjectId: 'source-project',
					sourceProjectName: 'Source Project',
					sourceTranscriptionId: 'tx-source',
					sourceRevisionId: null,
					sourceContentHash: 'hash-source-current',
					sourceCapturedAt: '2026-09-27T14:02:00.000Z',
					sourceVersionLabel: null,
				},
			}),
		});

		const lineage = browserPage.getByTestId('transcription-lineage');
		await expect
			.element(lineage)
			.toHaveTextContent(/Copied from Source Project @ Current as of/);
		await expect.element(lineage).not.toHaveTextContent('hash-source-current');
	});

	it('renders missing-source provenance without crashing', async () => {
		render(TranscriptionLineage, {
			status: statusWithSource({
				canonicalSource: null,
				immediateSource: {
					sourceType: 'project_copy',
					sourceProjectId: 'deleted-project',
					sourceProjectName: null,
					sourceTranscriptionId: 'deleted-transcription',
					sourceRevisionId: 'deleted-revision-123456',
					sourceContentHash: 'deleted-hash',
					sourceCapturedAt: null,
					sourceVersionLabel: null,
				},
				sourceState: {
					kind: 'source-missing',
					sourceTranscriptionId: 'deleted-transcription',
				},
			}),
		});

		await expect
			.element(browserPage.getByTestId('transcription-lineage'))
			.toHaveTextContent('Copied from deleted-project @ Named version');
		await expect
			.element(browserPage.getByTestId('transcription-lineage-state'))
			.toHaveTextContent('Source unavailable');
	});
});
