import { page } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import type { ProjectTranscriptionStatus } from '$lib/client/db/repositories/projects';

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
			currentCheckpoint: {
				revisionId: 'rev-source-current',
				contentHash: 'hash-source-current',
			},
			dirtyToCheckpoint: false,
		},
		immediateSource: {
			sourceType: 'project_copy',
			sourceProjectId: 'source-project',
			sourceProjectName: 'Source Project',
			sourceTranscriptionId: 'tx-source',
			sourceRevisionId: 'rev-source-current',
			sourceContentHash: 'hash-source-current',
		},
		currentCheckpoint: null,
		workingContentHash: 'hash-target-working',
		dirtyToCheckpoint: false,
		commitState: 'clean',
		sourceState: {
			kind: 'up-to-date',
			sourceTranscriptionId: 'tx-source',
			sourceRevisionId: 'rev-source-current',
			sourceContentHash: 'hash-source-current',
		},
		...overrides,
	};
}

describe('TranscriptionLineage', () => {
	it('renders copied origin project and short revision for a current source', async () => {
		render(TranscriptionLineage, { status: statusWithSource({}) });

		await expect.element(browserPage.getByTestId('transcription-lineage')).toHaveTextContent('Copied from Source Project @ rev-sour...');
		await expect.element(browserPage.getByTestId('transcription-lineage-state')).toHaveTextContent('Source current');
	});

	it('marks lineage stale exactly when the source head differs', async () => {
		render(
			TranscriptionLineage,
			{
				status: statusWithSource({
					sourceState: {
						kind: 'newer-source-available',
						sourceTranscriptionId: 'tx-source',
						sourceRevisionId: 'rev-source-newer',
						sourceContentHash: 'hash-source-newer',
					},
				}),
			}
		);

		await expect.element(browserPage.getByTestId('transcription-lineage-state')).toHaveTextContent('Newer source available');
	});

	it('renders missing-source provenance without crashing', async () => {
		render(
			TranscriptionLineage,
			{
				status: statusWithSource({
					canonicalSource: null,
					immediateSource: {
						sourceType: 'project_copy',
						sourceProjectId: 'deleted-project',
						sourceProjectName: null,
						sourceTranscriptionId: 'deleted-transcription',
						sourceRevisionId: 'deleted-revision-123456',
						sourceContentHash: 'deleted-hash',
					},
					sourceState: {
						kind: 'source-missing',
						sourceTranscriptionId: 'deleted-transcription',
					},
				}),
			}
		);

		await expect.element(browserPage.getByTestId('transcription-lineage')).toHaveTextContent('Copied from deleted-project @ deleted-...');
		await expect.element(browserPage.getByTestId('transcription-lineage-state')).toHaveTextContent('Source unavailable');
	});
});
