import type {
	DbInvalidationEvent,
	DbRequestPayload,
	DbResponse,
	DbRow,
	DbValue,
	CollationRpcRequest,
	CollationRpcResponse,
	ProjectRpcRequest,
	ProjectRpcResponse,
	TranscriptionRpcRequest,
	TranscriptionRpcResponse,
	IiifRpcRequest,
	IiifRpcResponse,
	RevisionRpcRequest,
	RevisionRpcResponse,
	CloudConnectionRpcRequest,
	CloudConnectionRpcResponse,
} from './rpc';
import type { RemoveLocalProjectInput, RemoveLocalProjectResult } from './repositories/project-removal';
import type { W3CAnnotation } from 'triiiceratops/plugins/annotation-editor';
import type {
	CloudConnectionRecord,
	CloudProjectFolderRecord,
	UpsertCloudProjectFolderInput,
	UpsertCloudConnectionInput,
} from './repositories/cloud-connections';
import type { ProjectBackupHealth } from '../sync/backup-health';
import type {
	ProjectManifestComparison,
	ProjectBackupResult,
	ProjectBackupSummary,
	SyncEntityReference,
	SyncProjectContext,
} from '../sync/sync-manager';
import type {
	CloudProjectCandidate,
	ImportCloudProjectInput,
	ImportCloudProjectResult,
	LinkedProjectManifestContext,
	PollLinkedProjectManifestResult,
	PullLinkedProjectUpdatesResult,
} from '../sync/project-restore';
import type {
	CollationListItem,
	CollationVersionStatusOptions,
	CollationVersionStatus,
	CreateCollationInput,
	LoadedCollation,
	SaveCollationArtifactInput,
	SaveCollationProjectionInput,
	UpdateCollationMetadataInput,
} from './repositories/collations';
import { ensureLocalDbRuntime, getLocalDbWorker } from './runtime';
import type {
	CreateTranscriptionInput,
	TranscriptionRecord,
	TranscriptionSummary,
	TranscriptionVersion,
	UpdateTranscriptionContentInput,
	VerseIndexRebuildResult,
	VerseIndexRow,
} from './repositories/transcriptions';
import type {
	CreateProjectInput,
	ProjectOption,
	ProjectRecord,
	ProjectTranscriptionOption,
	ProjectTranscriptionStatusOptions,
	ProjectTranscriptionStatus,
	ProjectTranscriptionSourceCandidate,
	PromoteProjectTranscriptionToLibraryInput,
	AddProjectTranscriptionFromProjectInput,
	ForkProjectInput,
	ForkProjectResult,
	RefreshProjectTranscriptionInput,
	UpdateProjectMetadataInput,
} from './repositories/projects';
import type { EnsureManifestSourceInput } from './repositories/iiif';
import type {
	CollationCheckpoint,
	CommitCollationInput,
	CommitTranscriptionInput,
	LoadedTranscriptionCheckpoint,
	TranscriptionCheckpoint,
	TranscriptionCheckpointSummary,
} from './repositories/revisions';
import type {
	AnnotationAnchor,
	ManifestSourceSummary,
	PageCanvasLink,
	SavePageCanvasLinkInput,
} from '../iiif/types';

const DB_REQUEST_TIMEOUT_MS = 60_000;

let nextRequestId = 1;
const pending = new Map<
	number,
	{
		resolve: (value: unknown) => void;
		reject: (error: Error) => void;
		timeoutId?: ReturnType<typeof setTimeout>;
	}
>();
const invalidationListeners = new Set<(event: DbInvalidationEvent) => void>();

export async function localDbQuery(sql: string, params: DbValue[] = []): Promise<DbRow[]> {
	await ensureLocalDbRuntime();
	return send<DbRow[]>({ type: 'query', sql, params });
}

export async function localDbExecute(
	sql: string,
	params: DbValue[] = []
): Promise<{ changes: number }> {
	await ensureLocalDbRuntime();
	return send<{ changes: number }>({ type: 'execute', sql, params });
}

export async function localDbTransaction(
	statements: Array<{ sql: string; params?: DbValue[] }>
): Promise<void> {
	await ensureLocalDbRuntime();
	await send<void>({ type: 'transaction', statements });
}

export function subscribeLocalDbInvalidations(
	listener: (event: DbInvalidationEvent) => void
): () => void {
	invalidationListeners.add(listener);
	return () => invalidationListeners.delete(listener);
}

export async function listTranscriptionSummaries(): Promise<TranscriptionSummary[]> {
	const startedAt = now();
	const rows = await sendTranscriptionRequest({ type: 'transcriptions.listSummaries' });
	console.debug('[local-db] transcriptions.listSummaries client completed', {
		rowCount: rows.length,
		elapsedMs: elapsed(startedAt),
	});
	return rows;
}

export async function getTranscriptionSummary(id: string): Promise<TranscriptionSummary | null> {
	return sendTranscriptionRequest({ type: 'transcriptions.getSummary', transcriptionId: id });
}

export async function getTranscriptionVersionsByIds(
	ids: string[]
): Promise<TranscriptionVersion[]> {
	return sendTranscriptionRequest({ type: 'transcriptions.getVersionsByIds', ids });
}

export async function getTranscription(id: string): Promise<TranscriptionRecord | null> {
	return sendTranscriptionRequest({ type: 'transcriptions.get', transcriptionId: id });
}

export async function getTranscriptionsByIds(ids: string[]): Promise<TranscriptionRecord[]> {
	return sendTranscriptionRequest({ type: 'transcriptions.getByIds', ids });
}

export async function createTranscription(input: CreateTranscriptionInput): Promise<string> {
	return sendTranscriptionRequest({ type: 'transcriptions.create', input });
}

export async function createTranscriptions(inputs: CreateTranscriptionInput[]): Promise<string[]> {
	return sendTranscriptionRequest({ type: 'transcriptions.createMany', inputs });
}

export async function updateTranscriptionContent(
	input: UpdateTranscriptionContentInput
): Promise<void> {
	if (input.contentJson !== undefined) {
		await sendTranscriptionRequest({
			type: 'transcriptions.updateContent',
			input: {
				id: input.id,
				contentJson: input.contentJson,
				format: input.format,
				updatedAt: input.updatedAt,
			},
		});
		return;
	}
	await sendTranscriptionRequest({ type: 'transcriptions.updateContent', input });
}

export async function deleteTranscription(id: string): Promise<void> {
	await sendTranscriptionRequest({ type: 'transcriptions.delete', transcriptionId: id });
}

export async function getVerseIndexRowsForVerse(
	verseIdentifier: string,
	transcriptionIds?: string[]
): Promise<VerseIndexRow[]> {
	return sendTranscriptionRequest({
		type: 'transcriptions.getVerseIndexRowsForVerse',
		verseIdentifier,
		transcriptionIds,
	});
}

export async function listVerseIndexRows(): Promise<VerseIndexRow[]> {
	return sendTranscriptionRequest({ type: 'transcriptions.listVerseIndexRows' });
}

export async function listVerseIndexRowsForTranscription(
	transcriptionId: string
): Promise<VerseIndexRow[]> {
	return sendTranscriptionRequest({
		type: 'transcriptions.listVerseIndexRowsForTranscription',
		transcriptionId,
	});
}

export async function rebuildVerseIndexForTranscriptions(
	transcriptionIds: string[]
): Promise<VerseIndexRebuildResult> {
	return sendTranscriptionRequest({ type: 'transcriptions.rebuildVerseIndex', transcriptionIds });
}

export async function listProjects(): Promise<ProjectOption[]> {
	return sendProjectRequest({ type: 'projects.list' });
}

export async function ensureDefaultProject(): Promise<string> {
	return sendProjectRequest({ type: 'projects.ensureDefault' });
}

export async function getProject(projectId: string): Promise<ProjectRecord | null> {
	return sendProjectRequest({ type: 'projects.get', projectId });
}

export async function createProject(input: CreateProjectInput): Promise<string> {
	return sendProjectRequest({ type: 'projects.create', input });
}

export async function forkProject(input: ForkProjectInput): Promise<ForkProjectResult> {
	return sendProjectRequest({ type: 'projects.fork', input });
}

export async function updateProjectMetadata(input: UpdateProjectMetadataInput): Promise<void> {
	await sendProjectRequest({ type: 'projects.updateMetadata', input });
}

export async function listProjectTranscriptionOptions(
	projectId?: string
): Promise<ProjectTranscriptionOption[]> {
	return sendProjectRequest({ type: 'projects.listTranscriptionOptions', projectId });
}

export async function listProjectTranscriptionStatuses(
	projectId: string,
	options?: ProjectTranscriptionStatusOptions
): Promise<ProjectTranscriptionStatus[]> {
	return sendProjectRequest({ type: 'projects.listTranscriptionStatuses', projectId, options });
}

export async function getProjectTranscriptionStatus(
	projectTranscriptionId: string,
	options?: ProjectTranscriptionStatusOptions
): Promise<ProjectTranscriptionStatus> {
	return sendProjectRequest({
		type: 'projects.getTranscriptionStatus',
		projectTranscriptionId,
		options,
	});
}

export async function getProjectTranscriptionStatusForOwnedTranscription(
	projectOwnedTranscriptionId: string,
	options?: ProjectTranscriptionStatusOptions
): Promise<ProjectTranscriptionStatus | null> {
	return sendProjectRequest({
		type: 'projects.getTranscriptionStatusForOwnedTranscription',
		projectOwnedTranscriptionId,
		options,
	});
}

export async function loadProjectTranscriptionContent(
	transcriptionId: string
): Promise<string | null> {
	return sendProjectRequest({ type: 'projects.loadTranscriptionContent', transcriptionId });
}

export async function getProjectTranscriptionIds(projectId: string): Promise<string[]> {
	return sendProjectRequest({ type: 'projects.getTranscriptionIds', projectId });
}

export async function syncProjectTranscriptionIds(
	projectId: string,
	nextIds: string[]
): Promise<string[]> {
	return sendProjectRequest({ type: 'projects.syncTranscriptionIds', projectId, nextIds });
}

export async function refreshProjectTranscription(
	input: RefreshProjectTranscriptionInput
): Promise<ProjectTranscriptionStatus> {
	return sendProjectRequest({ type: 'projects.refreshTranscription', input });
}

export async function promoteProjectTranscriptionToLibrary(
	input: PromoteProjectTranscriptionToLibraryInput
): Promise<string> {
	return sendProjectRequest({ type: 'projects.promoteTranscriptionToLibrary', input });
}

export async function addProjectTranscriptionFromProject(
	input: AddProjectTranscriptionFromProjectInput
): Promise<{ projectTranscriptionId: string; projectOwnedTranscriptionId: string }> {
	return sendProjectRequest({ type: 'projects.addTranscriptionFromProject', input });
}

export async function listProjectTranscriptionSourceCandidates(
	targetProjectId: string
): Promise<ProjectTranscriptionSourceCandidate[]> {
	return sendProjectRequest({
		type: 'projects.listTranscriptionSourceCandidates',
		targetProjectId,
	});
}

export async function listCollationsWithProjectNames(): Promise<CollationListItem[]> {
	return sendCollationRequest({ type: 'collations.listWithProjectNames' });
}

export async function createCollation(input: CreateCollationInput): Promise<string> {
	return sendCollationRequest({ type: 'collations.create', input });
}

export async function loadCollation(id: string): Promise<LoadedCollation | null> {
	return sendCollationRequest({ type: 'collations.load', collationId: id });
}

export async function listProjectCollationVersionStatuses(
	projectId: string,
	options?: CollationVersionStatusOptions
): Promise<CollationVersionStatus[]> {
	return sendCollationRequest({
		type: 'collations.listProjectVersionStatuses',
		projectId,
		options,
	});
}

export async function getCollationVersionStatus(
	collationId: string,
	options?: CollationVersionStatusOptions
): Promise<CollationVersionStatus> {
	return sendCollationRequest({ type: 'collations.getVersionStatus', collationId, options });
}

export async function saveCollationArtifact(input: SaveCollationArtifactInput): Promise<string> {
	return sendCollationRequest({ type: 'collations.saveArtifact', input });
}

export async function saveCollationProjection(input: SaveCollationProjectionInput): Promise<void> {
	await sendCollationRequest({ type: 'collations.saveProjection', input });
}

export async function updateCollationMetadata(input: UpdateCollationMetadataInput): Promise<void> {
	await sendCollationRequest({ type: 'collations.updateMetadata', input });
}

export async function deleteCollation(id: string): Promise<void> {
	await sendCollationRequest({ type: 'collations.delete', collationId: id });
}

export async function listManifestSources(
	transcriptionId: string
): Promise<ManifestSourceSummary[]> {
	return sendIiifRequest({ type: 'iiif.listManifestSources', transcriptionId });
}

export async function listManifestSourcesForUrl(
	transcriptionId: string,
	manifestUrl: string
): Promise<ManifestSourceSummary[]> {
	return sendIiifRequest({
		type: 'iiif.listManifestSourcesForUrl',
		transcriptionId,
		manifestUrl,
	});
}

export async function ensureManifestSource(
	input: EnsureManifestSourceInput
): Promise<ManifestSourceSummary> {
	return sendIiifRequest({ type: 'iiif.ensureManifestSource', input });
}

export async function getManifestSource(
	transcriptionId: string,
	manifestSourceId: string
): Promise<ManifestSourceSummary | null> {
	return sendIiifRequest({
		type: 'iiif.getManifestSource',
		input: { transcriptionId, manifestSourceId },
	});
}

export async function listPageCanvasLinks(transcriptionId: string): Promise<PageCanvasLink[]> {
	return sendIiifRequest({ type: 'iiif.listPageCanvasLinks', transcriptionId });
}

export async function upsertPageCanvasLink(
	input: SavePageCanvasLinkInput
): Promise<PageCanvasLink> {
	return sendIiifRequest({ type: 'iiif.upsertPageCanvasLink', input });
}

export async function savePageCanvasLinks(
	inputs: SavePageCanvasLinkInput[]
): Promise<PageCanvasLink[]> {
	return sendIiifRequest({ type: 'iiif.savePageCanvasLinks', inputs });
}

export async function deletePageCanvasLink(input: {
	transcriptionId: string;
	pageId: string;
	manifestSourceId: string;
	canvasId: string;
}): Promise<number> {
	return sendIiifRequest({ type: 'iiif.deletePageCanvasLink', input });
}

export async function deletePageCanvasLinksForPage(input: {
	transcriptionId: string;
	pageId: string;
}): Promise<number> {
	return sendIiifRequest({ type: 'iiif.deletePageCanvasLinksForPage', input });
}

export async function deleteAllPageCanvasLinks(transcriptionId: string): Promise<number> {
	return sendIiifRequest({ type: 'iiif.deleteAllPageCanvasLinks', transcriptionId });
}

export async function deleteManifestSource(input: {
	transcriptionId: string;
	manifestSourceId: string;
}): Promise<boolean> {
	return sendIiifRequest({ type: 'iiif.deleteManifestSource', input });
}

export async function deleteManifestSourceLinks(input: {
	transcriptionId: string;
	manifestSourceId: string;
}): Promise<number> {
	return sendIiifRequest({ type: 'iiif.deleteManifestSourceLinks', input });
}

export async function findLinkedPageForCanvas(input: {
	transcriptionId: string;
	manifestSourceId: string;
	canvasId: string;
}): Promise<PageCanvasLink | null> {
	return sendIiifRequest({ type: 'iiif.findLinkedPageForCanvas', input });
}

export async function listCanvasAnnotations(input: {
	transcriptionId: string;
	manifestSourceIds: string[];
	canvasId: string;
	mode?: 'headers' | 'full';
	previewLength?: number;
}): Promise<W3CAnnotation[]> {
	return sendIiifRequest({ type: 'iiif.listCanvasAnnotations', input });
}

export async function getCanvasAnnotation(input: {
	transcriptionId: string;
	manifestSourceId: string;
	annotationId: string;
}): Promise<W3CAnnotation | null> {
	return sendIiifRequest({ type: 'iiif.getCanvasAnnotation', input });
}

export async function upsertCanvasAnnotation(input: {
	transcriptionId: string;
	pageId: string;
	manifestSourceId: string;
	canvasId: string;
	annotation: W3CAnnotation;
	anchor: AnnotationAnchor;
	createdBy?: string;
}): Promise<void> {
	await sendIiifRequest({ type: 'iiif.upsertCanvasAnnotation', input });
}

export async function deleteCanvasAnnotation(input: {
	transcriptionId: string;
	manifestSourceId: string;
	annotationId: string;
}): Promise<void> {
	await sendIiifRequest({ type: 'iiif.deleteCanvasAnnotation', input });
}

export async function createCommittedTranscriptionCheckpoint(
	input: CommitTranscriptionInput
): Promise<TranscriptionCheckpoint> {
	return sendRevisionRequest({ type: 'revisions.commitTranscription', input });
}

export async function createCommittedCollationCheckpoint(
	input: CommitCollationInput
): Promise<CollationCheckpoint> {
	return sendRevisionRequest({ type: 'revisions.commitCollation', input });
}

export async function isTranscriptionDirty(projectTranscriptionId: string): Promise<boolean> {
	return sendRevisionRequest({ type: 'revisions.isTranscriptionDirty', projectTranscriptionId });
}

export async function isCollationDirty(collationId: string): Promise<boolean> {
	return sendRevisionRequest({ type: 'revisions.isCollationDirty', collationId });
}

export async function listCommittedTranscriptionCheckpoints(
	transcriptionId: string
): Promise<TranscriptionCheckpointSummary[]> {
	return sendRevisionRequest({
		type: 'revisions.listCommittedTranscriptionCheckpoints',
		transcriptionId,
	});
}

export async function loadCommittedTranscriptionCheckpointPayload(
	transcriptionId: string,
	checkpointId: string
): Promise<LoadedTranscriptionCheckpoint> {
	return sendRevisionRequest({
		type: 'revisions.loadCommittedTranscriptionCheckpointPayload',
		transcriptionId,
		checkpointId,
	});
}

export async function listCloudConnections(): Promise<CloudConnectionRecord[]> {
	return sendCloudConnectionRequest({ type: 'cloudConnections.list' });
}

export async function upsertCloudConnection(
	input: UpsertCloudConnectionInput
): Promise<CloudConnectionRecord> {
	return sendCloudConnectionRequest({ type: 'cloudConnections.upsert', input });
}

export async function disconnectCloudConnection(connectionId: string): Promise<boolean> {
	return sendCloudConnectionRequest({ type: 'cloudConnections.disconnect', connectionId });
}

export async function listCloudProjectFolders(
	projectId: string
): Promise<CloudProjectFolderRecord[]> {
	return sendCloudConnectionRequest({ type: 'cloudProjectFolders.list', projectId });
}

export async function upsertCloudProjectFolder(
	input: UpsertCloudProjectFolderInput
): Promise<CloudProjectFolderRecord> {
	return sendCloudConnectionRequest({ type: 'cloudProjectFolders.upsert', input });
}

export async function deriveProjectBackupSummary(
	context: SyncProjectContext,
	folder?: CloudProjectFolderRecord | null
): Promise<ProjectBackupSummary> {
	return sendCloudConnectionRequest({ type: 'projectBackup.summary', context, folder });
}

export async function compareProjectBackupManifest(
	context: SyncProjectContext
): Promise<ProjectManifestComparison> {
	return sendCloudConnectionRequest({ type: 'projectBackup.compareManifest', context });
}

export async function verifyProjectBackupHealth(
	context: SyncProjectContext
): Promise<ProjectBackupHealth> {
	return sendCloudConnectionRequest({ type: 'projectBackup.verifyHealth', context });
}

export async function removeLocalProject(
	input: RemoveLocalProjectInput
): Promise<RemoveLocalProjectResult> {
	return sendCloudConnectionRequest({ type: 'projectBackup.removeLocalProject', input });
}

export async function backupProject(
	context: SyncProjectContext,
	folder?: CloudProjectFolderRecord | null
): Promise<ProjectBackupResult> {
	return sendCloudConnectionRequest({
		type: 'projectBackup.backup',
		context,
		folder,
		strict: true,
	});
}

export async function backupEligibleProjectEntities(
	context: SyncProjectContext,
	folder?: CloudProjectFolderRecord | null
): Promise<ProjectBackupResult> {
	return sendCloudConnectionRequest({
		type: 'projectBackup.backup',
		context,
		folder,
		strict: false,
	});
}

export async function backupProjectEntity(
	context: SyncProjectContext,
	reference: SyncEntityReference,
	folder?: CloudProjectFolderRecord | null
): Promise<ProjectBackupResult> {
	return sendCloudConnectionRequest({
		type: 'projectBackup.backupEntity',
		context,
		reference,
		folder,
	});
}

export async function listCloudProjectCandidates(
	connectionId: string,
	rootFolderId?: string
): Promise<CloudProjectCandidate[]> {
	return sendCloudConnectionRequest({
		type: 'cloudProjects.listCandidates',
		connectionId,
		rootFolderId,
	});
}

export async function importCloudProject(
	input: ImportCloudProjectInput
): Promise<ImportCloudProjectResult> {
	return sendCloudConnectionRequest({ type: 'cloudProjects.import', input });
}

export async function pollLinkedProjectManifest(
	context: LinkedProjectManifestContext
): Promise<PollLinkedProjectManifestResult> {
	return sendCloudConnectionRequest({ type: 'cloudProjects.pollLinkedManifest', context });
}

export async function pullLinkedProjectUpdates(
	context: LinkedProjectManifestContext
): Promise<PullLinkedProjectUpdatesResult> {
	return sendCloudConnectionRequest({ type: 'cloudProjects.pullLinkedUpdates', context });
}

export function attachLocalDbClient(worker: Worker): void {
	worker.addEventListener('message', (event: MessageEvent<DbResponse | DbInvalidationEvent>) => {
		const message = event.data;
		if ('type' in message && message.type === 'db:invalidate') {
			for (const listener of invalidationListeners) listener(message);
			return;
		}
		if (!('id' in message)) return;
		const pendingRequest = pending.get(message.id);
		if (!pendingRequest) return;
		pending.delete(message.id);
		if (pendingRequest.timeoutId) clearTimeout(pendingRequest.timeoutId);
		if (message.ok) pendingRequest.resolve('result' in message ? message.result : undefined);
		else pendingRequest.reject(new Error(message.error));
	});
}

async function send<T>(payload: DbRequestPayload): Promise<T> {
	await ensureLocalDbRuntime();
	const worker = getLocalDbWorker();
	const id = nextRequestId++;
	const startedAt = now();
	return new Promise<T>((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			pending.delete(id);
			console.error('[local-db] worker request timed out', {
				type: payload.type,
				id,
				elapsedMs: elapsed(startedAt),
			});
			reject(new Error('Timed out waiting for a response from the local database worker.'));
		}, DB_REQUEST_TIMEOUT_MS);
		pending.set(id, {
			resolve: value => {
				if (payload.type === 'transcriptions.listSummaries') {
					console.debug('[local-db] worker request round trip completed', {
						type: payload.type,
						id,
						elapsedMs: elapsed(startedAt),
					});
				}
				resolve(value as T);
			},
			reject: error => {
				console.error('[local-db] worker request failed', {
					type: payload.type,
					id,
					elapsedMs: elapsed(startedAt),
					error: error.message,
				});
				reject(error);
			},
			timeoutId,
		});
		worker.postMessage({ ...payload, id });
	});
}

function now(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function elapsed(startedAt: number): number {
	return Math.round(now() - startedAt);
}

async function sendTranscriptionRequest<T extends TranscriptionRpcRequest>(
	payload: T
): Promise<TranscriptionRpcResponse<T['type']>> {
	return send<TranscriptionRpcResponse<T['type']>>(payload);
}

async function sendProjectRequest<T extends ProjectRpcRequest>(
	payload: T
): Promise<ProjectRpcResponse<T['type']>> {
	return send<ProjectRpcResponse<T['type']>>(payload);
}

async function sendCollationRequest<T extends CollationRpcRequest>(
	payload: T
): Promise<CollationRpcResponse<T['type']>> {
	return send<CollationRpcResponse<T['type']>>(payload);
}

async function sendIiifRequest<T extends IiifRpcRequest>(
	payload: T
): Promise<IiifRpcResponse<T['type']>> {
	return send<IiifRpcResponse<T['type']>>(payload);
}

async function sendRevisionRequest<T extends RevisionRpcRequest>(
	payload: T
): Promise<RevisionRpcResponse<T['type']>> {
	return send<RevisionRpcResponse<T['type']>>(payload);
}

async function sendCloudConnectionRequest<T extends CloudConnectionRpcRequest>(
	payload: T
): Promise<CloudConnectionRpcResponse<T['type']>> {
	return send<CloudConnectionRpcResponse<T['type']>>(payload);
}
