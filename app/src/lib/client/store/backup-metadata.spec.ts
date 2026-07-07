import { describe, expect, it } from 'vitest';

import { MemoryStoreBackend } from './memory-store-backend.spec-support';
import {
	getProjectBackupMetadata,
	recordProjectZipExport,
} from './backup-metadata';

describe('backup metadata store', () => {
	it('persists project zip export timestamps in app-local metadata', async () => {
		const backend = new MemoryStoreBackend();
		const storeOptions = { backend };

		await expect(getProjectBackupMetadata('project-1', storeOptions)).resolves.toEqual({
			projectId: 'project-1',
			lastExportedAt: null,
		});

		await recordProjectZipExport('project-1', '2026-07-07T12:00:00.000Z', storeOptions);

		await expect(getProjectBackupMetadata('project-1', storeOptions)).resolves.toEqual({
			projectId: 'project-1',
			lastExportedAt: '2026-07-07T12:00:00.000Z',
		});
		await expect(getProjectBackupMetadata('project-2', storeOptions)).resolves.toEqual({
			projectId: 'project-2',
			lastExportedAt: null,
		});
	});
});
