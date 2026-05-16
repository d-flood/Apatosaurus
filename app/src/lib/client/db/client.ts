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
} from './rpc';
import type {
	CollationListItem,
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
	UpdateTranscriptionContentInput,
	VerseIndexRebuildResult,
	VerseIndexRow,
} from './repositories/transcriptions';
import type {
	CreateProjectInput,
	ProjectOption,
	ProjectRecord,
	ProjectTranscriptionOption,
	UpdateProjectMetadataInput,
} from './repositories/projects';

let nextRequestId = 1;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const invalidationListeners = new Set<(event: DbInvalidationEvent) => void>();

export async function localDbQuery(sql: string, params: DbValue[] = []): Promise<DbRow[]> {
	await ensureLocalDbRuntime();
	return send<DbRow[]>({ type: 'query', sql, params });
}

export async function localDbExecute(sql: string, params: DbValue[] = []): Promise<{ changes: number }> {
	await ensureLocalDbRuntime();
	return send<{ changes: number }>({ type: 'execute', sql, params });
}

export async function localDbTransaction(
	statements: Array<{ sql: string; params?: DbValue[] }>
): Promise<void> {
	await ensureLocalDbRuntime();
	await send<void>({ type: 'transaction', statements });
}

export function subscribeLocalDbInvalidations(listener: (event: DbInvalidationEvent) => void): () => void {
	invalidationListeners.add(listener);
	return () => invalidationListeners.delete(listener);
}

export async function listTranscriptionSummaries(): Promise<TranscriptionSummary[]> {
	return sendTranscriptionRequest({ type: 'transcriptions.listSummaries' });
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

export async function updateTranscriptionContent(input: UpdateTranscriptionContentInput): Promise<void> {
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

export async function rebuildVerseIndexForTranscriptions(
	transcriptionIds: string[]
): Promise<VerseIndexRebuildResult> {
	return sendTranscriptionRequest({ type: 'transcriptions.rebuildVerseIndex', transcriptionIds });
}

export async function listProjects(): Promise<ProjectOption[]> {
	return sendProjectRequest({ type: 'projects.list' });
}

export async function getProject(projectId: string): Promise<ProjectRecord | null> {
	return sendProjectRequest({ type: 'projects.get', projectId });
}

export async function createProject(input: CreateProjectInput): Promise<string> {
	return sendProjectRequest({ type: 'projects.create', input });
}

export async function updateProjectMetadata(input: UpdateProjectMetadataInput): Promise<void> {
	await sendProjectRequest({ type: 'projects.updateMetadata', input });
}

export async function listProjectTranscriptionOptions(): Promise<ProjectTranscriptionOption[]> {
	return sendProjectRequest({ type: 'projects.listTranscriptionOptions' });
}

export async function loadProjectTranscriptionContent(transcriptionId: string): Promise<string | null> {
	return sendProjectRequest({ type: 'projects.loadTranscriptionContent', transcriptionId });
}

export async function getProjectTranscriptionIds(projectId: string): Promise<string[]> {
	return sendProjectRequest({ type: 'projects.getTranscriptionIds', projectId });
}

export async function syncProjectTranscriptionIds(projectId: string, nextIds: string[]): Promise<void> {
	await sendProjectRequest({ type: 'projects.syncTranscriptionIds', projectId, nextIds });
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
		if (message.ok) pendingRequest.resolve('result' in message ? message.result : undefined);
		else pendingRequest.reject(new Error(message.error));
	});
}

async function send<T>(payload: DbRequestPayload): Promise<T> {
	await ensureLocalDbRuntime();
	const worker = getLocalDbWorker();
	const id = nextRequestId++;
	return new Promise<T>((resolve, reject) => {
		pending.set(id, { resolve: (value) => resolve(value as T), reject });
		worker.postMessage({ ...payload, id });
	});
}

async function sendTranscriptionRequest<T extends TranscriptionRpcRequest>(
	payload: T
): Promise<TranscriptionRpcResponse<T['type']>> {
	return send<TranscriptionRpcResponse<T['type']>>(payload);
}

async function sendProjectRequest<T extends ProjectRpcRequest>(
	payload: T,
): Promise<ProjectRpcResponse<T['type']>> {
	return send<ProjectRpcResponse<T['type']>>(payload);
}

async function sendCollationRequest<T extends CollationRpcRequest>(
	payload: T,
): Promise<CollationRpcResponse<T['type']>> {
	return send<CollationRpcResponse<T['type']>>(payload);
}
