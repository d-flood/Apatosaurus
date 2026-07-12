import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLocalDbTestHarness, type LocalDbTestHarness } from '$lib/client/db/test-harness';
import { createCollation, updateCollationMetadata } from '$lib/client/db/repositories/collations';
import {
	upsertCloudConnection,
	upsertCloudProjectFolder,
} from '$lib/client/db/repositories/cloud-connections';
import { createProject } from '$lib/client/db/repositories/projects';
import {
	createCommittedCollationCheckpointWithFiles,
	saveWorkingCollationArtifact,
} from '$lib/client/db/repositories/collation-files';
import { MemoryStoreBackend } from '$lib/client/store/memory-store-backend.spec-support';
import { COLLATION_FIXTURE, type StoreOperationOptions } from '$lib/client/store';
import { backupProject, type SyncProjectContext } from './sync-manager';
import { MockCloudStorageProvider } from './providers/mock-provider';
import type { CloudFileMetadata } from './providers/provider';
import { verifyRemoteProjectBackupHealth } from './backup-health';

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;
let storeOptions: StoreOperationOptions;

beforeEach(() => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
	storeOptions = { backend };
});

afterEach(async () => {
	await harness.destroy();
});

describe('project backup health', () => {
	it('reports a fully backed up project as restorable now', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		await backupProject(harness.db, provider, context, {
			now: () => '2026-06-10T12:05:00.000Z',
			storeOptions,
		});

		const health = await verifyRemoteProjectBackupHealth(
			harness.db,
			provider,
			context,
			storeOptions
		);

		expect(health.status).toBe('restorable-now');
		expect(health.safeToRemove).toBe(true);
		expect(health.blockingChecks).toEqual([]);
		expect(checkStatus(health, 'remote-primaries')).toBe('pass');
		expect(checkStatus(health, 'remote-history')).toBe('pass');
	});

	it('blocks safe removal when local collation edits are uncommitted', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		await backupProject(harness.db, provider, context, { storeOptions });
		await updateCollationMetadata(harness.db, {
			id: 'col-1',
			notes: 'Uncommitted local notes',
			updatedAt: '2026-06-10T12:06:00.000Z',
		});
		await saveWorkingCollationArtifact(
			harness.db,
			{
				collationId: 'col-1',
				artifactType: 'collation_document_v1',
				payload: JSON.stringify(COLLATION_FIXTURE.document),
				now: '2026-06-10T12:06:00.000Z',
			},
			storeOptions
		);

		const health = await verifyRemoteProjectBackupHealth(
			harness.db,
			provider,
			context,
			storeOptions
		);

		expect(health.status).toBe('uncommitted-changes');
		expect(health.safeToRemove).toBe(false);
		expect(checkStatus(health, 'local-committed-state')).toBe('fail');
	});

	it('reports an incomplete backup when a remote primary is missing', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		await backupProject(harness.db, provider, context, { storeOptions });
		const primary = await remoteFile(provider, context, 'collations/col-1.json');
		if (!primary) throw new Error('Expected remote collation primary.');
		await provider.deleteFile(primary.id, primary.revision);

		const health = await verifyRemoteProjectBackupHealth(
			harness.db,
			provider,
			context,
			storeOptions
		);

		expect(health.status).toBe('incomplete-backup');
		expect(health.safeToRemove).toBe(false);
		expect(checkStatus(health, 'remote-primaries')).toBe('fail');
		expect(health.quarantines).toContainEqual(
			expect.objectContaining({ path: 'collations/col-1.json' })
		);
	});

	it('reports an incomplete backup when current history is missing', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		await backupProject(harness.db, provider, context, { storeOptions });
		const history = await remoteFile(
			provider,
			context,
			'history/collations/col-1/col-cp-1.json'
		);
		if (!history) throw new Error('Expected remote collation history.');
		await provider.deleteFile(history.id, history.revision);

		const health = await verifyRemoteProjectBackupHealth(
			harness.db,
			provider,
			context,
			storeOptions
		);

		expect(health.status).toBe('incomplete-backup');
		expect(health.safeToRemove).toBe(false);
		expect(checkStatus(health, 'remote-history')).toBe('fail');
		expect(health.quarantines).toContainEqual(
			expect.objectContaining({ path: 'history/collations/col-1/col-cp-1.json' })
		);
	});
});

async function createConnectedProvider(): Promise<{
	provider: MockCloudStorageProvider;
	context: SyncProjectContext;
}> {
	await upsertCloudConnection(harness.db, {
		id: 'conn-1',
		providerId: 'mock',
		providerAccountId: 'acct-1',
		accountEmail: 'editor@example.com',
	});
	const provider = new MockCloudStorageProvider({ now: () => '2026-06-10T12:00:00.000Z' });
	const folderId = await provider.createFolder('Project');
	await upsertCloudProjectFolder(harness.db, {
		projectId: 'project-1',
		connectionId: 'conn-1',
		cloudFolderId: folderId,
		cloudFolderPath: 'Project',
	});
	return {
		provider,
		context: {
			connectionId: 'conn-1',
			projectId: 'project-1',
			cloudFolderId: folderId,
			cloudFolderPath: 'Project',
		},
	};
}

async function createCommittedProjectCollation(notes: string, checkpointId: string): Promise<void> {
	await createProject(harness.db, { id: 'project-1', name: 'Project' });
	await createCollation(harness.db, {
		id: 'col-1',
		projectId: 'project-1',
		title: 'Romans 1:1',
		verseIdentifier: 'Romans 1:1',
		now: '2026-06-10T12:00:00.000Z',
	});
	await updateCollationMetadata(harness.db, {
		id: 'col-1',
		notes,
		updatedAt: '2026-06-10T12:01:00.000Z',
	});
	await saveWorkingCollationArtifact(
		harness.db,
		{
			collationId: 'col-1',
			artifactType: 'collation_document_v1',
			payload: JSON.stringify(COLLATION_FIXTURE.document),
			now: '2026-06-10T12:01:00.000Z',
		},
		storeOptions
	);
	await createCommittedCollationCheckpointWithFiles(harness.db, {
		collationId: 'col-1',
		checkpointId,
		createdAt: '2026-06-10T12:02:00.000Z',
	}, storeOptions);
}

async function remoteFile(
	provider: MockCloudStorageProvider,
	context: SyncProjectContext,
	path: string
): Promise<CloudFileMetadata | null> {
	let cursor: string | undefined;
	do {
		const page = await provider.listFiles(context.cloudFolderId, { recursive: true, cursor });
		const match = page.entries.find(
			entry => !entry.isFolder && relativeEntryPath(entry.path, context) === path
		);
		if (match) return match;
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return null;
}

function checkStatus(
	health: Awaited<ReturnType<typeof verifyRemoteProjectBackupHealth>>,
	id: string
): string | undefined {
	return health.checks.find(item => item.id === id)?.status;
}

function relativeEntryPath(path: string, context: SyncProjectContext): string {
	const root = context.cloudFolderPath ?? '';
	return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}
