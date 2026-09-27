import { notificationCenter } from '$lib/shell/notification-center.svelte';
import type { SyncProjectContext } from '$lib/backup/backup-status';
import type { DbApi, DbApiContext } from './api';
import type { PersistenceWarning } from './repositories/revisions';
import type { UpdateTranscriptionContentInput } from './repositories/transcriptions';
import type {
	DbIndexRebuiltEvent,
	DbInvalidationEvent,
	DbMethod,
	DbRequestPayload,
	DbWorkerMessage,
} from './rpc';
import { ensureLocalDbRuntime, getLocalDbWorker } from './runtime';

type DbArgs<K extends DbMethod> = DbApi[K] extends (
	context: DbApiContext,
	...args: infer A
) => unknown
	? A
	: never;
type DbResult<K extends DbMethod> = Awaited<ReturnType<DbApi[K]>>;

function call<K extends DbMethod>(method: K) {
	return (...args: DbArgs<K>) => send<DbResult<K>>({ method, args });
}

const DB_REQUEST_TIMEOUT_MS = 60_000;

let nextRequestId = 1;
const pending = new Map<
	number,
	{
		resolve: (value: unknown) => void;
		reject: (error: Error) => void;
		timeoutId: ReturnType<typeof setTimeout>;
	}
>();
const invalidationListeners = new Set<(event: DbInvalidationEvent) => void>();

export function subscribeLocalDbInvalidations(
	listener: (event: DbInvalidationEvent) => void
): () => void {
	invalidationListeners.add(listener);
	return () => invalidationListeners.delete(listener);
}

export function emitLocalDbInvalidation(domain: string): void {
	const event: DbInvalidationEvent = { type: 'db:invalidate', domain };
	for (const listener of invalidationListeners) listener(event);
}

export const listTranscriptionSummaries = call('listTranscriptionSummaries');
export const getTranscriptionSummary = call('getTranscriptionSummary');
export const getTranscription = call('getTranscription');
export const getTranscriptionsByIds = call('getTranscriptionsByIds');
export const createTranscription = call('createTranscription');
export const createTranscriptions = call('createTranscriptions');
export const updateTranscriptionMetadata = call('updateTranscriptionMetadata');
export const deleteTranscription = call('deleteTranscription');
export const getVerseIndexRowsForVerse = call('getVerseIndexRowsForVerse');
export const listVerseIndexRows = call('listVerseIndexRows');
export const listVerseIndexRowsForTranscription = call('listVerseIndexRowsForTranscription');
export const listVerseIndexRowsForTranscriptions = call('listVerseIndexRowsForTranscriptions');
export const rebuildVerseIndexForTranscriptions = call('rebuildVerseIndexForTranscriptions');

export async function updateTranscriptionContent(input: UpdateTranscriptionContentInput) {
	const { id, contentJson, format, updatedAt } = input;
	await send({
		method: 'updateTranscriptionContent',
		args: [contentJson === undefined ? input : { id, contentJson, format, updatedAt }],
	});
}

export const listProjects = call('listProjects');
export const ensureDefaultProject = call('ensureDefaultProject');
export const getProject = call('getProject');
export const createProject = call('createProject');
export const forkProject = call('forkProject');
export const updateProjectMetadata = call('updateProjectMetadata');
export const listProjectTranscriptionOptions = call('listProjectTranscriptionOptions');
export const listProjectTranscriptionStatuses = call('listProjectTranscriptionStatuses');
export const listProjectDocumentTitles = call('listProjectDocumentTitles');
export const getProjectTranscriptionStatusForOwnedTranscription = call(
	'getProjectTranscriptionStatusForOwnedTranscription'
);
export const loadProjectTranscriptionContent = call('loadProjectTranscriptionContent');
export const getProjectTranscriptionIds = call('getProjectTranscriptionIds');
export const syncProjectTranscriptionIds = call('syncProjectTranscriptionIds');
export const refreshProjectTranscription = call('refreshProjectTranscription');
export const addProjectTranscriptionFromProject = call('addProjectTranscriptionFromProject');
export const listProjectTranscriptionSourceCandidates = call(
	'listProjectTranscriptionSourceCandidates'
);

export const listCollationsWithProjectNames = call('listCollationsWithProjectNames');
export const createCollation = call('createCollation');
export const loadCollation = call('loadCollation');
export const listProjectCollationVersionStatuses = call('listProjectCollationVersionStatuses');
export const getCollationVersionStatus = call('getCollationVersionStatus');
export const saveCollationArtifact = call('saveCollationArtifact');
export const updateCollationMetadata = call('updateCollationMetadata');
export const deleteCollation = call('deleteCollation');

export const listManifestSources = call('listManifestSources');
export const ensureManifestSource = call('ensureManifestSource');
export const getManifestSource = call('getManifestSource');
export const listPageCanvasLinks = call('listPageCanvasLinks');
export const upsertPageCanvasLink = call('upsertPageCanvasLink');
export const savePageCanvasLinks = call('savePageCanvasLinks');
export const deletePageCanvasLink = call('deletePageCanvasLink');
export const deletePageCanvasLinksForPage = call('deletePageCanvasLinksForPage');
export const deleteAllPageCanvasLinks = call('deleteAllPageCanvasLinks');
export const deleteManifestSource = call('deleteManifestSource');
export const findLinkedPageForCanvas = call('findLinkedPageForCanvas');
export const listCanvasAnnotations = call('listCanvasAnnotations');
export const getCanvasAnnotation = call('getCanvasAnnotation');
export const upsertCanvasAnnotation = call('upsertCanvasAnnotation');
export const deleteCanvasAnnotation = call('deleteCanvasAnnotation');

export const createCommittedTranscriptionCheckpoint = call(
	'createCommittedTranscriptionCheckpoint'
);
export const createCommittedCollationCheckpoint = call('createCommittedCollationCheckpoint');
export const listCommittedTranscriptionCheckpoints = call('listCommittedTranscriptionCheckpoints');
export const getLatestProjectCommitTimestamp = call('getLatestProjectCommitTimestamp');
export const loadCommittedTranscriptionCheckpointPayload = call(
	'loadCommittedTranscriptionCheckpointPayload'
);

// `$state` proxies cannot cross `postMessage`; spreading the context detaches it.
export function deriveProjectBackupSummary(context: SyncProjectContext) {
	return call('deriveProjectBackupSummary')({ ...context });
}

export function backupProject(context: SyncProjectContext) {
	return call('backupProject')({ ...context }, true);
}

export function backupEligibleProjectEntities(context: SyncProjectContext) {
	return call('backupProject')({ ...context }, false);
}

export const exportProjectZip = call('exportProjectZip');
export const exportAllProjectsZip = call('exportAllProjectsZip');
export const importProjectZip = call('importProjectZip');
export const restoreReferenceEditionsArchive = call('restoreReferenceEditionsArchive');
export const rebuildLocalIndex = call('rebuildLocalIndex');
export const restoreOrphanPrimary = call('restoreOrphanPrimary');

function reportPersistenceWarnings(warnings: PersistenceWarning[]): void {
	for (const warning of warnings) {
		notificationCenter.upsert({
			id: `persistence-warning:${warning.code}:${warning.entityType}:${warning.entityId}`,
			title: 'Local file needs attention',
			message: warning.message,
			tone: 'warning',
			persistent: true,
		});
	}
}

export function attachLocalDbClient(worker: Worker): void {
	worker.addEventListener('message', (event: MessageEvent<DbWorkerMessage>) => {
		const message = event.data;
		if ('type' in message) {
			if (message.type === 'db:invalidate') emitLocalDbInvalidation(message.domain);
			else if (message.type === 'db:warnings') reportPersistenceWarnings(message.warnings);
			else reportAutomaticIndexRebuild(message);
			return;
		}
		const pendingRequest = pending.get(message.id);
		if (!pendingRequest) return;
		pending.delete(message.id);
		clearTimeout(pendingRequest.timeoutId);
		if (message.ok) pendingRequest.resolve(message.result);
		else pendingRequest.reject(new Error(message.error));
	});
}

function reportAutomaticIndexRebuild(message: DbIndexRebuiltEvent): void {
	const issue =
		message.reason === 'integrity-failed' ? 'failed an integrity check' : 'failed to open';
	notificationCenter.upsert({
		id: 'local-db-index-rebuilt',
		title: 'Local database repaired',
		message: `The local SQLite index ${issue}, so it was rebuilt from your project files. Restored ${message.report.projectsRestored} project(s), ${message.report.transcriptionsRestored} transcription(s), and ${message.report.collationsRestored} collation(s).`,
		tone: 'warning',
		persistent: true,
	});
}

async function send<T>(payload: DbRequestPayload): Promise<T> {
	await ensureLocalDbRuntime();
	const worker = getLocalDbWorker();
	const id = nextRequestId++;
	const label = 'method' in payload ? payload.method : payload.type;
	return new Promise<T>((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			pending.delete(id);
			reject(new Error(`Timed out waiting for the local database worker (${label}).`));
		}, DB_REQUEST_TIMEOUT_MS);
		pending.set(id, { resolve: value => resolve(value as T), reject, timeoutId });
		worker.postMessage({ ...payload, id });
	});
}
