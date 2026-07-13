import type { Kysely, Selectable, Transaction } from 'kysely';

import type {
	Database,
	CloudSyncMetadata,
	CollationArtifacts,
	CollationCheckpoints,
	CollationReadingWitnesses,
	CollationReadings,
	CollationTokens,
	CollationVariationUnits,
	CollationWitnesses,
	Collations,
	IiifCanvasAnnotations,
	IiifManifestSources,
	SyncTombstones,
	TranscriptionCheckpoints,
	TranscriptionPageCanvasLinks,
	Transcriptions,
} from '$lib/client/db/types.generated';
import { createProject, getProject } from '$lib/client/db/repositories/projects';
import {
	getCollationCheckpointStatus,
	getProjectTranscriptionCheckpointStatus,
	type EntityCheckpointHead,
} from '$lib/client/db/repositories/revisions';
import { replaceTranscriptionVerseIndexRows } from '$lib/client/db/repositories/transcriptions';
import { loadProjectTranscriptionIds } from '$lib/client/db/repositories/collations';
import {
	getCloudProjectFolder,
	upsertCloudProjectFolder,
} from '$lib/client/db/repositories/cloud-connections';
import {
	collationCloudFileToImportInput,
	historyCloudFileToImportInput,
	parseCollationCloudFile,
	parseHistoryCloudFile,
	parseProjectCloudFile,
	parseProjectTranscriptionCloudFile,
	parseTombstoneCloudFile,
	projectCloudFileToRepositoryInput,
	projectRelativeCloudPaths,
	projectTranscriptionCloudFileToImportInput,
	tombstoneCloudFileToRow,
	validateCollationHeadMatchesCheckpoint,
	validateProjectTranscriptionHeadMatchesCheckpoint,
	type CollationCheckpointImportInput,
	type CollationCloudFile,
	type CollationImportInput,
	type HistoryCloudFile,
	type ProjectCloudFile,
	type ProjectTranscriptionCloudFile,
	type ProjectTranscriptionCheckpointImportInput,
	type ProjectTranscriptionImportInput,
	type TombstoneCloudFile,
} from './cloud-files';
import { canonicalJson, hashCanonicalPayload } from './canonical-json';
import {
	isCloudProviderError,
	type CloudFileMetadata,
	type CloudStorageProvider,
} from './providers/provider';
import type { SyncQuarantine } from './sync-manager';
import type { StoreOperationOptions } from '$lib/client/store';

type DbExecutor = Kysely<Database> | Transaction<Database>;

export type CloudProjectClassification =
	| 'not-local'
	| 'already-linked'
	| 'local-same-id-unlinked'
	| 'local-conflict'
	| 'quarantined'
	| 'unavailable';

export interface CloudProjectCandidate {
	connectionId: string;
	folderId: string;
	folderPath: string;
	projectId: string;
	name: string;
	description: string;
	updatedAt: string;
	classification: CloudProjectClassification;
	quarantines: SyncQuarantine[];
	manifest: ProjectCloudFile | null;
	manifestFileId: string | null;
	manifestRevision: string | null;
	providerError?: string;
	providerMessage?: string;
}

export interface ImportCloudProjectInput {
	connectionId: string;
	folderId: string;
	folderPath: string;
	mode: 'create-local';
}

export interface ImportCloudProjectResult {
	projectId: string;
	projectTranscriptionIds: string[];
	collationIds: string[];
	tombstoneIds: string[];
	quarantines: SyncQuarantine[];
}

export interface LinkedProjectManifestContext {
	connectionId: string;
	projectId: string;
	cloudFolderId: string;
	cloudFolderPath?: string;
}

export type RemoteProjectComparisonStatus =
	| 'up-to-date'
	| 'remote-update-available'
	| 'pending-local-backup'
	| 'local-uncommitted-changes'
	| 'diverged'
	| 'missing-local-entity'
	| 'unknown';

export interface RemoteProjectEntityComparison {
	entityType: 'project-transcription' | 'collation' | 'tombstone';
	entityId: string;
	cloudPath: string;
	status: RemoteProjectComparisonStatus;
	localHead: EntityCheckpointHead | null;
	remoteHead: EntityCheckpointHead | null;
	lastSyncedHead: EntityCheckpointHead | null;
}

export interface RemoteProjectManifestComparison {
	connectionId: string;
	projectId: string;
	manifestRevision: string | null;
	manifestContentHash: string;
	status: RemoteProjectComparisonStatus;
	entities: RemoteProjectEntityComparison[];
	quarantines: SyncQuarantine[];
}

export type PollLinkedProjectManifestResult =
	| { ok: true; comparison: RemoteProjectManifestComparison }
	| { ok: false; status: 'unavailable'; providerError: string; providerMessage: string };

export interface PullLinkedProjectUpdatesResult {
	projectId: string;
	projectTranscriptionIds: string[];
	collationIds: string[];
	tombstoneIds: string[];
	quarantines: SyncQuarantine[];
}

export async function listCloudProjectCandidates(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	connectionId: string,
	rootFolderId: string
): Promise<CloudProjectCandidate[]> {
	const result = await listAllProviderFiles(provider, rootFolderId);
	if (!result.ok) {
		return [
			unavailableCandidate({
				connectionId,
				folderId: rootFolderId,
				folderPath: '',
				providerError: result.providerError,
				providerMessage: result.providerMessage,
			}),
		];
	}

	const foldersByPath = new Map(
		result.entries
			.filter(entry => entry.isFolder)
			.map(entry => [normalizePath(entry.path), entry])
	);
	const projectFiles = result.entries
		.filter(entry => !entry.isFolder && isProjectManifestPath(entry.path))
		.sort((a, b) => normalizePath(a.path).localeCompare(normalizePath(b.path)));

	return Promise.all(
		projectFiles.map(async entry => {
			const folderPath = folderPathForManifest(entry.path);
			const folder = folderPath ? foldersByPath.get(folderPath) : null;
			const folderId = folder?.id ?? (folderPath ? folderPath : rootFolderId);
			return loadCloudProjectCandidate(
				db,
				provider,
				connectionId,
				folderId,
				folderPath,
				entry
			);
		})
	);
}

export async function classifyCloudProjectCandidate(
	db: Kysely<Database>,
	candidate: CloudProjectCandidate
): Promise<CloudProjectClassification> {
	if (candidate.classification === 'quarantined' || candidate.classification === 'unavailable') {
		return candidate.classification;
	}
	const localProject = await getProject(db, candidate.projectId);
	if (!localProject) return 'not-local';

	const linkedFolder = await getCloudProjectFolder(
		db,
		candidate.projectId,
		candidate.connectionId
	);
	if (!linkedFolder) return 'local-same-id-unlinked';
	if (
		linkedFolder.cloudFolderId === candidate.folderId &&
		normalizePath(linkedFolder.cloudFolderPath) === normalizePath(candidate.folderPath)
	) {
		return 'already-linked';
	}
	return 'local-conflict';
}

export async function importCloudProject(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	input: ImportCloudProjectInput,
	storeOptions: StoreOperationOptions = {}
): Promise<ImportCloudProjectResult> {
	if (input.mode !== 'create-local')
		throw new Error(`Unsupported cloud project import mode ${input.mode}.`);
	const entries = await listAllProviderFiles(provider, input.folderId);
	if (!entries.ok) {
		return {
			projectId: '',
			projectTranscriptionIds: [],
			collationIds: [],
			tombstoneIds: [],
			quarantines: [
				{
					path: input.folderPath,
					code: 'invalid_shape',
					message: entries.providerMessage,
					actual: entries.providerError,
				},
			],
		};
	}

	const filesByRelativePath = new Map(
		entries.entries
			.filter(entry => !entry.isFolder && !entry.isDeleted)
			.map(entry => [relativeEntryPath(entry.path, input.folderPath), entry])
	);
	const manifestMetadata = filesByRelativePath.get(projectRelativeCloudPaths().project);
	if (!manifestMetadata) {
		return {
			projectId: '',
			projectTranscriptionIds: [],
			collationIds: [],
			tombstoneIds: [],
			quarantines: [
				{
					path: projectRelativeCloudPaths().project,
					code: 'invalid_shape',
					message: 'Cloud project folder does not contain project.json.',
				},
			],
		};
	}

	const manifestContent = await provider.downloadFile(manifestMetadata.id);
	const parsedManifest = await parseProjectCloudFile(manifestContent);
	if (!parsedManifest.ok) {
		return {
			projectId: '',
			projectTranscriptionIds: [],
			collationIds: [],
			tombstoneIds: [],
			quarantines: [quarantineFor(manifestMetadata.path, parsedManifest.quarantine)],
		};
	}
	const manifest = parsedManifest.value;
	if (await getProject(db, manifest.id)) {
		throw new Error(`Project ${manifest.id} already exists locally.`);
	}

	const loadedTranscriptions = await loadProjectTranscriptionFiles(
		provider,
		filesByRelativePath,
		manifest
	);
	const loadedCollations = await loadCollationFiles(provider, filesByRelativePath, manifest);
	const loadedTombstones = await loadTombstoneFiles(provider, filesByRelativePath, manifest);
	const quarantines = [
		...loadedTranscriptions.quarantines,
		...loadedCollations.quarantines,
		...loadedTombstones.quarantines,
	];
	if (quarantines.length > 0) {
		return {
			projectId: manifest.id,
			projectTranscriptionIds: [],
			collationIds: [],
			tombstoneIds: [],
			quarantines,
		};
	}

	await db.transaction().execute(async trx => {
		await createProject(trx, projectCloudFileToRepositoryInput(manifest), storeOptions);
		for (const item of loadedTranscriptions.items) {
			await importProjectTranscriptionPrimary(
				trx,
				projectTranscriptionCloudFileToImportInput(manifest.id, item.primary)
			);
			await importTranscriptionCheckpoint(
				trx,
				historyCloudFileToImportInput(
					item.history
				) as ProjectTranscriptionCheckpointImportInput
			);
			await upsertPrimarySyncMetadata(trx, {
				connectionId: input.connectionId,
				projectId: manifest.id,
				entityType: 'project-transcription',
				entityId: item.primary.project_transcription_id,
				cloudPath: item.primaryMetadata.relativePath,
				cloudFileId: item.primaryMetadata.metadata.id,
				cloudFileRevision: item.primaryMetadata.metadata.revision,
				lastSyncedRevision: item.primary.current_revision.id,
				lastSyncedHash: item.primary.current_revision.content_hash,
				lastSyncedAt: item.primaryMetadata.metadata.modifiedAt,
			});
		}
		for (const item of loadedCollations.items) {
			await importCollationPrimary(trx, collationCloudFileToImportInput(item.primary));
			await importCollationCheckpoint(
				trx,
				historyCloudFileToImportInput(item.history) as CollationCheckpointImportInput
			);
			await upsertPrimarySyncMetadata(trx, {
				connectionId: input.connectionId,
				projectId: manifest.id,
				entityType: 'collation',
				entityId: item.primary.id,
				cloudPath: item.primaryMetadata.relativePath,
				cloudFileId: item.primaryMetadata.metadata.id,
				cloudFileRevision: item.primaryMetadata.metadata.revision,
				lastSyncedRevision: item.primary.current_revision.id,
				lastSyncedHash: item.primary.current_revision.content_hash,
				lastSyncedAt: item.primaryMetadata.metadata.modifiedAt,
			});
		}
		for (const item of loadedTombstones.items) {
			await importTombstone(trx, item.file);
		}
		await upsertCloudProjectFolder(trx, {
			projectId: manifest.id,
			connectionId: input.connectionId,
			cloudFolderId: input.folderId,
			cloudFolderPath: input.folderPath,
			lastFullySyncedAt: new Date().toISOString(),
		});
	});

	return {
		projectId: manifest.id,
		projectTranscriptionIds: loadedTranscriptions.items.map(
			item => item.primary.project_transcription_id
		),
		collationIds: loadedCollations.items.map(item => item.primary.id),
		tombstoneIds: loadedTombstones.items.map(item => item.file.id),
		quarantines: [],
	};
}

export async function pollLinkedProjectManifest(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	context: LinkedProjectManifestContext
): Promise<PollLinkedProjectManifestResult> {
	try {
		const manifestMetadata = await findProjectManifestMetadata(provider, context.cloudFolderId);
		if (!manifestMetadata) {
			return {
				ok: false,
				status: 'unavailable',
				providerError: 'not-found',
				providerMessage: 'Linked cloud project folder does not contain project.json.',
			};
		}
		const parsed = await parseProjectCloudFile(
			await provider.downloadFile(manifestMetadata.id)
		);
		if (!parsed.ok) {
			return {
				ok: true,
				comparison: {
					connectionId: context.connectionId,
					projectId: context.projectId,
					manifestRevision: manifestMetadata.revision,
					manifestContentHash: '',
					status: 'unknown',
					entities: [],
					quarantines: [quarantineFor(manifestMetadata.path, parsed.quarantine)],
				},
			};
		}
		return {
			ok: true,
			comparison: await compareRemoteManifestToLocalProject(db, parsed.value, context, {
				manifestRevision: manifestMetadata.revision,
			}),
		};
	} catch (error) {
		if (isCloudProviderError(error)) {
			return {
				ok: false,
				status: 'unavailable',
				providerError: error.code,
				providerMessage: error.message,
			};
		}
		throw error;
	}
}

export async function compareRemoteManifestToLocalProject(
	db: DbExecutor,
	manifest: ProjectCloudFile,
	context: Pick<LinkedProjectManifestContext, 'connectionId' | 'projectId'>,
	options: { manifestRevision?: string | null } = {}
): Promise<RemoteProjectManifestComparison> {
	const quarantines: SyncQuarantine[] = [];
	if (manifest.id !== context.projectId) {
		quarantines.push({
			path: projectRelativeCloudPaths().project,
			code: 'invalid_shape',
			message: 'Remote project manifest id does not match linked local project.',
			expected: context.projectId,
			actual: manifest.id,
		});
	}

	const entities: RemoteProjectEntityComparison[] = [];
	for (const head of manifest.transcriptions) {
		const local = await loadLocalProjectTranscriptionComparisonHead(
			db,
			head.project_transcription_id
		);
		const metadata = await getPrimarySyncMetadata(db, context, {
			entityType: 'project-transcription',
			entityId: head.project_transcription_id,
		});
		entities.push({
			entityType: 'project-transcription',
			entityId: head.project_transcription_id,
			cloudPath: head.primary_path,
			localHead: local.head,
			remoteHead: manifestHead(head.current_revision),
			lastSyncedHead: syncMetadataHead(metadata),
			status: compareEntityHeads({
				localHead: local.head,
				remoteHead: manifestHead(head.current_revision),
				lastSyncedHead: syncMetadataHead(metadata),
				localDirty: local.dirty,
			}),
		});
	}
	for (const head of manifest.collations) {
		const local = await loadLocalCollationComparisonHead(db, head.collation_id);
		const metadata = await getPrimarySyncMetadata(db, context, {
			entityType: 'collation',
			entityId: head.collation_id,
		});
		entities.push({
			entityType: 'collation',
			entityId: head.collation_id,
			cloudPath: head.primary_path,
			localHead: local.head,
			remoteHead: manifestHead(head.current_revision),
			lastSyncedHead: syncMetadataHead(metadata),
			status: compareEntityHeads({
				localHead: local.head,
				remoteHead: manifestHead(head.current_revision),
				lastSyncedHead: syncMetadataHead(metadata),
				localDirty: local.dirty,
			}),
		});
	}
	for (const head of manifest.tombstones) {
		const localExists = await localTombstoneExists(db, head.tombstone_id);
		const remoteHead = {
			revisionId: head.deletion_revision_id,
			contentHash: head.content_hash,
		};
		entities.push({
			entityType: 'tombstone',
			entityId: head.tombstone_id,
			cloudPath: head.primary_path,
			localHead: localExists ? remoteHead : null,
			remoteHead,
			lastSyncedHead: null,
			status: localExists ? 'up-to-date' : 'remote-update-available',
		});
	}

	return {
		connectionId: context.connectionId,
		projectId: context.projectId,
		manifestRevision: options.manifestRevision ?? null,
		manifestContentHash: manifest.manifest_content_hash,
		status: quarantines.length > 0 ? 'unknown' : aggregateComparisonStatus(entities),
		entities,
		quarantines,
	};
}

export async function pullLinkedProjectUpdates(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	context: LinkedProjectManifestContext
): Promise<PullLinkedProjectUpdatesResult> {
	const manifestMetadata = await findProjectManifestMetadata(provider, context.cloudFolderId);
	if (!manifestMetadata) {
		return {
			projectId: context.projectId,
			projectTranscriptionIds: [],
			collationIds: [],
			tombstoneIds: [],
			quarantines: [
				{
					path: projectRelativeCloudPaths().project,
					code: 'invalid_shape',
					message: 'Linked cloud project folder does not contain project.json.',
				},
			],
		};
	}
	const parsedManifest = await parseProjectCloudFile(
		await provider.downloadFile(manifestMetadata.id)
	);
	if (!parsedManifest.ok) {
		return {
			projectId: context.projectId,
			projectTranscriptionIds: [],
			collationIds: [],
			tombstoneIds: [],
			quarantines: [quarantineFor(manifestMetadata.path, parsedManifest.quarantine)],
		};
	}
	const manifest = parsedManifest.value;
	const comparison = await compareRemoteManifestToLocalProject(db, manifest, context, {
		manifestRevision: manifestMetadata.revision,
	});
	if (comparison.quarantines.length > 0) {
		return emptyPullResult(context.projectId, comparison.quarantines);
	}
	const blockingEntities = comparison.entities.filter(
		entity => entity.status !== 'up-to-date' && entity.status !== 'remote-update-available'
	);
	if (blockingEntities.length > 0) {
		return emptyPullResult(
			context.projectId,
			blockingEntities.map(entity => ({
				path: entity.cloudPath,
				code: 'invalid_shape',
				message: `Remote pull is blocked because ${entity.entityType} ${entity.entityId} is ${entity.status}.`,
				actual: entity.status,
			}))
		);
	}
	const changedTranscriptionIds = new Set(
		comparison.entities
			.filter(
				entity =>
					entity.entityType === 'project-transcription' &&
					entity.status === 'remote-update-available'
			)
			.map(entity => entity.entityId)
	);
	const changedCollationIds = new Set(
		comparison.entities
			.filter(
				entity =>
					entity.entityType === 'collation' && entity.status === 'remote-update-available'
			)
			.map(entity => entity.entityId)
	);
	const changedTombstoneIds = new Set(
		comparison.entities
			.filter(
				entity =>
					entity.entityType === 'tombstone' && entity.status === 'remote-update-available'
			)
			.map(entity => entity.entityId)
	);
	if (
		changedTranscriptionIds.size === 0 &&
		changedCollationIds.size === 0 &&
		changedTombstoneIds.size === 0
	) {
		return emptyPullResult(context.projectId, []);
	}

	const entries = await listAllProviderFiles(provider, context.cloudFolderId);
	if (!entries.ok) {
		return emptyPullResult(context.projectId, [
			{
				path: context.cloudFolderPath ?? '',
				code: 'invalid_shape',
				message: entries.providerMessage,
				actual: entries.providerError,
			},
		]);
	}
	const filesByRelativePath = new Map(
		entries.entries
			.filter(entry => !entry.isFolder && !entry.isDeleted)
			.map(entry => [relativeEntryPath(entry.path, context.cloudFolderPath ?? ''), entry])
	);
	const changedManifest: ProjectCloudFile = {
		...manifest,
		transcriptions: manifest.transcriptions.filter(head =>
			changedTranscriptionIds.has(head.project_transcription_id)
		),
		collations: manifest.collations.filter(head => changedCollationIds.has(head.collation_id)),
		tombstones: manifest.tombstones.filter(head => changedTombstoneIds.has(head.tombstone_id)),
	};
	const loadedTranscriptions = await loadProjectTranscriptionFiles(
		provider,
		filesByRelativePath,
		changedManifest
	);
	const loadedCollations = await loadCollationFiles(
		provider,
		filesByRelativePath,
		changedManifest
	);
	const loadedTombstones = await loadTombstoneFiles(
		provider,
		filesByRelativePath,
		changedManifest
	);
	const quarantines = [
		...loadedTranscriptions.quarantines,
		...loadedCollations.quarantines,
		...loadedTombstones.quarantines,
	];
	if (quarantines.length > 0) return emptyPullResult(context.projectId, quarantines);

	await db.transaction().execute(async trx => {
		await trx
			.updateTable('projects')
			.set({
				name: manifest.name,
				description: manifest.description,
				charter: manifest.charter,
				collation_settings: canonicalJson(manifest.collation_settings),
				updated_at: manifest.updated_at,
			})
			.where('id', '=', manifest.id)
			.execute();
		for (const item of loadedTranscriptions.items) {
			await replaceProjectTranscriptionPrimary(
				trx,
				projectTranscriptionCloudFileToImportInput(manifest.id, item.primary)
			);
			await importTranscriptionCheckpoint(
				trx,
				historyCloudFileToImportInput(
					item.history
				) as ProjectTranscriptionCheckpointImportInput
			);
			await upsertPrimarySyncMetadata(trx, {
				connectionId: context.connectionId,
				projectId: manifest.id,
				entityType: 'project-transcription',
				entityId: item.primary.project_transcription_id,
				cloudPath: item.primaryMetadata.relativePath,
				cloudFileId: item.primaryMetadata.metadata.id,
				cloudFileRevision: item.primaryMetadata.metadata.revision,
				lastSyncedRevision: item.primary.current_revision.id,
				lastSyncedHash: item.primary.current_revision.content_hash,
				lastSyncedAt: item.primaryMetadata.metadata.modifiedAt,
			});
		}
		for (const item of loadedCollations.items) {
			await replaceCollationPrimary(trx, collationCloudFileToImportInput(item.primary));
			await importCollationCheckpoint(
				trx,
				historyCloudFileToImportInput(item.history) as CollationCheckpointImportInput
			);
			await upsertPrimarySyncMetadata(trx, {
				connectionId: context.connectionId,
				projectId: manifest.id,
				entityType: 'collation',
				entityId: item.primary.id,
				cloudPath: item.primaryMetadata.relativePath,
				cloudFileId: item.primaryMetadata.metadata.id,
				cloudFileRevision: item.primaryMetadata.metadata.revision,
				lastSyncedRevision: item.primary.current_revision.id,
				lastSyncedHash: item.primary.current_revision.content_hash,
				lastSyncedAt: item.primaryMetadata.metadata.modifiedAt,
			});
		}
		for (const item of loadedTombstones.items) {
			await importTombstone(trx, item.file);
		}
		await upsertCloudProjectFolder(trx, {
			projectId: manifest.id,
			connectionId: context.connectionId,
			cloudFolderId: context.cloudFolderId,
			cloudFolderPath: context.cloudFolderPath ?? '',
			lastFullySyncedAt: new Date().toISOString(),
		});
	});

	return {
		projectId: manifest.id,
		projectTranscriptionIds: loadedTranscriptions.items.map(
			item => item.primary.project_transcription_id
		),
		collationIds: loadedCollations.items.map(item => item.primary.id),
		tombstoneIds: loadedTombstones.items.map(item => item.file.id),
		quarantines: [],
	};
}

function emptyPullResult(
	projectId: string,
	quarantines: SyncQuarantine[]
): PullLinkedProjectUpdatesResult {
	return {
		projectId,
		projectTranscriptionIds: [],
		collationIds: [],
		tombstoneIds: [],
		quarantines,
	};
}

async function loadCloudProjectCandidate(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	connectionId: string,
	folderId: string,
	folderPath: string,
	manifestMetadata: CloudFileMetadata
): Promise<CloudProjectCandidate> {
	try {
		const content = await provider.downloadFile(manifestMetadata.id);
		const parsed = await parseProjectCloudFile(content);
		if (!parsed.ok) {
			return quarantinedCandidate(connectionId, folderId, folderPath, manifestMetadata, [
				quarantineFor(manifestMetadata.path, parsed.quarantine),
			]);
		}
		const candidate: CloudProjectCandidate = {
			connectionId,
			folderId,
			folderPath,
			projectId: parsed.value.id,
			name: parsed.value.name,
			description: parsed.value.description,
			updatedAt: parsed.value.updated_at,
			classification: 'not-local',
			quarantines: [],
			manifest: parsed.value,
			manifestFileId: manifestMetadata.id,
			manifestRevision: manifestMetadata.revision,
		};
		candidate.classification = await classifyCloudProjectCandidate(db, candidate);
		return candidate;
	} catch (error) {
		if (isCloudProviderError(error)) {
			return unavailableCandidate({
				connectionId,
				folderId,
				folderPath,
				providerError: error.code,
				providerMessage: error.message,
			});
		}
		throw error;
	}
}

interface LoadedProjectTranscriptionFile {
	primary: ProjectTranscriptionCloudFile;
	history: HistoryCloudFile;
	primaryMetadata: { metadata: CloudFileMetadata; relativePath: string };
}

interface LoadedCollationFile {
	primary: CollationCloudFile;
	history: HistoryCloudFile;
	primaryMetadata: { metadata: CloudFileMetadata; relativePath: string };
}

interface LoadedTombstoneFile {
	file: TombstoneCloudFile;
}

async function loadProjectTranscriptionFiles(
	provider: CloudStorageProvider,
	filesByRelativePath: Map<string, CloudFileMetadata>,
	manifest: ProjectCloudFile
): Promise<{ items: LoadedProjectTranscriptionFile[]; quarantines: SyncQuarantine[] }> {
	const items: LoadedProjectTranscriptionFile[] = [];
	const quarantines: SyncQuarantine[] = [];
	for (const head of manifest.transcriptions) {
		const primaryMetadata = filesByRelativePath.get(head.primary_path);
		if (!primaryMetadata) {
			quarantines.push({
				path: head.primary_path,
				code: 'invalid_shape',
				message: 'Project transcription primary file is missing.',
			});
			continue;
		}
		const primaryContent = await provider.downloadFile(primaryMetadata.id);
		const parsedPrimary = await parseProjectTranscriptionCloudFile(primaryContent);
		if (!parsedPrimary.ok) {
			quarantines.push(quarantineFor(primaryMetadata.path, parsedPrimary.quarantine));
			continue;
		}
		if (parsedPrimary.value.project_transcription_id !== head.project_transcription_id) {
			quarantines.push({
				path: primaryMetadata.path,
				code: 'invalid_shape',
				message: 'Project transcription primary id does not match project manifest.',
				expected: head.project_transcription_id,
				actual: parsedPrimary.value.project_transcription_id,
			});
			continue;
		}
		if (!head.current_revision) {
			quarantines.push({
				path: primaryMetadata.path,
				code: 'invalid_shape',
				message: 'Project transcription import requires a committed current revision.',
			});
			continue;
		}
		const historyPath = projectRelativeCloudPaths().transcriptionHistory(
			head.project_transcription_id,
			head.current_revision.id
		);
		const historyMetadata = filesByRelativePath.get(historyPath);
		if (!historyMetadata) {
			quarantines.push({
				path: historyPath,
				code: 'invalid_shape',
				message: 'Project transcription current checkpoint history file is missing.',
			});
			continue;
		}
		const parsedHistory = await parseHistoryCloudFile(
			await provider.downloadFile(historyMetadata.id)
		);
		if (!parsedHistory.ok) {
			quarantines.push(quarantineFor(historyMetadata.path, parsedHistory.quarantine));
			continue;
		}
		const validation = validateProjectTranscriptionHeadMatchesCheckpoint(
			parsedPrimary.value,
			parsedHistory.value
		);
		if (!validation.ok) {
			quarantines.push(quarantineFor(historyMetadata.path, validation.quarantine));
			continue;
		}
		items.push({
			primary: parsedPrimary.value,
			history: parsedHistory.value,
			primaryMetadata: { metadata: primaryMetadata, relativePath: head.primary_path },
		});
	}
	return { items, quarantines };
}

async function loadCollationFiles(
	provider: CloudStorageProvider,
	filesByRelativePath: Map<string, CloudFileMetadata>,
	manifest: ProjectCloudFile
): Promise<{ items: LoadedCollationFile[]; quarantines: SyncQuarantine[] }> {
	const items: LoadedCollationFile[] = [];
	const quarantines: SyncQuarantine[] = [];
	for (const head of manifest.collations) {
		const primaryMetadata = filesByRelativePath.get(head.primary_path);
		if (!primaryMetadata) {
			quarantines.push({
				path: head.primary_path,
				code: 'invalid_shape',
				message: 'Collation primary file is missing.',
			});
			continue;
		}
		const parsedPrimary = await parseCollationCloudFile(
			await provider.downloadFile(primaryMetadata.id)
		);
		if (!parsedPrimary.ok) {
			quarantines.push(quarantineFor(primaryMetadata.path, parsedPrimary.quarantine));
			continue;
		}
		if (parsedPrimary.value.id !== head.collation_id) {
			quarantines.push({
				path: primaryMetadata.path,
				code: 'invalid_shape',
				message: 'Collation primary id does not match project manifest.',
				expected: head.collation_id,
				actual: parsedPrimary.value.id,
			});
			continue;
		}
		if (parsedPrimary.value.project_id !== manifest.id) {
			quarantines.push({
				path: primaryMetadata.path,
				code: 'invalid_shape',
				message: 'Collation primary project id does not match project manifest.',
				expected: manifest.id,
				actual: parsedPrimary.value.project_id,
			});
			continue;
		}
		if (!head.current_revision) {
			quarantines.push({
				path: primaryMetadata.path,
				code: 'invalid_shape',
				message: 'Collation import requires a committed current revision.',
			});
			continue;
		}
		const historyPath = projectRelativeCloudPaths().collationHistory(
			head.collation_id,
			head.current_revision.id
		);
		const historyMetadata = filesByRelativePath.get(historyPath);
		if (!historyMetadata) {
			quarantines.push({
				path: historyPath,
				code: 'invalid_shape',
				message: 'Collation current checkpoint history file is missing.',
			});
			continue;
		}
		const parsedHistory = await parseHistoryCloudFile(
			await provider.downloadFile(historyMetadata.id)
		);
		if (!parsedHistory.ok) {
			quarantines.push(quarantineFor(historyMetadata.path, parsedHistory.quarantine));
			continue;
		}
		const validation = validateCollationHeadMatchesCheckpoint(
			parsedPrimary.value,
			parsedHistory.value
		);
		if (!validation.ok) {
			quarantines.push(quarantineFor(historyMetadata.path, validation.quarantine));
			continue;
		}
		items.push({
			primary: parsedPrimary.value,
			history: parsedHistory.value,
			primaryMetadata: { metadata: primaryMetadata, relativePath: head.primary_path },
		});
	}
	return { items, quarantines };
}

async function loadTombstoneFiles(
	provider: CloudStorageProvider,
	filesByRelativePath: Map<string, CloudFileMetadata>,
	manifest: ProjectCloudFile
): Promise<{ items: LoadedTombstoneFile[]; quarantines: SyncQuarantine[] }> {
	const items: LoadedTombstoneFile[] = [];
	const quarantines: SyncQuarantine[] = [];
	for (const head of manifest.tombstones) {
		const metadata = filesByRelativePath.get(head.primary_path);
		if (!metadata) {
			quarantines.push({
				path: head.primary_path,
				code: 'invalid_shape',
				message: 'Tombstone file is missing.',
			});
			continue;
		}
		const parsed = await parseTombstoneCloudFile(await provider.downloadFile(metadata.id));
		if (!parsed.ok) {
			quarantines.push(quarantineFor(metadata.path, parsed.quarantine));
			continue;
		}
		const actualHash = await hashCanonicalPayload(parsed.value);
		if (
			parsed.value.id !== head.tombstone_id ||
			parsed.value.project_id !== manifest.id ||
			actualHash !== head.content_hash
		) {
			quarantines.push({
				path: metadata.path,
				code: 'hash_mismatch',
				message: 'Tombstone file does not match project manifest.',
				expected: {
					tombstoneId: head.tombstone_id,
					projectId: manifest.id,
					contentHash: head.content_hash,
				},
				actual: {
					tombstoneId: parsed.value.id,
					projectId: parsed.value.project_id,
					contentHash: actualHash,
				},
			});
			continue;
		}
		items.push({ file: parsed.value });
	}
	return { items, quarantines };
}

async function importProjectTranscriptionPrimary(
	db: DbExecutor,
	input: ProjectTranscriptionImportInput
): Promise<void> {
	const contentJson = canonicalJson(input.content_json);
	await db
		.insertInto('transcriptions')
		.values({
			id: input.transcription_id,
			project_id: input.project_id,
			origin_type: input.origin.source_type,
			origin_project_id: input.origin.source_project_id,
			origin_transcription_id: input.origin.source_transcription_id,
			origin_revision_id: input.origin.source_revision_id ?? '',
			origin_content_hash: input.origin.source_content_hash ?? '',
			current_revision_id: input.current_revision_id,
			current_content_hash: input.current_content_hash,
			title: input.title,
			siglum: input.siglum,
			description: input.description,
			content_json: contentJson,
			format: input.format,
			created_at: input.created_at,
			updated_at: input.updated_at,
			owner: input.owner,
			is_public: input.is_public ? 1 : 0,
			tags: canonicalJson(input.tags),
			transcriber: input.transcriber,
			repository: input.repository,
			settlement: input.settlement,
			language: input.language,
		} satisfies Selectable<Transcriptions>)
		.execute();
	await db
		.insertInto('project_transcriptions')
		.values({
			id: input.project_transcription_id,
			project_id: input.project_id,
			transcription_id: input.transcription_id,
			canonical_transcription_id: input.canonical_transcription_id,
			added_at: input.created_at,
		})
		.execute();
	await replaceTranscriptionVerseIndexRows(
		db,
		input.transcription_id,
		contentJson,
		input.updated_at
	);
	await importProjectTranscriptionChildren(db, input);
}

async function replaceProjectTranscriptionPrimary(
	db: DbExecutor,
	input: ProjectTranscriptionImportInput
): Promise<void> {
	const contentJson = canonicalJson(input.content_json);
	await db
		.deleteFrom('iiif_canvas_annotations')
		.where('transcription_id', '=', input.transcription_id)
		.execute();
	await db
		.deleteFrom('transcription_page_canvas_links')
		.where('transcription_id', '=', input.transcription_id)
		.execute();
	await db
		.deleteFrom('iiif_manifest_sources')
		.where('transcription_id', '=', input.transcription_id)
		.execute();
	await db
		.updateTable('transcriptions')
		.set({
			project_id: input.project_id,
			origin_type: input.origin.source_type,
			origin_project_id: input.origin.source_project_id,
			origin_transcription_id: input.origin.source_transcription_id,
			origin_revision_id: input.origin.source_revision_id ?? '',
			origin_content_hash: input.origin.source_content_hash ?? '',
			current_revision_id: input.current_revision_id,
			current_content_hash: input.current_content_hash,
			title: input.title,
			siglum: input.siglum,
			description: input.description,
			content_json: contentJson,
			format: input.format,
			updated_at: input.updated_at,
			owner: input.owner,
			is_public: input.is_public ? 1 : 0,
			tags: canonicalJson(input.tags),
			transcriber: input.transcriber,
			repository: input.repository,
			settlement: input.settlement,
			language: input.language,
		})
		.where('id', '=', input.transcription_id)
		.execute();
	await db
		.updateTable('project_transcriptions')
		.set({
			project_id: input.project_id,
			transcription_id: input.transcription_id,
			canonical_transcription_id: input.canonical_transcription_id,
		})
		.where('id', '=', input.project_transcription_id)
		.execute();
	await replaceTranscriptionVerseIndexRows(
		db,
		input.transcription_id,
		contentJson,
		input.updated_at
	);
	await importProjectTranscriptionChildren(db, input);
}

async function importProjectTranscriptionChildren(
	db: DbExecutor,
	input: ProjectTranscriptionImportInput
): Promise<void> {
	if (input.iiif_manifest_sources.length > 0) {
		await db
			.insertInto('iiif_manifest_sources')
			.values(
				input.iiif_manifest_sources.map(
					(row): Selectable<IiifManifestSources> => ({
						id: row.id,
						transcription_id: input.transcription_id,
						manifest_url: row.manifest_url,
						label: row.label,
						source_kind: row.source_kind,
						default_canvas_id: row.default_canvas_id,
						default_image_service_url: row.default_image_service_url,
						metadata_json: canonicalJson(row.metadata_json),
						created_at: input.updated_at,
						updated_at: input.updated_at,
					})
				)
			)
			.execute();
	}
	if (input.page_canvas_links.length > 0) {
		await db
			.insertInto('transcription_page_canvas_links')
			.values(
				input.page_canvas_links.map(
					(row): Selectable<TranscriptionPageCanvasLinks> => ({
						id: row.id,
						transcription_id: input.transcription_id,
						page_id: row.page_id,
						page_name_snapshot: row.page_name_snapshot,
						page_order: row.page_order,
						manifest_source_id: row.manifest_source_id,
						manifest_url_snapshot: row.manifest_url_snapshot,
						canvas_id: row.canvas_id,
						canvas_order: row.canvas_order,
						canvas_label: row.canvas_label,
						image_service_url: row.image_service_url,
						thumbnail_url: row.thumbnail_url,
						link_role: row.link_role,
						created_at: input.updated_at,
						updated_at: input.updated_at,
					})
				)
			)
			.execute();
	}
	if (input.canvas_annotations.length > 0) {
		await db
			.insertInto('iiif_canvas_annotations')
			.values(
				input.canvas_annotations.map(
					(row): Selectable<IiifCanvasAnnotations> => ({
						id: row.id,
						transcription_id: input.transcription_id,
						manifest_source_id: row.manifest_source_id,
						canvas_id: row.canvas_id,
						page_id: row.page_id,
						annotation_id: row.annotation_id,
						annotation_kind: row.annotation_kind,
						body_json: canonicalJson(row.body_json),
						target_json: canonicalJson(row.target_json),
						anchor_json: canonicalJson(row.anchor_json),
						motivation: row.motivation,
						created_by: row.created_by,
						created_at: input.updated_at,
						updated_at: input.updated_at,
					})
				)
			)
			.execute();
	}
}

async function importTranscriptionCheckpoint(
	db: DbExecutor,
	input: ProjectTranscriptionCheckpointImportInput
): Promise<void> {
	await db
		.insertInto('transcription_checkpoints')
		.values({
			id: input.checkpoint_id,
			transcription_id: input.transcription_id,
			parent_checkpoint_id: input.parent_checkpoint_id,
			format: input.format,
			content_hash: input.content_hash,
			is_committed: 1,
			commit_message: input.commit_message,
			author_name: input.author_name,
			created_at: input.created_at,
		} satisfies Selectable<TranscriptionCheckpoints>)
		.onConflict(oc => oc.column('id').doNothing())
		.execute();
}

async function importCollationPrimary(db: DbExecutor, input: CollationImportInput): Promise<void> {
	await db
		.insertInto('collations')
		.values({
			id: input.id,
			project_id: input.project_id,
			current_revision_id: input.current_revision_id,
			current_content_hash: input.current_content_hash,
			title: input.title,
			verse_identifier: input.verse_identifier,
			status: input.status,
			group_path: input.group_path,
			notes: input.notes,
			sort_key: input.sort_key,
			created_at: input.created_at,
			updated_at: input.updated_at,
		} satisfies Selectable<Collations>)
		.execute();
	if (input.artifacts.length > 0) {
		await db
			.insertInto('collation_artifacts')
			.values(
				input.artifacts.map(
					(row): Selectable<CollationArtifacts> => ({
						id: row.id,
						collation_id: input.id,
						artifact_type: row.artifact_type,
						payload: canonicalJson(row.payload),
						created_at: input.updated_at,
					})
				)
			)
			.execute();
	}
	if (input.witnesses.length > 0) {
		const projectTranscriptionByTranscription = await loadProjectTranscriptionIds(
			db,
			input.project_id,
			input.witnesses.map(row => row.transcription_id)
		);
		await db
			.insertInto('collation_witnesses')
			.values(
				input.witnesses.map(
					(row): Selectable<CollationWitnesses> => ({
						...row,
						project_transcription_id:
							row.project_transcription_id ??
							(row.transcription_id
								? (projectTranscriptionByTranscription.get(row.transcription_id) ??
									null)
								: null),
						collation_id: input.id,
					})
				)
			)
			.execute();
	}
	if (input.tokens.length > 0) {
		await db
			.insertInto('collation_tokens')
			.values(
				input.tokens.map(
					(row): Selectable<CollationTokens> => ({
						...row,
						collation_id: input.id,
					})
				)
			)
			.execute();
	}
	if (input.variation_units.length > 0) {
		await db
			.insertInto('collation_variation_units')
			.values(
				input.variation_units.map(
					(row): Selectable<CollationVariationUnits> => ({
						...row,
						collation_id: input.id,
					})
				)
			)
			.execute();
	}
	if (input.readings.length > 0) {
		await db
			.insertInto('collation_readings')
			.values(
				input.readings.map(
					(row): Selectable<CollationReadings> => ({
						...row,
						is_lacuna: row.is_lacuna ? 1 : 0,
						is_omission: row.is_omission ? 1 : 0,
					})
				)
			)
			.execute();
	}
	if (input.reading_witnesses.length > 0) {
		await db
			.insertInto('collation_reading_witnesses')
			.values(
				input.reading_witnesses.map(
					(row): Selectable<CollationReadingWitnesses> => ({
						id: `${row.reading_id}:${row.witness_id}`,
						reading_id: row.reading_id,
						witness_id: row.witness_id,
					})
				)
			)
			.execute();
	}
}

async function replaceCollationPrimary(db: DbExecutor, input: CollationImportInput): Promise<void> {
	await db
		.deleteFrom('collation_reading_witnesses')
		.where(
			'reading_id',
			'in',
			db
				.selectFrom('collation_readings')
				.innerJoin(
					'collation_variation_units',
					'collation_variation_units.id',
					'collation_readings.variation_unit_id'
				)
				.select('collation_readings.id')
				.where('collation_variation_units.collation_id', '=', input.id)
		)
		.execute();
	await db
		.deleteFrom('collation_readings')
		.where(
			'variation_unit_id',
			'in',
			db
				.selectFrom('collation_variation_units')
				.select('id')
				.where('collation_id', '=', input.id)
		)
		.execute();
	await db.deleteFrom('collation_variation_units').where('collation_id', '=', input.id).execute();
	await db.deleteFrom('collation_tokens').where('collation_id', '=', input.id).execute();
	await db.deleteFrom('collation_witnesses').where('collation_id', '=', input.id).execute();
	await db.deleteFrom('collation_artifacts').where('collation_id', '=', input.id).execute();
	await db
		.updateTable('collations')
		.set({
			project_id: input.project_id,
			current_revision_id: input.current_revision_id,
			current_content_hash: input.current_content_hash,
			title: input.title,
			verse_identifier: input.verse_identifier,
			status: input.status,
			group_path: input.group_path,
			notes: input.notes,
			sort_key: input.sort_key,
			updated_at: input.updated_at,
		})
		.where('id', '=', input.id)
		.execute();
	if (input.artifacts.length > 0) {
		await db
			.insertInto('collation_artifacts')
			.values(
				input.artifacts.map(
					(row): Selectable<CollationArtifacts> => ({
						id: row.id,
						collation_id: input.id,
						artifact_type: row.artifact_type,
						payload: canonicalJson(row.payload),
						created_at: input.updated_at,
					})
				)
			)
			.execute();
	}
	if (input.witnesses.length > 0) {
		const projectTranscriptionByTranscription = await loadProjectTranscriptionIds(
			db,
			input.project_id,
			input.witnesses.map(row => row.transcription_id)
		);
		await db
			.insertInto('collation_witnesses')
			.values(
				input.witnesses.map(
					(row): Selectable<CollationWitnesses> => ({
						...row,
						project_transcription_id: row.transcription_id
							? (projectTranscriptionByTranscription.get(row.transcription_id) ??
								null)
							: null,
						collation_id: input.id,
					})
				)
			)
			.execute();
	}
	if (input.tokens.length > 0) {
		await db
			.insertInto('collation_tokens')
			.values(
				input.tokens.map(
					(row): Selectable<CollationTokens> => ({ ...row, collation_id: input.id })
				)
			)
			.execute();
	}
	if (input.variation_units.length > 0) {
		await db
			.insertInto('collation_variation_units')
			.values(
				input.variation_units.map(
					(row): Selectable<CollationVariationUnits> => ({
						...row,
						collation_id: input.id,
					})
				)
			)
			.execute();
	}
	if (input.readings.length > 0) {
		await db
			.insertInto('collation_readings')
			.values(
				input.readings.map(
					(row): Selectable<CollationReadings> => ({
						...row,
						is_lacuna: row.is_lacuna ? 1 : 0,
						is_omission: row.is_omission ? 1 : 0,
					})
				)
			)
			.execute();
	}
	if (input.reading_witnesses.length > 0) {
		await db
			.insertInto('collation_reading_witnesses')
			.values(
				input.reading_witnesses.map(
					(row): Selectable<CollationReadingWitnesses> => ({
						id: `${row.reading_id}:${row.witness_id}`,
						reading_id: row.reading_id,
						witness_id: row.witness_id,
					})
				)
			)
			.execute();
	}
}

async function importCollationCheckpoint(
	db: DbExecutor,
	input: CollationCheckpointImportInput
): Promise<void> {
	await db
		.insertInto('collation_checkpoints')
		.values({
			id: input.checkpoint_id,
			collation_id: input.collation_id,
			parent_checkpoint_id: input.parent_checkpoint_id,
			content_hash: input.content_hash,
			is_committed: 1,
			commit_message: input.commit_message,
			author_name: input.author_name,
			created_at: input.created_at,
		} satisfies Selectable<CollationCheckpoints>)
		.onConflict(oc => oc.column('id').doNothing())
		.execute();
}

async function importTombstone(db: DbExecutor, input: TombstoneCloudFile): Promise<void> {
	await db
		.insertInto('sync_tombstones')
		.values(tombstoneCloudFileToRow(input) satisfies Selectable<SyncTombstones>)
		.onConflict(oc => oc.column('id').doNothing())
		.execute();
}

async function upsertPrimarySyncMetadata(
	db: DbExecutor,
	input: {
		connectionId: string;
		projectId: string;
		entityType: string;
		entityId: string;
		cloudFileId: string;
		cloudFileRevision: string;
		cloudPath: string;
		lastSyncedRevision: string;
		lastSyncedHash: string;
		lastSyncedAt: string;
	}
): Promise<void> {
	await db
		.insertInto('cloud_sync_metadata')
		.values({
			connection_id: input.connectionId,
			scope_type: 'project',
			scope_id: input.projectId,
			entity_type: input.entityType,
			entity_id: input.entityId,
			cloud_file_id: input.cloudFileId,
			cloud_file_revision: input.cloudFileRevision,
			cloud_path: input.cloudPath,
			last_synced_revision: input.lastSyncedRevision,
			last_synced_hash: input.lastSyncedHash,
			last_synced_at: input.lastSyncedAt,
		})
		.onConflict(oc =>
			oc
				.columns(['connection_id', 'scope_type', 'scope_id', 'entity_type', 'entity_id'])
				.doUpdateSet({
					cloud_file_id: input.cloudFileId,
					cloud_file_revision: input.cloudFileRevision,
					cloud_path: input.cloudPath,
					last_synced_revision: input.lastSyncedRevision,
					last_synced_hash: input.lastSyncedHash,
					last_synced_at: input.lastSyncedAt,
				})
		)
		.execute();
}

async function findProjectManifestMetadata(
	provider: CloudStorageProvider,
	folderId: string
): Promise<CloudFileMetadata | null> {
	let cursor: string | undefined;
	do {
		const page = await provider.listFiles(folderId, { recursive: false, cursor });
		const manifest = page.entries.find(
			entry => !entry.isFolder && isProjectManifestPath(entry.path)
		);
		if (manifest) return manifest;
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return null;
}

async function loadLocalProjectTranscriptionComparisonHead(
	db: DbExecutor,
	projectTranscriptionId: string
): Promise<{ head: EntityCheckpointHead | null; dirty: boolean }> {
	const exists = await db
		.selectFrom('project_transcriptions')
		.select('id')
		.where('id', '=', projectTranscriptionId)
		.executeTakeFirst();
	if (!exists) return { head: null, dirty: false };
	const status = await getProjectTranscriptionCheckpointStatus(db, projectTranscriptionId);
	return { head: status.currentCheckpoint, dirty: status.dirtyToCheckpoint };
}

async function loadLocalCollationComparisonHead(
	db: DbExecutor,
	collationId: string
): Promise<{ head: EntityCheckpointHead | null; dirty: boolean }> {
	const exists = await db
		.selectFrom('collations')
		.select('id')
		.where('id', '=', collationId)
		.executeTakeFirst();
	if (!exists) return { head: null, dirty: false };
	const status = await getCollationCheckpointStatus(db, collationId);
	return { head: status.currentCheckpoint, dirty: status.dirtyToCheckpoint };
}

async function localTombstoneExists(db: DbExecutor, tombstoneId: string): Promise<boolean> {
	const row = await db
		.selectFrom('sync_tombstones')
		.select('id')
		.where('id', '=', tombstoneId)
		.executeTakeFirst();
	return Boolean(row);
}

async function getPrimarySyncMetadata(
	db: DbExecutor,
	context: Pick<LinkedProjectManifestContext, 'connectionId' | 'projectId'>,
	input: { entityType: string; entityId: string }
): Promise<Selectable<CloudSyncMetadata> | null> {
	const row = await db
		.selectFrom('cloud_sync_metadata')
		.selectAll()
		.where('connection_id', '=', context.connectionId)
		.where('scope_type', '=', 'project')
		.where('scope_id', '=', context.projectId)
		.where('entity_type', '=', input.entityType)
		.where('entity_id', '=', input.entityId)
		.executeTakeFirst();
	return row ?? null;
}

function compareEntityHeads(input: {
	localHead: EntityCheckpointHead | null;
	remoteHead: EntityCheckpointHead | null;
	lastSyncedHead: EntityCheckpointHead | null;
	localDirty: boolean;
}): RemoteProjectComparisonStatus {
	if (input.localDirty) return 'local-uncommitted-changes';
	if (!input.localHead && input.remoteHead) return 'missing-local-entity';
	if (!input.remoteHead && input.localHead) return 'pending-local-backup';
	if (!input.localHead || !input.remoteHead) return 'unknown';
	if (!input.lastSyncedHead) {
		return headsEqual(input.localHead, input.remoteHead) ? 'up-to-date' : 'unknown';
	}
	const localMatchesSync = headsEqual(input.localHead, input.lastSyncedHead);
	const remoteMatchesSync = headsEqual(input.remoteHead, input.lastSyncedHead);
	if (headsEqual(input.localHead, input.remoteHead)) return 'up-to-date';
	if (localMatchesSync && !remoteMatchesSync) return 'remote-update-available';
	if (!localMatchesSync && remoteMatchesSync) return 'pending-local-backup';
	return 'diverged';
}

function aggregateComparisonStatus(
	entities: RemoteProjectEntityComparison[]
): RemoteProjectComparisonStatus {
	const priority: RemoteProjectComparisonStatus[] = [
		'diverged',
		'local-uncommitted-changes',
		'unknown',
		'missing-local-entity',
		'remote-update-available',
		'pending-local-backup',
	];
	for (const status of priority) {
		if (entities.some(entity => entity.status === status)) return status;
	}
	return 'up-to-date';
}

function manifestHead(
	head: { id: string; content_hash: string } | null
): EntityCheckpointHead | null {
	return head ? { revisionId: head.id, contentHash: head.content_hash } : null;
}

function syncMetadataHead(row: Selectable<CloudSyncMetadata> | null): EntityCheckpointHead | null {
	return row ? { revisionId: row.last_synced_revision, contentHash: row.last_synced_hash } : null;
}

function headsEqual(left: EntityCheckpointHead, right: EntityCheckpointHead): boolean {
	return left.revisionId === right.revisionId && left.contentHash === right.contentHash;
}

async function listAllProviderFiles(
	provider: CloudStorageProvider,
	rootFolderId: string
): Promise<
	| { ok: true; entries: CloudFileMetadata[] }
	| { ok: false; providerError: string; providerMessage: string }
> {
	const entries: CloudFileMetadata[] = [];
	let cursor: string | undefined;
	try {
		do {
			const page = await provider.listFiles(rootFolderId, { recursive: true, cursor });
			entries.push(...page.entries);
			cursor = page.hasMore ? page.cursor : undefined;
		} while (cursor);
		return { ok: true, entries };
	} catch (error) {
		if (isCloudProviderError(error)) {
			return { ok: false, providerError: error.code, providerMessage: error.message };
		}
		throw error;
	}
}

function quarantinedCandidate(
	connectionId: string,
	folderId: string,
	folderPath: string,
	manifestMetadata: CloudFileMetadata,
	quarantines: SyncQuarantine[]
): CloudProjectCandidate {
	return {
		connectionId,
		folderId,
		folderPath,
		projectId: '',
		name: manifestMetadata.name,
		description: '',
		updatedAt: manifestMetadata.modifiedAt,
		classification: 'quarantined',
		quarantines,
		manifest: null,
		manifestFileId: manifestMetadata.id,
		manifestRevision: manifestMetadata.revision,
	};
}

function unavailableCandidate(input: {
	connectionId: string;
	folderId: string;
	folderPath: string;
	providerError: string;
	providerMessage: string;
}): CloudProjectCandidate {
	return {
		connectionId: input.connectionId,
		folderId: input.folderId,
		folderPath: input.folderPath,
		projectId: '',
		name: input.folderPath || 'Cloud project',
		description: '',
		updatedAt: '',
		classification: 'unavailable',
		quarantines: [],
		manifest: null,
		manifestFileId: null,
		manifestRevision: null,
		providerError: input.providerError,
		providerMessage: input.providerMessage,
	};
}

function quarantineFor(
	path: string,
	quarantine: {
		code: SyncQuarantine['code'];
		message: string;
		expected?: unknown;
		actual?: unknown;
	}
): SyncQuarantine {
	return {
		path,
		code: quarantine.code,
		message: quarantine.message,
		expected: quarantine.expected,
		actual: quarantine.actual,
	};
}

function isProjectManifestPath(path: string): boolean {
	const normalized = normalizePath(path);
	return normalized === 'project.json' || normalized.endsWith('/project.json');
}

function folderPathForManifest(path: string): string {
	const normalized = normalizePath(path);
	const index = normalized.lastIndexOf('/project.json');
	return index === -1 ? '' : normalized.slice(0, index);
}

function normalizePath(path: string): string {
	return path.replace(/^\/+|\/+$/g, '');
}

function relativeEntryPath(path: string, folderPath: string): string {
	const normalizedPath = normalizePath(path);
	const normalizedFolder = normalizePath(folderPath);
	if (!normalizedFolder) return normalizedPath;
	return normalizedPath.startsWith(`${normalizedFolder}/`)
		? normalizedPath.slice(normalizedFolder.length + 1)
		: normalizedPath;
}
