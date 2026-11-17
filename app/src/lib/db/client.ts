import { notificationCenter } from '$lib/shell/notification-center.svelte';
import { indexRebuildProgress } from './index-rebuild-progress.svelte';
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
import {
	ensureLocalDbRuntime,
	getLocalDbWorker,
	markIndexVerified,
	reportRuntimeInitFailure,
} from './runtime';
import { coalesce } from './coalesce';
import { flushPendingSaves } from './pending-saves';

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

let nextRequestId = 1;
const pending = new Map<
	number,
	{
		resolve: (value: unknown) => void;
		reject: (error: Error) => void;
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
export const exportTranscriptionTei = call('exportTranscriptionTei');
export const getCurrentVerseSources = call('getCurrentVerseSources');
export const createTranscription = call('createTranscription');
export const createTranscriptions = call('createTranscriptions');
export const updateTranscriptionMetadata = call('updateTranscriptionMetadata');
export const reimportTranscriptionContent = call('reimportTranscriptionContent');
export const deleteTranscription = call('deleteTranscription');
export const getVerseIndexRowsForVerse = call('getVerseIndexRowsForVerse');
export const listVerseIndexRows = call('listVerseIndexRows');
export const listVerseIndexRowsForTranscription = call('listVerseIndexRowsForTranscription');
export const listVerseCountsForTranscriptions = call('listVerseCountsForTranscriptions');
export const rebuildVerseIndexForTranscriptions = call('rebuildVerseIndexForTranscriptions');

export async function updateTranscriptionContent(input: UpdateTranscriptionContentInput) {
	const { id, contentJson, format, updatedAt } = input;
	return send<DbResult<'updateTranscriptionContent'>>({
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
export const listProjectTranscriptionStatuses = coalesce(call('listProjectTranscriptionStatuses'));
export const listProjectDocumentTitles = call('listProjectDocumentTitles');
export const listProjectIdsWithContent = call('listProjectIdsWithContent');
export const getProjectTranscriptionStatusForOwnedTranscription = call(
	'getProjectTranscriptionStatusForOwnedTranscription'
);
export const getProjectTranscriptionIds = call('getProjectTranscriptionIds');
export const syncProjectTranscriptionIds = call('syncProjectTranscriptionIds');
export const refreshProjectTranscription = call('refreshProjectTranscription');
export const addProjectTranscriptionFromProject = call('addProjectTranscriptionFromProject');
export const listProjectTranscriptionSourceCandidates = call(
	'listProjectTranscriptionSourceCandidates'
);

export const listCollationsWithProjectNames = call('listCollationsWithProjectNames');
export const getNextCollationSortKey = call('getNextCollationSortKey');
export const createCollation = call('createCollation');
export const loadCollation = call('loadCollation');
export const listProjectCollationVersionStatuses = call('listProjectCollationVersionStatuses');
export const getCollationVersionStatus = coalesce(call('getCollationVersionStatus'));
export const saveCollationArtifact = call('saveCollationArtifact');
export const updateCollationMetadata = call('updateCollationMetadata');
export const deleteCollation = call('deleteCollation');

export const createCbgmAnalysis = call('createCbgmAnalysis');
export const completeCbgmCoherence = call('completeCbgmCoherence');
export const failCbgmCoherence = call('failCbgmCoherence');
export const setCbgmGlobalStemmaState = call('setCbgmGlobalStemmaState');
export const failCbgmGlobalStemma = call('failCbgmGlobalStemma');
export const readCbgmAnalysis = call('readCbgmAnalysis');
export const findCbgmAnalysis = call('findCbgmAnalysis');
export const loadCbgmCollationSnapshots = call('loadCbgmCollationSnapshots');
export const readCbgmCollationHashes = call('readCbgmCollationHashes');
export const readCbgmAnalysisCache = call('readCbgmAnalysisCache');
export const readCbgmAnalysisInputTei = call('readCbgmAnalysisInputTei');
export const readCbgmImportedGlobalStemma = call('readCbgmImportedGlobalStemma');
export const exportCbgmNativeInputs = call('exportCbgmNativeInputs');
export const listCbgmAnalyses = call('listCbgmAnalyses');
export const deleteCbgmAnalysis = call('deleteCbgmAnalysis');

export const listManifestSources = call('listManifestSources');
export const ensureManifestSource = call('ensureManifestSource');
export const cacheManifest = call('cacheManifest');
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
export const listTranscriptionVersions = call('listTranscriptionVersions');
export const getTranscriptionSourceOptions = call('getTranscriptionSourceOptions');
export const listCollationVersions = call('listCollationVersions');
export const restoreTranscriptionVersion = call('restoreTranscriptionVersion');
export const replaceTranscriptionCurrent = call('replaceTranscriptionCurrent');
export const updateTranscriptionVersionNote = call('updateTranscriptionVersionNote');
export const restoreCollationVersion = call('restoreCollationVersion');
export const replaceCollationCurrent = call('replaceCollationCurrent');
export const updateCollationVersionNote = call('updateCollationVersionNote');
export const loadTranscriptionVersionContent = call('loadTranscriptionVersionContent');
export const listConflictCopies = call('listConflictCopies');
export const loadConflictCopyContents = call('loadConflictCopyContents');
export const reconcileConflictCopy = call('reconcileConflictCopy');
export const loadCollationVersionDocument = call('loadCollationVersionDocument');
export const getLatestProjectCommitTimestamp = call('getLatestProjectCommitTimestamp');
export const loadCommittedTranscriptionCheckpointPayload = call(
	'loadCommittedTranscriptionCheckpointPayload'
);

// `$state` proxies cannot cross `postMessage`; spreading the context detaches it.
export function listPendingUploadPaths(context: SyncProjectContext) {
	return call('listPendingUploadPaths')({ ...context });
}

export function backupProject(context: SyncProjectContext) {
	return call('backupProject')({ ...context });
}

export const discoverLocationProjects = call('discoverLocationProjects');
export const writeEditingPresence = call('writeEditingPresence');
export const clearEditingPresence = call('clearEditingPresence');
export const readEditingNotice = call('readEditingNotice');
export const removeProjectsFromDevice = call('removeProjectsFromDevice');
export const moveProject = call('moveProject');
export const deleteProject = call('deleteProject');
export const exportProjectZip = call('exportProjectZip');
export const exportAllProjectsZip = call('exportAllProjectsZip');
export const importProjectZip = call('importProjectZip');
export const restoreReferenceEditionsArchive = call('restoreReferenceEditionsArchive');
export const convertProjectToTei = call('convertProjectToTei');
export const refreshChangedDocumentFiles = call('refreshChangedDocumentFiles');
export const listDocumentFileProblems = call('listDocumentFileProblems');
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
			else if (message.type === 'db:index-verified') markIndexVerified();
			else if (message.type === 'db:index-damaged') void repairDamagedIndex(message.details);
			else if (message.type === 'db:index-rebuild-progress') {
				indexRebuildProgress.done = message.done;
				indexRebuildProgress.total = message.total;
				indexRebuildProgress.phase = message.phase ?? 'rebuild';
			} else reportAutomaticIndexRebuild(message);
			return;
		}
		const pendingRequest = pending.get(message.id);
		if (!pendingRequest) return;
		pending.delete(message.id);
		if (message.ok) pendingRequest.resolve(message.result);
		else pendingRequest.reject(new Error(message.error));
	});
}

async function repairDamagedIndex(details: string[]): Promise<void> {
	await flushPendingSaves();
	try {
		await send({ type: 'rebuild-damaged-index', details });
	} catch (error) {
		indexRebuildProgress.done = 0;
		indexRebuildProgress.total = 0;
		reportRuntimeInitFailure(error, 'Local database repair failed');
	}
}

function reportAutomaticIndexRebuild(message: DbIndexRebuiltEvent): void {
	const issue =
		message.reason === 'integrity-failed' ? 'failed an integrity check' : 'failed to open';
	notificationCenter.upsert({
		id: 'local-db-index-rebuilt',
		title: 'Local database repaired',
		message: `The local index ${issue}. Rebuilt ${message.report.projectsRestored} project(s), ${message.report.transcriptionsRestored} transcription(s), and ${message.report.collationsRestored} collation(s) from your files.`,
		tone: 'warning',
		persistent: true,
	});
}

async function send<T>(payload: DbRequestPayload): Promise<T> {
	await ensureLocalDbRuntime();
	const worker = getLocalDbWorker();
	const id = nextRequestId++;
	return new Promise<T>((resolve, reject) => {
		pending.set(id, { resolve: value => resolve(value as T), reject });
		worker.postMessage({ ...payload, id });
	});
}
