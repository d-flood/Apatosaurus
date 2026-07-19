import type { DbRequest, DbResponse } from './rpc';
import { listCollationsWithProjectNames, saveCollationProjection } from './repositories/collations';
import {
	deleteCollationWithFiles,
	deleteTranscriptionWithFiles,
} from './repositories/entity-deletion';
import {
	createCollationWithFilesResult,
	createCommittedCollationCheckpointWithFiles,
	getCollationVersionStatusWithWorkingFile,
	listProjectCollationVersionStatusesWithWorkingFiles,
	loadCollationWithWorkingFile,
	saveWorkingCollationArtifact,
	saveWorkingCollationMetadata,
} from './repositories/collation-files';
import {
	createProject,
	forkProject,
	getProject,
	getProjectTranscriptionIds,
	getProjectTranscriptionStatus,
	getProjectTranscriptionStatusForOwnedTranscription,
	listProjects,
	listProjectDocumentTitles,
	listProjectTranscriptionOptions,
	listProjectTranscriptionStatuses,
	listProjectTranscriptionSourceCandidates,
	ensureDefaultProject,
	addProjectTranscriptionFromProject,
	refreshProjectTranscription,
	syncProjectTranscriptionIds,
	updateProjectMetadata,
} from './repositories/projects';
import { removeLocalProject } from './repositories/project-removal';
import {
	getTranscriptionSummary,
	getTranscriptionVersionsByIds,
	getVerseIndexRowsForVerse,
	listVerseIndexRowsForTranscription,
	listVerseIndexRowsForTranscriptions,
	listVerseIndexRows,
	listTranscriptionSummaries,
} from './repositories/transcriptions';
import {
	createTranscriptionWithFilesResult,
	createTranscriptionsWithFilesResult,
	createCommittedTranscriptionCheckpointWithFiles,
	getProjectTranscriptionCheckpointStatusWithFiles,
	getTranscriptionsWithWorkingFilesByIds,
	loadTranscriptionContentWithFiles,
	loadTranscriptionWithWorkingFile,
	rebuildVerseIndexForTranscriptionsWithFiles,
	saveWorkingTranscriptionContent,
	saveWorkingTranscriptionMetadata,
} from './repositories/transcription-files';
import * as iiifRepository from './repositories/iiif';
import * as iiifFiles from './repositories/iiif-files';
import {
	isCollationDirty,
	isTranscriptionDirty,
	getLatestProjectCommitTimestamp,
	listCommittedTranscriptionCheckpoints,
	loadCommittedTranscriptionCheckpointPayload,
} from './repositories/revisions';
import { rebuildIndexFromStore, restoreOrphanPrimaryToProject } from './repositories/index-rebuild';
import { clearDomainTables } from './repositories/maintenance';
import {
	disconnectCloudConnection,
	getCloudConnection,
	listCloudProjectFolders,
	listCloudConnections,
	upsertCloudProjectFolder,
	upsertCloudConnection,
} from './repositories/cloud-connections';
import {
	backupProject,
	backupProjectEntity,
	deriveProjectBackupSummary,
	downloadAndCompareProjectManifest,
} from '$lib/client/sync/sync-manager';
import { verifyRemoteProjectBackupHealth } from '$lib/client/sync/backup-health';
import { exportAllProjectsZip, exportProjectZip } from '$lib/client/sync/project-zip-export';
import {
	cleanStaleProjectImportStaging,
	importProjectZip,
} from '$lib/client/sync/project-zip-import';
import {
	importCloudProject,
	listCloudProjectCandidates,
	pollLinkedProjectManifest,
	pullLinkedProjectUpdates,
} from '$lib/client/sync/project-restore';
import {
	createProviderForConnection,
	createProviderForSyncTarget,
} from '$lib/client/sync/provider-factory';
import type { CloudStorageProvider } from '$lib/client/sync/providers/provider';
import { cleanupStaleIndexFiles, removeCurrentIndexFiles } from './index-files';
import type { Database } from './types.generated';
import { createWorkerKysely } from './worker-kysely';
import { LocalSqliteDatabase, type OpenIndexDatabaseResult } from './worker-sqlite';
import { createCurrentIndexSchema } from './worker-schema';
import type { Kysely } from 'kysely';

const db = new LocalSqliteDatabase();
let kyselyDb: Kysely<Database> | null = null;
let initialized = false;
let requestQueue = Promise.resolve();

type IndexStartupRebuildReason = 'missing' | 'open-failed' | 'integrity-failed';

interface IndexStartupOpenResult extends OpenIndexDatabaseResult {
	rebuildReason: IndexStartupRebuildReason | null;
	rebuildDetails: string[];
}

self.onmessage = async (event: MessageEvent<DbRequest>) => {
	const request = event.data;
	const receivedAt = now();
	requestQueue = requestQueue.then(
		() => processRequest(request, receivedAt),
		() => processRequest(request, receivedAt)
	);
};

async function processRequest(request: DbRequest, receivedAt: number): Promise<void> {
	const startedAt = now();
	const queueWaitMs = elapsed(receivedAt);
	try {
		const result = await handleRequest(request);
		logWorkerTiming(request, queueWaitMs, elapsed(startedAt));
		postResponse({ id: request.id ?? 0, ok: true, result });
	} catch (error) {
		console.error('[local-db] worker request failed', {
			type: request.type,
			id: request.id,
			queueWaitMs,
			handlerMs: elapsed(startedAt),
			error: error instanceof Error ? error.message : String(error),
		});
		postResponse({
			id: request.id ?? 0,
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function handleRequest(request: DbRequest): Promise<unknown> {
	if (request.type === 'init') {
		await init();
		return null;
	}
	await init();
	if (request.type === 'query') return db.query(request.sql, request.params ?? []);
	if (request.type === 'execute') return db.execute(request.sql, request.params ?? []);
	if (request.type === 'exec') {
		await db.exec(request.sql);
		return null;
	}
	if (request.type === 'cloudConnections.list') return listCloudConnections(getKyselyDb());
	if (request.type === 'cloudConnections.upsert') {
		const connection = await upsertCloudConnection(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'cloud-connections' });
		return connection;
	}
	if (request.type === 'cloudConnections.disconnect') {
		const disconnected = await disconnectCloudConnection(getKyselyDb(), request.connectionId);
		postMessage({ type: 'db:invalidate', domain: 'cloud-connections' });
		return disconnected;
	}
	if (request.type === 'cloudProjectFolders.list') {
		return listCloudProjectFolders(getKyselyDb(), request.projectId);
	}
	if (request.type === 'cloudProjectFolders.upsert') {
		const folder = await upsertCloudProjectFolder(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'cloud-project-folders' });
		return folder;
	}
	if (request.type === 'projectBackup.summary') {
		return deriveProjectBackupSummary(getKyselyDb(), request.context, request.folder ?? null);
	}
	if (request.type === 'projectBackup.compareManifest') {
		const db = getKyselyDb();
		const provider = await createProviderForBackupContext(db, request.context.connectionId);
		return downloadAndCompareProjectManifest(db, provider, request.context);
	}
	if (request.type === 'projectBackup.verifyHealth') {
		const db = getKyselyDb();
		const provider = await createProviderForBackupContext(db, request.context.connectionId);
		return verifyRemoteProjectBackupHealth(db, provider, request.context);
	}
	if (request.type === 'projectBackup.removeLocalProject') {
		const result = await removeLocalProject(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'projects' });
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		postMessage({ type: 'db:invalidate', domain: 'collations' });
		postMessage({ type: 'db:invalidate', domain: 'cloud-project-folders' });
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return result;
	}
	if (request.type === 'projectBackup.backup') {
		const db = getKyselyDb();
		const provider = await createProviderForBackupContext(db, request.context.connectionId);
		const result = await backupProject(db, provider, request.context, {
			folder: request.folder ?? null,
			strict: request.strict ?? true,
		});
		postMessage({ type: 'db:invalidate', domain: 'cloud-project-folders' });
		postMessage({ type: 'db:invalidate', domain: 'cloud-connections' });
		postMessage({ type: 'db:invalidate', domain: 'sync-targets' });
		if (
			result.downloadedPaths.length > 0 ||
			result.deletedPaths.length > 0 ||
			result.conflictCopyId
		) {
			postMessage({ type: 'db:invalidate', domain: 'projects' });
			postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
			postMessage({ type: 'db:invalidate', domain: 'collations' });
			postMessage({ type: 'db:invalidate', domain: 'iiif' });
		}
		return result;
	}
	if (request.type === 'projectBackup.backupEntity') {
		const db = getKyselyDb();
		const provider = await createProviderForBackupContext(db, request.context.connectionId);
		const result = await backupProjectEntity(db, provider, request.context, request.reference, {
			folder: request.folder ?? null,
		});
		postMessage({ type: 'db:invalidate', domain: 'cloud-project-folders' });
		postMessage({
			type: 'db:invalidate',
			domain: request.reference.entityType === 'collation' ? 'collations' : 'transcriptions',
		});
		return result;
	}
	if (request.type === 'projectBackup.exportZip') {
		return exportProjectZip(getKyselyDb(), request.projectId, {
			includeDrafts: request.includeDrafts ?? false,
		});
	}
	if (request.type === 'projectBackup.exportAllZip') {
		return exportAllProjectsZip(getKyselyDb(), {
			includeDrafts: request.includeDrafts ?? false,
		});
	}
	if (request.type === 'projectBackup.importZip') {
		const result = await importProjectZip(getKyselyDb(), request.bytes, {
			collisionMode: request.collisionMode,
		});
		if (result.ok) {
			postMessage({ type: 'db:invalidate', domain: 'projects' });
			postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
			postMessage({ type: 'db:invalidate', domain: 'collations' });
			postMessage({ type: 'db:invalidate', domain: 'iiif' });
		}
		return result;
	}
	if (request.type === 'cloudProjects.listCandidates') {
		const db = getKyselyDb();
		const connection = await getCloudConnection(db, request.connectionId);
		if (!connection) throw new Error('Cloud connection was not found.');
		const provider = await createProviderForConnection(connection);
		return listCloudProjectCandidates(
			db,
			provider,
			connection.id,
			request.rootFolderId?.trim() || providerRootFolderId(provider)
		);
	}
	if (request.type === 'cloudProjects.import') {
		const db = getKyselyDb();
		const connection = await getCloudConnection(db, request.input.connectionId);
		if (!connection) throw new Error('Cloud connection was not found.');
		const provider = await createProviderForConnection(connection);
		const result = await importCloudProject(db, provider, request.input);
		postMessage({ type: 'db:invalidate', domain: 'projects' });
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		postMessage({ type: 'db:invalidate', domain: 'collations' });
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		postMessage({ type: 'db:invalidate', domain: 'cloud-project-folders' });
		return result;
	}
	if (request.type === 'cloudProjects.pollLinkedManifest') {
		const db = getKyselyDb();
		const connection = await getCloudConnection(db, request.context.connectionId);
		if (!connection) throw new Error('Cloud connection was not found.');
		const provider = await createProviderForConnection(connection);
		return pollLinkedProjectManifest(db, provider, request.context);
	}
	if (request.type === 'cloudProjects.pullLinkedUpdates') {
		const db = getKyselyDb();
		const connection = await getCloudConnection(db, request.context.connectionId);
		if (!connection) throw new Error('Cloud connection was not found.');
		const provider = await createProviderForConnection(connection);
		const result = await pullLinkedProjectUpdates(db, provider, request.context);
		postMessage({ type: 'db:invalidate', domain: 'projects' });
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		postMessage({ type: 'db:invalidate', domain: 'collations' });
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		postMessage({ type: 'db:invalidate', domain: 'cloud-project-folders' });
		return result;
	}
	if (request.type === 'transcriptions.listSummaries')
		return listTranscriptionSummaries(getKyselyDb());
	if (request.type === 'transcriptions.getSummary')
		return getTranscriptionSummary(getKyselyDb(), request.transcriptionId);
	if (request.type === 'transcriptions.getVersionsByIds')
		return getTranscriptionVersionsByIds(getKyselyDb(), request.ids);
	if (request.type === 'transcriptions.get')
		return loadTranscriptionWithWorkingFile(getKyselyDb(), request.transcriptionId, {
			allowIndexFallback: false,
		});
	if (request.type === 'transcriptions.getByIds')
		return getTranscriptionsWithWorkingFilesByIds(getKyselyDb(), request.ids, {
			allowIndexFallback: false,
		});
	if (request.type === 'transcriptions.create') {
		const result = await createTranscriptionWithFilesResult(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		postMessage({ type: 'db:invalidate', domain: 'projects' });
		return result;
	}
	if (request.type === 'transcriptions.createMany') {
		const result = await createTranscriptionsWithFilesResult(getKyselyDb(), request.inputs);
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		postMessage({ type: 'db:invalidate', domain: 'projects' });
		return result;
	}
	if (request.type === 'transcriptions.updateContent') {
		await saveWorkingTranscriptionContent(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		return null;
	}
	if (request.type === 'transcriptions.updateMetadata') {
		await saveWorkingTranscriptionMetadata(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		return null;
	}
	if (request.type === 'transcriptions.delete') {
		const warnings = await deleteTranscriptionWithFiles(getKyselyDb(), request.transcriptionId);
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		postMessage({ type: 'db:invalidate', domain: 'projects' });
		return warnings;
	}
	if (request.type === 'transcriptions.getVerseIndexRowsForVerse') {
		return getVerseIndexRowsForVerse(
			getKyselyDb(),
			request.verseIdentifier,
			request.transcriptionIds
		);
	}
	if (request.type === 'transcriptions.listVerseIndexRows')
		return listVerseIndexRows(getKyselyDb());
	if (request.type === 'transcriptions.listVerseIndexRowsForTranscription') {
		return listVerseIndexRowsForTranscription(getKyselyDb(), request.transcriptionId);
	}
	if (request.type === 'transcriptions.listVerseIndexRowsForTranscriptions') {
		return listVerseIndexRowsForTranscriptions(getKyselyDb(), request.transcriptionIds);
	}
	if (request.type === 'transcriptions.rebuildVerseIndex') {
		const result = await rebuildVerseIndexForTranscriptionsWithFiles(
			getKyselyDb(),
			request.transcriptionIds,
			{ allowIndexFallback: false }
		);
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		return result;
	}
	if (request.type === 'projects.list') return listProjects(getKyselyDb());
	if (request.type === 'projects.ensureDefault') {
		const id = await ensureDefaultProject(getKyselyDb());
		postMessage({ type: 'db:invalidate', domain: 'projects' });
		return id;
	}
	if (request.type === 'projects.get') return getProject(getKyselyDb(), request.projectId);
	if (request.type === 'projects.create') {
		const id = await createProject(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'projects' });
		return id;
	}
	if (request.type === 'projects.fork') {
		const result = await forkProject(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'projects' });
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		postMessage({ type: 'db:invalidate', domain: 'collations' });
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return result;
	}
	if (request.type === 'projects.updateMetadata') {
		await updateProjectMetadata(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'projects' });
		return null;
	}
	if (request.type === 'projects.listTranscriptionOptions')
		return listProjectTranscriptionOptions(getKyselyDb(), request.projectId);
	if (request.type === 'projects.listTranscriptionStatuses')
		return listProjectTranscriptionStatuses(getKyselyDb(), request.projectId, {
			...request.options,
			requireFileBackedContent: true,
		});
	if (request.type === 'projects.listDocumentTitles')
		return listProjectDocumentTitles(getKyselyDb(), request.projectId);
	if (request.type === 'projects.getTranscriptionStatus')
		return getProjectTranscriptionStatus(getKyselyDb(), request.projectTranscriptionId, {
			...request.options,
			requireFileBackedContent: true,
		});
	if (request.type === 'projects.getTranscriptionStatusForOwnedTranscription')
		return getProjectTranscriptionStatusForOwnedTranscription(
			getKyselyDb(),
			request.projectOwnedTranscriptionId,
			{ ...request.options, requireFileBackedContent: true }
		);
	if (request.type === 'projects.loadTranscriptionContent')
		return loadTranscriptionContentWithFiles(getKyselyDb(), request.transcriptionId, {
			allowIndexFallback: false,
		});
	if (request.type === 'projects.getTranscriptionIds')
		return getProjectTranscriptionIds(getKyselyDb(), request.projectId);
	if (request.type === 'projects.syncTranscriptionIds') {
		const ids = await syncProjectTranscriptionIds(
			getKyselyDb(),
			request.projectId,
			request.nextIds
		);
		postMessage({ type: 'db:invalidate', domain: 'projects' });
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return ids;
	}
	if (request.type === 'projects.refreshTranscription') {
		const status = await refreshProjectTranscription(getKyselyDb(), request.input, {
			requireFileBackedContent: true,
		});
		postMessage({ type: 'db:invalidate', domain: 'projects' });
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return status;
	}
	if (request.type === 'projects.addTranscriptionFromProject') {
		const result = await addProjectTranscriptionFromProject(getKyselyDb(), request.input, {
			requireFileBackedContent: true,
		});
		postMessage({ type: 'db:invalidate', domain: 'projects' });
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return result;
	}
	if (request.type === 'projects.listTranscriptionSourceCandidates')
		return listProjectTranscriptionSourceCandidates(getKyselyDb(), request.targetProjectId, {
			requireFileBackedContent: true,
		});
	if (request.type === 'collations.listWithProjectNames')
		return listCollationsWithProjectNames(getKyselyDb());
	if (request.type === 'collations.create') {
		const result = await createCollationWithFilesResult(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'collations' });
		return result;
	}
	if (request.type === 'collations.load')
		return loadCollationWithWorkingFile(getKyselyDb(), request.collationId, {
			allowIndexFallback: false,
		});
	if (request.type === 'collations.listProjectVersionStatuses')
		return listProjectCollationVersionStatusesWithWorkingFiles(
			getKyselyDb(),
			request.projectId,
			request.options,
			{ allowIndexFallback: false }
		);
	if (request.type === 'collations.getVersionStatus')
		return getCollationVersionStatusWithWorkingFile(
			getKyselyDb(),
			request.collationId,
			request.options,
			{ allowIndexFallback: false }
		);
	if (request.type === 'collations.saveArtifact') {
		const artifactId = await saveWorkingCollationArtifact(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'collations' });
		return artifactId;
	}
	if (request.type === 'collations.saveProjection') {
		await saveCollationProjection(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'collations' });
		return null;
	}
	if (request.type === 'collations.updateMetadata') {
		await saveWorkingCollationMetadata(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'collations' });
		return null;
	}
	if (request.type === 'collations.delete') {
		const warnings = await deleteCollationWithFiles(getKyselyDb(), request.collationId);
		postMessage({ type: 'db:invalidate', domain: 'collations' });
		postMessage({ type: 'db:invalidate', domain: 'projects' });
		return warnings;
	}
	if (request.type === 'iiif.listManifestSources')
		return iiifRepository.listManifestSources(getKyselyDb(), request.transcriptionId);
	if (request.type === 'iiif.listManifestSourcesForUrl')
		return iiifRepository.listManifestSourcesForUrl(
			getKyselyDb(),
			request.transcriptionId,
			request.manifestUrl
		);
	if (request.type === 'iiif.ensureManifestSource') {
		const row = await iiifFiles.ensureManifestSourceWithFiles(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return row;
	}
	if (request.type === 'iiif.getManifestSource')
		return iiifRepository.getManifestSource(getKyselyDb(), request.input);
	if (request.type === 'iiif.listPageCanvasLinks')
		return iiifRepository.listPageCanvasLinks(getKyselyDb(), request.transcriptionId);
	if (request.type === 'iiif.upsertPageCanvasLink') {
		const row = await iiifFiles.upsertPageCanvasLinkWithFiles(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return row;
	}
	if (request.type === 'iiif.savePageCanvasLinks') {
		const rows = await iiifFiles.savePageCanvasLinksWithFiles(getKyselyDb(), request.inputs);
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return rows;
	}
	if (request.type === 'iiif.deletePageCanvasLink') {
		const count = await iiifFiles.deletePageCanvasLinkWithFiles(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return count;
	}
	if (request.type === 'iiif.deletePageCanvasLinksForPage') {
		const count = await iiifFiles.deletePageCanvasLinksForPageWithFiles(
			getKyselyDb(),
			request.input
		);
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return count;
	}
	if (request.type === 'iiif.deleteAllPageCanvasLinks') {
		const count = await iiifFiles.deleteAllPageCanvasLinksWithFiles(
			getKyselyDb(),
			request.transcriptionId
		);
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return count;
	}
	if (request.type === 'iiif.deleteManifestSource') {
		const deleted = await iiifFiles.deleteManifestSourceWithFiles(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return deleted;
	}
	if (request.type === 'iiif.deleteManifestSourceLinks') {
		const count = await iiifFiles.deleteManifestSourceLinksWithFiles(
			getKyselyDb(),
			request.input
		);
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return count;
	}
	if (request.type === 'iiif.findLinkedPageForCanvas')
		return iiifRepository.findLinkedPageForCanvas(getKyselyDb(), request.input);
	if (request.type === 'iiif.listCanvasAnnotations')
		return iiifRepository.listCanvasAnnotations(getKyselyDb(), request.input);
	if (request.type === 'iiif.getCanvasAnnotation')
		return iiifRepository.getCanvasAnnotation(getKyselyDb(), request.input);
	if (request.type === 'iiif.upsertCanvasAnnotation') {
		await iiifFiles.upsertCanvasAnnotationWithFiles(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return null;
	}
	if (request.type === 'iiif.deleteCanvasAnnotation') {
		await iiifFiles.deleteCanvasAnnotationWithFiles(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return null;
	}
	if (request.type === 'revisions.commitTranscription') {
		const checkpoint = await createCommittedTranscriptionCheckpointWithFiles(
			getKyselyDb(),
			request.input
		);
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		return checkpoint;
	}
	if (request.type === 'revisions.commitCollation') {
		const checkpoint = await createCommittedCollationCheckpointWithFiles(
			getKyselyDb(),
			request.input
		);
		postMessage({ type: 'db:invalidate', domain: 'collations' });
		return checkpoint;
	}
	if (request.type === 'revisions.isTranscriptionDirty')
		return (
			await getProjectTranscriptionCheckpointStatusWithFiles(
				getKyselyDb(),
				request.projectTranscriptionId,
				{ allowIndexFallback: false }
			)
		).dirtyToCheckpoint;
	if (request.type === 'revisions.isCollationDirty')
		return isCollationDirty(getKyselyDb(), request.collationId);
	if (request.type === 'revisions.listCommittedTranscriptionCheckpoints')
		return listCommittedTranscriptionCheckpoints(getKyselyDb(), request.transcriptionId);
	if (request.type === 'revisions.getLatestProjectCommitTimestamp')
		return getLatestProjectCommitTimestamp(getKyselyDb(), request.projectId);
	if (request.type === 'revisions.loadCommittedTranscriptionCheckpointPayload')
		return loadCommittedTranscriptionCheckpointPayload(
			getKyselyDb(),
			request.transcriptionId,
			request.checkpointId
		);
	if (request.type === 'transaction') {
		await db.transaction(request.statements);
		postMessage({
			type: 'db:invalidate',
			domain: inferInvalidationDomain(request.statements.map(s => s.sql).join('\n')),
		});
		return null;
	}
	if (request.type === 'checkpoint') {
		await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
		return null;
	}
	if (request.type === 'index.rebuild') {
		const report = await rebuildIndex();
		postMessage({ type: 'db:invalidate', domain: 'all' });
		return report;
	}
	if (request.type === 'index.restoreOrphanPrimary') {
		const report = await restoreOrphanPrimaryToProject(getKyselyDb(), request.path);
		postMessage({ type: 'db:invalidate', domain: 'all' });
		return report;
	}
	if (request.type === 'reset') {
		await kyselyDb?.destroy();
		kyselyDb = null;
		await db.close();
		initialized = false;
		await init();
		await clearDomainTables(getKyselyDb());
		await ensureDefaultProject(getKyselyDb());
		return null;
	}
	return null;
}

async function init(): Promise<void> {
	if (initialized) return;
	const startedAt = now();
	await timeWorkerStep('stale import cleanup', () => cleanStaleProjectImportStaging());
	const openResult = await timeWorkerStep('db.open', () => openIndexDatabaseForStartup());
	if (openResult.created) {
		await timeWorkerStep('schema create', () => createCurrentIndexSchema(db));
	}
	kyselyDb = timeWorkerStepSync('kysely init', () => createWorkerKysely(db));
	if (openResult.created) {
		const report = await rebuildIndex();
		console.info('[local-db] index rebuilt from document store', report);
		if (openResult.rebuildReason && openResult.rebuildReason !== 'missing') {
			postMessage({
				type: 'db:index-rebuilt',
				reason: openResult.rebuildReason,
				details: openResult.rebuildDetails,
				report,
			});
		}
		try {
			const cleanupReport = await timeWorkerStep('stale index cleanup', () =>
				cleanupStaleIndexFiles()
			);
			if (cleanupReport.removedPaths.length > 0) {
				console.info('[local-db] stale index files removed', cleanupReport);
			}
			if (cleanupReport.failedPaths.length > 0) {
				console.warn('[local-db] stale index file cleanup incomplete', cleanupReport);
			}
		} catch (error) {
			console.warn('[local-db] stale index file cleanup failed', error);
		}
	} else {
		await timeWorkerStep('default project bootstrap', () =>
			ensureDefaultProject(getKyselyDb())
		);
	}
	initialized = true;
	console.debug('[local-db] worker init completed', { elapsedMs: elapsed(startedAt) });
}

async function openIndexDatabaseForStartup(): Promise<IndexStartupOpenResult> {
	let openResult: OpenIndexDatabaseResult;
	try {
		openResult = await db.open();
	} catch (error) {
		const message = errorMessage(error);
		console.warn('[local-db] SQLite index open failed; rebuilding from files', {
			error: message,
		});
		await replaceCurrentIndexDatabase();
		return { created: true, rebuildReason: 'open-failed', rebuildDetails: [message] };
	}
	if (openResult.created) return { ...openResult, rebuildReason: 'missing', rebuildDetails: [] };

	const integrity = await checkIndexIntegrity();
	if (integrity.ok) return { ...openResult, rebuildReason: null, rebuildDetails: [] };

	console.warn('[local-db] SQLite index integrity check failed; rebuilding from files', {
		details: integrity.details,
	});
	await replaceCurrentIndexDatabase();
	return { created: true, rebuildReason: 'integrity-failed', rebuildDetails: integrity.details };
}

async function checkIndexIntegrity(): Promise<{ ok: true } | { ok: false; details: string[] }> {
	try {
		const rows = await db.query('PRAGMA integrity_check');
		const details = rows.flatMap(row => Object.values(row).map(value => String(value)));
		if (details.length === 1 && details[0].toLowerCase() === 'ok') return { ok: true };
		return {
			ok: false,
			details: details.length ? details : ['integrity_check returned no rows'],
		};
	} catch (error) {
		return { ok: false, details: [errorMessage(error)] };
	}
}

async function replaceCurrentIndexDatabase(): Promise<void> {
	await db.close().catch(error => {
		console.warn('[local-db] failed to close damaged index before replacement', error);
	});
	kyselyDb = null;
	const removalReport = await timeWorkerStep('current index removal', () =>
		removeCurrentIndexFiles()
	);
	if (removalReport.failedPaths.length > 0) {
		throw new Error(
			`Unable to remove damaged index files: ${removalReport.failedPaths
				.map(failure => `${failure.path}: ${failure.error}`)
				.join('; ')}`
		);
	}
	await db.open();
}

async function rebuildIndex() {
	const report = await timeWorkerStep('index rebuild', () =>
		rebuildIndexFromStore(getKyselyDb())
	);
	await timeWorkerStep('default project bootstrap', () => ensureDefaultProject(getKyselyDb()));
	return report;
}

function getKyselyDb(): Kysely<Database> {
	if (!kyselyDb) kyselyDb = createWorkerKysely(db);
	return kyselyDb;
}

function inferInvalidationDomain(sql: string): string {
	if (/transcriptions|transcription_verse_index/i.test(sql)) return 'transcriptions';
	if (/projects|project_transcriptions/i.test(sql)) return 'projects';
	if (/collations|collation_/i.test(sql)) return 'collations';
	if (/iiif_|page_canvas/i.test(sql)) return 'iiif';
	return 'all';
}

function postResponse(response: DbResponse): void {
	postMessage(response);
}

function logWorkerTiming(request: DbRequest, queueWaitMs: number, handlerMs: number): void {
	if (request.type !== 'init' && request.type !== 'transcriptions.listSummaries') return;
	console.debug('[local-db] worker request completed', {
		type: request.type,
		id: request.id,
		queueWaitMs,
		handlerMs,
	});
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function timeWorkerStep<T>(label: string, step: () => Promise<T>): Promise<T> {
	const startedAt = now();
	try {
		const result = await step();
		console.debug(`[local-db] worker ${label} completed`, { elapsedMs: elapsed(startedAt) });
		return result;
	} catch (error) {
		console.error(`[local-db] worker ${label} failed`, {
			elapsedMs: elapsed(startedAt),
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

function timeWorkerStepSync<T>(label: string, step: () => T): T {
	const startedAt = now();
	try {
		const result = step();
		console.debug(`[local-db] worker ${label} completed`, { elapsedMs: elapsed(startedAt) });
		return result;
	} catch (error) {
		console.error(`[local-db] worker ${label} failed`, {
			elapsedMs: elapsed(startedAt),
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

async function createProviderForBackupContext(
	db: Kysely<Database>,
	connectionOrTargetId: string
): Promise<CloudStorageProvider> {
	const connection = await getCloudConnection(db, connectionOrTargetId);
	return connection
		? createProviderForConnection(connection)
		: createProviderForSyncTarget(connectionOrTargetId);
}

function providerRootFolderId(provider: CloudStorageProvider): string {
	if ('rootFolderId' in provider && typeof provider.rootFolderId === 'string') {
		return provider.rootFolderId;
	}
	if ('rootPath' in provider && typeof provider.rootPath === 'string') {
		return provider.rootPath;
	}
	return '';
}

function now(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function elapsed(startedAt: number): number {
	return Math.round(now() - startedAt);
}
