import { describe, expect, it } from 'vitest';
import { MemoryStoreBackend } from '$lib/storage/memory-store-backend.spec-support';
import { cbgmCheckpointFolder, joinStorePath } from '$lib/storage/layout';
import { readTextFile, writeTextFileAtomic } from '$lib/storage/opfs-store';
import { cbgmCheckpoints } from './cbgm-checkpoints';

describe('cbgm checkpoints', () => {
	it('resumes a checkpoint saved without trivial reading types', async () => {
		const backend = new MemoryStoreBackend();
		const checkpoints = cbgmCheckpoints(backend);
		await checkpoints.save({
			order: 1,
			request: {
				analysisId: 'analysis',
				projectId: 'project',
				phase: 'coherence',
				inputTei: '<TEI/>',
				notifyOs: false,
				settings: {
					minExtantUnits: null,
					minExtantProportion: null,
					excludedWitnesses: [],
					classicRules: false,
					mergeSplitReadings: false,
					droppedReadingTypes: [],
					trivialReadingTypes: ['orthographic'],
					includedCorrectors: [],
				},
			},
		});
		const path = joinStorePath(cbgmCheckpointFolder('analysis', 'coherence'), 'request.json');
		const stored = JSON.parse(await readTextFile(path, { backend }));
		delete stored.settings.trivialReadingTypes;
		await writeTextFileAtomic(path, JSON.stringify(stored), { backend });
		const [entry] = await checkpoints.list();
		expect(entry.request.settings.trivialReadingTypes).toEqual([]);
		expect(entry.request.settings.classicRules).toBe(false);
	});
});
