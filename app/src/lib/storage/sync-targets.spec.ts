import { describe, expect, it } from 'vitest';

import { sealDocument, serializeSealedDocument } from './envelope';
import { syncTargetsFile } from './layout';
import { MemoryStoreBackend } from './memory-store-backend.spec-support';
import { writeTextFileAtomic } from './opfs-store';
import { listSyncTargets, type SyncTargetRecord } from './sync-targets';
import { writeLegacySyncTargetsFile } from './sync-targets.spec-support';

describe('legacy sync targets reader', () => {
	it('reads, filters, and sorts project-scoped targets', async () => {
		const options = { backend: new MemoryStoreBackend() };
		await expect(listSyncTargets(undefined, options)).resolves.toEqual([]);
		const target: SyncTargetRecord = {
			targetId: 'target-1',
			projectId: 'project-1',
			handleRef: 'handle-1',
			folderDisplayPath: 'Apatosaurus Project',
			enabled: true,
			connectedAt: '2026-07-07T10:00:00.000Z',
			updatedAt: '2026-07-07T10:00:00.000Z',
			lastSyncedAt: null,
		};
		const other = { ...target, targetId: 'target-2', projectId: 'project-2' };
		await writeLegacySyncTargetsFile([other, target], options);
		await expect(listSyncTargets(undefined, options)).resolves.toEqual([target, other]);
		await expect(listSyncTargets('project-1', options)).resolves.toEqual([target]);
		await expect(listSyncTargets('missing', options)).resolves.toEqual([]);
	});

	it('rejects the wrong format', async () => {
		const options = { backend: new MemoryStoreBackend() };
		const document = await sealDocument('apatosaurus.wrong-format', 1, { targets: [] });
		await writeTextFileAtomic(syncTargetsFile(), serializeSealedDocument(document), options);
		await expect(listSyncTargets(undefined, options)).rejects.toThrow(/does not match/);
	});
});
