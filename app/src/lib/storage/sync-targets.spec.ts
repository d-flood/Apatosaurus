import { describe, expect, it } from 'vitest';

import { MemoryStoreBackend } from './memory-store-backend.spec-support';
import {
	listSyncTargets,
	upsertSyncTarget,
	updateSyncTargetLastSyncedAt,
} from './sync-targets';

describe('sync targets store', () => {
	it('persists project-scoped local folder targets in app/sync-targets.json', async () => {
		const backend = new MemoryStoreBackend();
		const storeOptions = { backend };

		await expect(listSyncTargets('project-1', storeOptions)).resolves.toEqual([]);

		const target = await upsertSyncTarget(
			{
				targetId: 'target-1',
				projectId: 'project-1',
				handleRef: 'handle-1',
				folderDisplayPath: 'Apatosaurus Project',
				enabled: true,
				connectedAt: '2026-07-07T10:00:00.000Z',
				updatedAt: '2026-07-07T10:00:00.000Z',
			},
			storeOptions
		);

		expect(target).toMatchObject({
			targetId: 'target-1',
			projectId: 'project-1',
			handleRef: 'handle-1',
			folderDisplayPath: 'Apatosaurus Project',
			enabled: true,
			lastSyncedAt: null,
		});
		await expect(listSyncTargets('project-1', storeOptions)).resolves.toEqual([target]);
		await expect(listSyncTargets('other-project', storeOptions)).resolves.toEqual([]);

		await updateSyncTargetLastSyncedAt(
			'target-1',
			'2026-07-07T10:05:00.000Z',
			storeOptions
		);

		await expect(listSyncTargets('project-1', storeOptions)).resolves.toMatchObject([
			{ targetId: 'target-1', lastSyncedAt: '2026-07-07T10:05:00.000Z' },
		]);
	});
});
