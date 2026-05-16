import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTranscription } from './transcriptions';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '../test-harness';
import {
	createProject,
	getProject,
	getProjectTranscriptionIds,
	listProjects,
	listProjectTranscriptionOptions,
	loadTranscriptionContent,
	syncProjectTranscriptionIds,
	updateProjectMetadata,
} from './projects';

let harness: LocalDbTestHarness;

beforeEach(() => {
	harness = createLocalDbTestHarness();
});

afterEach(async () => {
	await harness.destroy();
});

describe('projects repository', () => {
	it('creates, lists, loads, and updates project metadata/settings', async () => {
		const projectId = await createProject(harness.db, {
			id: 'project-1',
			name: '  Romans Collation  ',
			description: ' first pass ',
			collationSettings: { lowercase: true },
			createdAt: '2024-01-01T00:00:00.000Z',
			updatedAt: '2024-01-01T00:00:00.000Z',
		});

		await updateProjectMetadata(harness.db, {
			projectId,
			name: 'Romans Final',
			description: ' revised ',
			collationSettings: { segmentation: false },
			updatedAt: '2024-02-01T00:00:00.000Z',
		});

		const projects = await listProjects(harness.db);
		const project = await getProject(harness.db, projectId);

		expect(projects).toEqual([
			{
				id: 'project-1',
				name: 'Romans Final',
				description: 'revised',
				createdAt: '2024-01-01T00:00:00.000Z',
				updatedAt: '2024-02-01T00:00:00.000Z',
			},
		]);
		expect(project).toMatchObject({
			id: 'project-1',
			name: 'Romans Final',
			collationSettings: { segmentation: false },
		});
	});

	it('lists transcription options without content and loads content on demand', async () => {
		await createTranscription(harness.db, baseTranscription('tx-2', '02'));
		await createTranscription(harness.db, baseTranscription('tx-1', '01'));

		const options = await listProjectTranscriptionOptions(harness.db);
		const content = await loadTranscriptionContent(harness.db, 'tx-1');

		expect(options.map((option) => option.id)).toEqual(['tx-1', 'tx-2']);
		expect(options[0]).not.toHaveProperty('content_json');
		expect(content).toContain('transcriptionDocument');
	});

	it('syncs project transcription ids with hard deletes and conflict-safe inserts', async () => {
		await createTranscription(harness.db, baseTranscription('tx-1', '01'));
		await createTranscription(harness.db, baseTranscription('tx-2', '02'));
		await createProject(harness.db, { id: 'project-1', name: 'Project' });

		await syncProjectTranscriptionIds(harness.db, 'project-1', ['tx-1', 'tx-2', 'tx-1']);
		await syncProjectTranscriptionIds(harness.db, 'project-1', ['tx-2']);

		const ids = await getProjectTranscriptionIds(harness.db, 'project-1');
		const rows = await harness.db.selectFrom('project_transcriptions').selectAll().execute();

		expect(ids).toEqual(['tx-2']);
		expect(rows).toHaveLength(1);
	});
});

function baseTranscription(id: string, siglum: string) {
	return {
		id,
		title: `Witness ${siglum}`,
		siglum,
		transcriber: 'Editor',
		repository: 'Library',
		settlement: 'City',
		language: 'grc',
	};
}
