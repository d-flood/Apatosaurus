import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import { createTranscription, updateTranscriptionContent } from './transcriptions';
import { ensureManifestSource, upsertCanvasAnnotation, upsertPageCanvasLink } from './iiif';
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
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		await createTranscription(harness.db, {
			...baseTranscription('tx-2', '02'),
			document: documentWithVerses(['Romans 1:2']),
		});
		await createProject(harness.db, { id: 'project-1', name: 'Project' });

		const firstSnapshotIds = await syncProjectTranscriptionIds(harness.db, 'project-1', ['tx-1', 'tx-2', 'tx-1']);
		const syncedSnapshotIds = await syncProjectTranscriptionIds(harness.db, 'project-1', [firstSnapshotIds[1]]);

		const ids = await getProjectTranscriptionIds(harness.db, 'project-1');
		const rows = await harness.db.selectFrom('project_transcriptions').selectAll().execute();
		const removedSnapshot = await harness.db
			.selectFrom('transcriptions')
			.selectAll()
			.where('id', '=', firstSnapshotIds[0])
			.executeTakeFirst();

		expect(firstSnapshotIds).toHaveLength(2);
		expect(firstSnapshotIds).not.toContain('tx-1');
		expect(firstSnapshotIds).not.toContain('tx-2');
		expect(syncedSnapshotIds).toEqual([firstSnapshotIds[1]]);
		expect(ids).toEqual([firstSnapshotIds[1]]);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			project_id: 'project-1',
			transcription_id: firstSnapshotIds[1],
			canonical_transcription_id: 'tx-2',
		});
		expect(removedSnapshot).toBeUndefined();
	});

	it('clones transcription provenance, verse indexes, and IIIF rows into project snapshots', async () => {
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		await harness.db
			.updateTable('transcriptions')
			.set({ current_revision_id: 'rev-1', current_content_hash: 'sha256:source' })
			.where('id', '=', 'tx-1')
			.execute();
		const manifest = await ensureManifestSource(harness.db, {
			transcriptionId: 'tx-1',
			manifestUrl: 'https://example.org/manifest.json',
			label: 'Manifest',
		});
		await upsertPageCanvasLink(harness.db, pageCanvasLinkInput('tx-1', manifest.id));
		await upsertCanvasAnnotation(harness.db, {
			transcriptionId: 'tx-1',
			manifestSourceId: manifest.id,
			pageId: 'page-1',
			canvasId: 'canvas-1',
			anchor: { pageId: 'page-1' },
			annotation: {
				'@context': 'http://www.w3.org/ns/anno.jsonld',
				id: 'anno-1',
				type: 'Annotation',
				body: [{ type: 'TextualBody', value: 'note', purpose: 'commenting' }],
				target: { source: 'canvas-1' },
			},
		});
		await createProject(harness.db, { id: 'project-1', name: 'Project' });

		const [snapshotId] = await syncProjectTranscriptionIds(harness.db, 'project-1', ['tx-1']);

		const snapshot = await harness.db
			.selectFrom('transcriptions')
			.selectAll()
			.where('id', '=', snapshotId)
			.executeTakeFirstOrThrow();
		const projectRows = await harness.db.selectFrom('project_transcriptions').selectAll().execute();
		const verseRows = await harness.db
			.selectFrom('transcription_verse_index')
			.selectAll()
			.where('transcription_id', '=', snapshotId)
			.execute();
		const manifestRows = await harness.db
			.selectFrom('iiif_manifest_sources')
			.selectAll()
			.where('transcription_id', '=', snapshotId)
			.execute();
		const pageRows = await harness.db
			.selectFrom('transcription_page_canvas_links')
			.selectAll()
			.where('transcription_id', '=', snapshotId)
			.execute();
		const annotationRows = await harness.db
			.selectFrom('iiif_canvas_annotations')
			.selectAll()
			.where('transcription_id', '=', snapshotId)
			.execute();
		const projectOptions = await listProjectTranscriptionOptions(harness.db, 'project-1');

		expect(snapshot).toMatchObject({
			scope_type: 'project_snapshot',
			project_id: 'project-1',
			origin_type: 'canonical',
			origin_project_id: null,
			origin_transcription_id: 'tx-1',
			origin_revision_id: 'rev-1',
			origin_content_hash: 'sha256:source',
			current_revision_id: '',
			current_content_hash: '',
		});
		expect(projectRows[0]).toMatchObject({
			project_id: 'project-1',
			transcription_id: snapshotId,
			canonical_transcription_id: 'tx-1',
		});
		expect(verseRows.map((row) => row.verse_identifier)).toEqual(['Romans 1:1']);
		expect(manifestRows).toHaveLength(1);
		expect(manifestRows[0].id).not.toBe(manifest.id);
		expect(pageRows).toHaveLength(1);
		expect(pageRows[0].manifest_source_id).toBe(manifestRows[0].id);
		expect(annotationRows).toHaveLength(1);
		expect(annotationRows[0].manifest_source_id).toBe(manifestRows[0].id);
		expect(projectOptions.map((option) => option.id)).toEqual([snapshotId]);
	});

	it('edits project snapshots without mutating the canonical transcription', async () => {
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		const [snapshotId] = await syncProjectTranscriptionIds(harness.db, 'project-1', ['tx-1']);

		await updateTranscriptionContent(harness.db, {
			id: snapshotId,
			document: documentWithVerses(['Romans 1:2']),
			updatedAt: '2024-03-01T00:00:00.000Z',
		});

		const canonicalContent = await loadTranscriptionContent(harness.db, 'tx-1');
		const snapshotContent = await loadTranscriptionContent(harness.db, snapshotId);
		const canonicalVerseRows = await harness.db
			.selectFrom('transcription_verse_index')
			.select('verse_identifier')
			.where('transcription_id', '=', 'tx-1')
			.execute();
		const snapshotVerseRows = await harness.db
			.selectFrom('transcription_verse_index')
			.select('verse_identifier')
			.where('transcription_id', '=', snapshotId)
			.execute();

		expect(snapshotContent).not.toBe(canonicalContent);
		expect(canonicalVerseRows.map((row) => row.verse_identifier)).toEqual(['Romans 1:1']);
		expect(snapshotVerseRows.map((row) => row.verse_identifier)).toEqual(['Romans 1:2']);
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

function documentWithVerses(verses: string[]): StoredTranscriptionDocument {
	return {
		type: 'transcriptionDocument' as const,
		pages: [
			{
				type: 'page',
				id: 'page-1',
				columns: [
					{
						type: 'column',
						number: 1,
						lines: [
							{
								type: 'line',
								number: 1,
								items: verses.map((value) => {
									const [book = '', chapterVerse = ''] = value.split(' ');
									const [chapter = '', verse = ''] = chapterVerse.split(':');
									return {
										type: 'milestone' as const,
										kind: 'verse' as const,
										attrs: { book, chapter, verse },
									};
								}),
							},
						],
					},
				],
			},
		],
	};
}

function pageCanvasLinkInput(transcriptionId: string, manifestSourceId: string) {
	return {
		transcriptionId,
		pageId: 'page-1',
		pageNameSnapshot: 'Page 1',
		pageOrder: 0,
		manifestSourceId,
		manifestUrlSnapshot: 'https://example.org/manifest.json',
		canvasId: 'canvas-1',
		canvasOrder: 0,
		canvasLabel: 'Canvas 1',
		imageServiceUrl: null,
		thumbnailUrl: null,
	};
}
