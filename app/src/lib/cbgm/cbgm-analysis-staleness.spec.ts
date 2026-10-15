import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	createAnalysis,
	loadCollationSnapshots,
	readCurrentCollationHashes,
} from '$lib/db/repositories/cbgm-analyses';
import {
	createCommittedCollationCheckpointWithFiles,
	getCollationVersionStatusWithWorkingFile,
	saveWorkingCollationArtifact,
} from '$lib/db/repositories/collation-files';
import { deleteCollationWithFiles } from '$lib/db/repositories/entity-deletion';
import { createProject } from '$lib/db/repositories/projects';
import { collationPrimaryFile } from '$lib/storage/layout';
import { MemoryStoreBackend } from '$lib/storage/memory-store-backend.spec-support';
import { writeTextFileAtomic, type StoreOperationOptions } from '$lib/storage/opfs-store';
import type { CbgmAnalysisMetadata } from '$lib/storage/formats';
import {
	CBGM_ANALYSIS_INPUT,
	createCollationWithFiles,
	createLocalDbTestHarness,
	type LocalDbTestHarness,
} from '$lib/testing/local-db-harness';
import { analysisCollationStatus, analysisStaleness } from './cbgm-analysis-staleness';

const analysis: CbgmAnalysisMetadata = {
	id: 'analysis-1',
	project_id: 'project-1',
	name: 'Romans coherence',
	inputs_frozen_at: '2026-10-15T09:00:00.000Z',
	completed_at: '2026-10-15T10:00:00.000Z',
	settings: CBGM_ANALYSIS_INPUT.settings,
	collations: [
		{ collation_id: 'col-1', content_hash: 'sha256:one', segment_name: 'Romans 1:1' },
		{ collation_id: 'col-2', content_hash: 'sha256:two', segment_name: 'Romans 1:2' },
		{ collation_id: 'col-3', content_hash: 'sha256:three', segment_name: 'Romans 1:3' },
	],
	input_tei_hash: 'sha256:input',
	cache_hash: 'sha256:cache',
	coherence: 'ready',
	witnesses: ['01', '02'],
	undecided_readings: [],
	global_stemma: 'none',
	computing_device: null,
	failure: null,
};

describe('analysisStaleness', () => {
	it('reports an analysis whose collations all match as up to date', () => {
		const current = new Map([
			['col-1', 'sha256:one'],
			['col-2', 'sha256:two'],
			['col-3', 'sha256:three'],
		]);

		expect(analysisStaleness(analysis, current)).toEqual({ changed: [], deleted: [] });
	});

	it('reports collations whose current content differs from the frozen content as changed', () => {
		const current = new Map([
			['col-1', 'sha256:one'],
			['col-2', 'sha256:edited'],
			['col-3', 'sha256:three'],
		]);

		expect(analysisStaleness(analysis, current)).toEqual({ changed: ['col-2'], deleted: [] });
	});

	it('reports collations missing from the current hashes as deleted', () => {
		const current = new Map([['col-2', 'sha256:edited']]);

		expect(analysisStaleness(analysis, current)).toEqual({
			changed: ['col-2'],
			deleted: ['col-1', 'col-3'],
		});
	});

	it('leaves the analysis unmodified', () => {
		const frozen = structuredClone(analysis);

		analysisStaleness(analysis, new Map([['col-1', 'sha256:edited']]));

		expect(analysis).toEqual(frozen);
	});
});

describe('analysis staleness against canonical collation files', () => {
	let harness: LocalDbTestHarness;
	let storeOptions: StoreOperationOptions;

	beforeEach(async () => {
		harness = createLocalDbTestHarness();
		storeOptions = { backend: new MemoryStoreBackend() };
		await createProject(
			harness.db,
			{ id: 'project-1', storageSlug: 'romans', name: 'Romans' },
			storeOptions
		);
		for (const id of ['col-1', 'col-2']) {
			await createCollationWithFiles(
				harness.db,
				{
					id,
					projectId: 'project-1',
					title: id,
					verseIdentifier: id,
					segment: { id: `segment-${id}`, name: id, members: [id] },
				},
				storeOptions
			);
		}
	});

	afterEach(async () => {
		await harness.destroy();
	});

	async function saveDraft(collationId: string, lowercase: boolean) {
		await saveWorkingCollationArtifact(
			harness.db,
			{
				collationId,
				artifactType: 'collation_document_v1',
				payload: JSON.stringify(collationDocument(collationId, lowercase)),
			},
			storeOptions
		);
	}

	async function freeze(): Promise<CbgmAnalysisMetadata> {
		const { collations } = await loadCollationSnapshots(
			harness.db,
			'project-1',
			undefined,
			storeOptions
		);
		return createAnalysis(
			harness.db,
			'project-1',
			{
				...CBGM_ANALYSIS_INPUT,
				collations: collations.map(collation => ({
					collation_id: collation.collationId,
					content_hash: collation.contentHash,
					segment_name: collation.segmentName,
				})),
			},
			storeOptions
		);
	}

	async function staleness(frozen: CbgmAnalysisMetadata) {
		return analysisCollationStatus(
			frozen,
			await readCurrentCollationHashes(
				harness.db,
				'project-1',
				frozen.collations.map(collation => collation.collation_id),
				storeOptions
			)
		);
	}

	it('goes stale when a draft edit is saved without a new checkpoint', async () => {
		await createCommittedCollationCheckpointWithFiles(
			harness.db,
			{ collationId: 'col-1' },
			storeOptions
		);
		await saveDraft('col-1', false);
		const checkpoint = (
			await getCollationVersionStatusWithWorkingFile(harness.db, 'col-1', {}, storeOptions)
		).currentCheckpoint;
		const frozen = await freeze();

		expect(await staleness(frozen)).toEqual({ changed: [], deleted: [], unavailable: [] });

		await saveDraft('col-1', true);

		const status = await getCollationVersionStatusWithWorkingFile(
			harness.db,
			'col-1',
			{},
			storeOptions
		);
		expect(status.currentCheckpoint).toEqual(checkpoint);
		expect(await staleness(frozen)).toEqual({
			changed: ['col-1'],
			deleted: [],
			unavailable: [],
		});
	});

	it('surfaces a corrupted primary as unavailable and only a deleted collation as deleted', async () => {
		const frozen = await freeze();
		await writeTextFileAtomic(collationPrimaryFile('romans', 'col-1'), '{', storeOptions);
		await deleteCollationWithFiles(harness.db, 'col-2', {}, storeOptions);

		expect(await staleness(frozen)).toEqual({
			changed: [],
			deleted: ['col-2'],
			unavailable: ['col-1'],
		});
	});
});

function collationDocument(collationId: string, lowercase: boolean) {
	return {
		type: 'collationDocument',
		version: 1,
		meta: { collationId, projectId: 'project-1', projectName: 'Romans' },
		flow: {
			phase: 'setup',
			furthestPhase: 'setup',
			alignmentDisplayMode: 'regularized',
			alignmentLayout: 'grid',
		},
		setup: {
			segment: { id: `segment-${collationId}`, name: collationId, members: [collationId] },
			witnesses: [],
		},
		settings: {
			regularizationRules: [],
			ignoreWordBreaks: false,
			lowercase,
			ignoreTokenWhitespace: true,
			ignorePunctuation: false,
			suppliedTextMode: 'clear',
			segmentation: true,
		},
		alignment: null,
		apparatus: null,
		stemma: null,
	};
}
