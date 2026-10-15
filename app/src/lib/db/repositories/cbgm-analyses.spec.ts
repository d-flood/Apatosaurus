import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	CBGM_ANALYSIS_INPUT,
	createCbgmAnalysisWithFiles,
	createLocalDbTestHarness,
	type LocalDbTestHarness,
} from '$lib/testing/local-db-harness';
import { MemoryStoreBackend } from '$lib/storage/memory-store-backend.spec-support';
import {
	deleteFile,
	readFileBytes,
	readTextFile,
	writeTextFileAtomic,
	type StoreOperationOptions,
} from '$lib/storage/opfs-store';
import {
	CBGM_ANALYSIS_FORMAT,
	PROJECT_MANIFEST_FORMAT,
	TOMBSTONE_FORMAT,
	readCanonicalDocument,
	serializeCanonicalDocument,
	type CbgmAnalysisMetadata,
	type ProjectManifestPayload,
	type TombstonePayload,
} from '$lib/storage/formats';
import { cbgmAnalysisFiles, projectManifestFile, tombstoneFile } from '$lib/storage/layout';
import { readDeviceIdentity } from '$lib/storage/device-identity';
import { saveAppSettings } from '$lib/storage/app-settings';
import {
	completeCoherence,
	failCoherence,
	listAnalyses,
	readAnalysis,
	readCache,
	readInputTei,
	setGlobalStemmaState,
} from './cbgm-analyses';
import { deleteCbgmAnalysisWithFiles } from './entity-deletion';
import { rebuildIndexFromStore } from './index-rebuild';
import { createProject } from './projects';

let harness: LocalDbTestHarness;
let storeOptions: StoreOperationOptions;

const files = cbgmAnalysisFiles('romans', 'analysis-1');
const cache = Uint8Array.from({ length: 4096 }, (_, index) => (index * 17) % 256);

beforeEach(async () => {
	harness = createLocalDbTestHarness();
	storeOptions = { backend: new MemoryStoreBackend() };
	await createProject(
		harness.db,
		{ id: 'project-1', storageSlug: 'romans', name: 'Romans' },
		storeOptions
	);
});

afterEach(async () => {
	await harness.destroy();
});

describe('CBGM analysis repository', () => {
	it('freezes the input and marks this device as computing', async () => {
		await saveAppSettings({ authorName: 'Ada' }, storeOptions);

		const created = await createCbgmAnalysisWithFiles(
			harness.db,
			'project-1',
			{ name: '  Romans coherence  ' },
			storeOptions
		);

		const { deviceId } = await readDeviceIdentity(storeOptions);
		expect(created).toMatchObject({
			id: 'analysis-1',
			project_id: 'project-1',
			name: 'Romans coherence',
			completed_at: null,
			cache_hash: null,
			coherence: 'computing',
			global_stemma: 'none',
			computing_device: { device_id: deviceId, author_name: 'Ada' },
			failure: null,
		});
		expect(Date.parse(created.inputs_frozen_at)).not.toBeNaN();
		expect(await readTextFile(files.input, storeOptions)).toBe(CBGM_ANALYSIS_INPUT.inputTei);
		expect(await readAnalysis(harness.db, 'analysis-1', storeOptions)).toEqual(created);
		expect(await readInputTei(harness.db, 'analysis-1', storeOptions)).toBe(
			CBGM_ANALYSIS_INPUT.inputTei
		);
		expect(await readCache(harness.db, 'analysis-1', storeOptions)).toBeNull();
		await expect(readTextFile(files.cache, storeOptions)).rejects.toThrow();
		expect(await listAnalyses(harness.db, 'project-1')).toEqual([
			{
				id: 'analysis-1',
				project_id: 'project-1',
				name: 'Romans coherence',
				inputs_frozen_at: created.inputs_frozen_at,
				completed_at: null,
				coherence: 'computing',
				global_stemma: 'none',
				collation_ids: '["col-1"]',
				witness_count: 3,
			},
		]);
	});

	it('records no computing device for an analysis awaiting a native import', async () => {
		const created = await createCbgmAnalysisWithFiles(
			harness.db,
			'project-1',
			{ coherence: 'awaiting-import' },
			storeOptions
		);

		expect(created.computing_device).toBeNull();
	});

	it('rejects a name already used in the project, ignoring case and spaces', async () => {
		await createCbgmAnalysisWithFiles(harness.db, 'project-1', {}, storeOptions);

		await expect(
			createCbgmAnalysisWithFiles(
				harness.db,
				'project-1',
				{ id: 'analysis-2', name: ' ROMANS Coherence ' },
				storeOptions
			)
		).rejects.toThrow('already has a CBGM analysis named');
		await expect(
			readTextFile(cbgmAnalysisFiles('romans', 'analysis-2').input, storeOptions)
		).rejects.toThrow();
	});

	it('writes the cache, then publishes ready coherence without touching the frozen inputs', async () => {
		const created = await createCbgmAnalysisWithFiles(
			harness.db,
			'project-1',
			{},
			storeOptions
		);

		const completed = await completeCoherence(
			harness.db,
			'project-1',
			'analysis-1',
			cache,
			storeOptions
		);

		expect(completed).toEqual({
			...created,
			coherence: 'ready',
			completed_at: expect.any(String),
			cache_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
			computing_device: null,
		});
		expect(await readFileBytes(files.cache, storeOptions)).toEqual(cache);
		expect(await readCache(harness.db, 'analysis-1', storeOptions)).toEqual(cache);
		expect(await listAnalyses(harness.db, 'project-1')).toMatchObject([
			{ coherence: 'ready', completed_at: completed.completed_at },
		]);
	});

	it('records a coherence failure', async () => {
		await createCbgmAnalysisWithFiles(harness.db, 'project-1', {}, storeOptions);

		const failed = await failCoherence(
			harness.db,
			'project-1',
			'analysis-1',
			'Engine ran out of memory.',
			storeOptions
		);

		expect(failed).toMatchObject({
			coherence: 'failed',
			computing_device: null,
			failure: 'Engine ran out of memory.',
		});
		expect(await readAnalysis(harness.db, 'analysis-1', storeOptions)).toEqual(failed);
	});

	it('records global stemma states with their cache or DOT bytes', async () => {
		await createCbgmAnalysisWithFiles(harness.db, 'project-1', {}, storeOptions);
		await completeCoherence(harness.db, 'project-1', 'analysis-1', cache, storeOptions);

		const computing = await setGlobalStemmaState(
			harness.db,
			'project-1',
			'analysis-1',
			'computing',
			undefined,
			undefined,
			storeOptions
		);
		expect(computing.global_stemma).toBe('computing');
		expect(computing.computing_device).not.toBeNull();

		const withSubstemmata = Uint8Array.from([...cache, 1, 2, 3]);
		const ready = await setGlobalStemmaState(
			harness.db,
			'project-1',
			'analysis-1',
			'ready',
			withSubstemmata,
			undefined,
			storeOptions
		);
		expect(ready).toMatchObject({ global_stemma: 'ready', computing_device: null });
		expect(await readCache(harness.db, 'analysis-1', storeOptions)).toEqual(withSubstemmata);

		const imported = await setGlobalStemmaState(
			harness.db,
			'project-1',
			'analysis-1',
			'imported-dot',
			undefined,
			'digraph global {}',
			storeOptions
		);
		expect(imported).toMatchObject({
			global_stemma: 'imported-dot',
			cache_hash: ready.cache_hash,
		});
		expect(await readTextFile(files.globalStemma, storeOptions)).toBe('digraph global {}');
		await expect(
			setGlobalStemmaState(
				harness.db,
				'project-1',
				'analysis-1',
				'ready',
				undefined,
				undefined,
				storeOptions
			)
		).rejects.toThrow('needs the cache');
	});

	it('refuses metadata at the wrong path or owned by another project', async () => {
		const created = await createCbgmAnalysisWithFiles(
			harness.db,
			'project-1',
			{},
			storeOptions
		);
		const raw = await serializeCanonicalDocument(CBGM_ANALYSIS_FORMAT, created);

		const misplaced = await readCanonicalDocument(CBGM_ANALYSIS_FORMAT, raw, {
			projectPath: 'cbgm/analysis-2.json',
			projectId: 'project-1',
		});
		const foreign = await readCanonicalDocument(CBGM_ANALYSIS_FORMAT, raw, {
			projectPath: 'cbgm/analysis-1.json',
			projectId: 'project-2',
		});

		expect(misplaced).toMatchObject({ ok: false, quarantine: { code: 'invalid_shape' } });
		expect(foreign).toMatchObject({ ok: false, quarantine: { code: 'invalid_shape' } });

		await writeTextFileAtomic(
			files.metadata,
			await serializeCanonicalDocument(CBGM_ANALYSIS_FORMAT, {
				...created,
				project_id: 'project-2',
			}),
			storeOptions
		);
		await expect(readAnalysis(harness.db, 'analysis-1', storeOptions)).rejects.toThrow(
			'belongs to a different project'
		);
	});

	it('never falls back to the index when the metadata file is missing', async () => {
		await createCbgmAnalysisWithFiles(harness.db, 'project-1', {}, storeOptions);
		await completeCoherence(harness.db, 'project-1', 'analysis-1', cache, storeOptions);
		await deleteFile(files.metadata, storeOptions);

		expect(await listAnalyses(harness.db, 'project-1')).toHaveLength(1);
		await expect(readAnalysis(harness.db, 'analysis-1', storeOptions)).rejects.toThrow();
		await expect(readCache(harness.db, 'analysis-1', storeOptions)).rejects.toThrow();
		await expect(readInputTei(harness.db, 'analysis-1', storeOptions)).rejects.toThrow();
		await expect(
			failCoherence(harness.db, 'project-1', 'analysis-1', 'late', storeOptions)
		).rejects.toThrow();
	});

	it('deletes every analysis file behind a cbgm_analysis tombstone', async () => {
		await createCbgmAnalysisWithFiles(harness.db, 'project-1', {}, storeOptions);
		await completeCoherence(harness.db, 'project-1', 'analysis-1', cache, storeOptions);
		await setGlobalStemmaState(
			harness.db,
			'project-1',
			'analysis-1',
			'imported-dot',
			undefined,
			'digraph global {}',
			storeOptions
		);

		const warnings = await deleteCbgmAnalysisWithFiles(
			harness.db,
			'project-1',
			'analysis-1',
			{ tombstoneId: 'tombstone-1', deletedAt: '2026-10-15T12:00:00.000Z' },
			storeOptions
		);

		expect(warnings).toEqual([]);
		for (const path of Object.values(files)) {
			await expect(readTextFile(path, storeOptions)).rejects.toThrow();
		}
		expect(await listAnalyses(harness.db, 'project-1')).toEqual([]);
		const tombstone = await readCanonicalDocument<TombstonePayload>(
			TOMBSTONE_FORMAT,
			await readTextFile(tombstoneFile('romans', 'cbgm_analysis', 'analysis-1'), storeOptions)
		);
		expect(tombstone).toMatchObject({
			ok: true,
			payload: {
				project_id: 'project-1',
				entity_type: 'cbgm_analysis',
				entity_id: 'analysis-1',
				cloud_path: 'cbgm/analysis-1.json',
			},
		});
		const manifest = await readCanonicalDocument<ProjectManifestPayload>(
			PROJECT_MANIFEST_FORMAT,
			await readTextFile(projectManifestFile('romans'), storeOptions)
		);
		expect(manifest.ok && manifest.payload.tombstones).toMatchObject([
			{ entity_type: 'cbgm_analysis', entity_id: 'analysis-1' },
		]);
	});

	it('lists analyses after an index rebuild, skipping deleted and invalid ones', async () => {
		const kept = await createCbgmAnalysisWithFiles(harness.db, 'project-1', {}, storeOptions);
		await completeCoherence(harness.db, 'project-1', 'analysis-1', cache, storeOptions);
		await createCbgmAnalysisWithFiles(
			harness.db,
			'project-1',
			{ id: 'analysis-2', name: 'Deleted' },
			storeOptions
		);
		const deletedMetadata = await readTextFile(
			cbgmAnalysisFiles('romans', 'analysis-2').metadata,
			storeOptions
		);
		await deleteCbgmAnalysisWithFiles(harness.db, 'project-1', 'analysis-2', {}, storeOptions);
		await writeTextFileAtomic(
			cbgmAnalysisFiles('romans', 'analysis-2').metadata,
			deletedMetadata,
			storeOptions
		);
		await writeTextFileAtomic(
			cbgmAnalysisFiles('romans', 'analysis-3').metadata,
			await serializeCanonicalDocument(CBGM_ANALYSIS_FORMAT, {
				...kept,
				id: 'analysis-3',
				project_id: 'project-2',
			} satisfies CbgmAnalysisMetadata),
			storeOptions
		);
		const before = await listAnalyses(harness.db, 'project-1');

		const report = await rebuildIndexFromStore(harness.db, storeOptions);

		expect(await listAnalyses(harness.db, 'project-1')).toEqual(before);
		expect(before.map(row => row.id)).toEqual(['analysis-1']);
		expect(before[0]).toMatchObject({ coherence: 'ready', witness_count: 3 });
		expect(report.quarantinedFiles).toEqual([
			expect.objectContaining({
				path: 'projects/romans/cbgm/analysis-3.json',
				code: 'invalid_shape',
			}),
		]);
	});
});
