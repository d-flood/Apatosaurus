import type {
	CreateProjectInput,
	ProjectOption,
	ProjectRecord,
	ProjectTranscriptionOption,
	UpdateProjectMetadataInput,
} from './repositories/projects';
import type {
	CollationListItem,
	CreateCollationInput,
	LoadedCollation,
	SaveCollationArtifactInput,
	SaveCollationProjectionInput,
	UpdateCollationMetadataInput,
} from './repositories/collations';
import type {
	CreateTranscriptionInput,
	TranscriptionRecord,
	TranscriptionSummary,
	UpdateTranscriptionContentInput,
	VerseIndexRebuildResult,
	VerseIndexRow,
} from './repositories/transcriptions';

export type DbValue = string | number | boolean | null | Uint8Array;
export type DbRow = Record<string, unknown>;

export interface TranscriptionRpcMap {
	'transcriptions.listSummaries': {
		request: { type: 'transcriptions.listSummaries' };
		response: TranscriptionSummary[];
	};
	'transcriptions.get': {
		request: { type: 'transcriptions.get'; transcriptionId: string };
		response: TranscriptionRecord | null;
	};
	'transcriptions.getByIds': {
		request: { type: 'transcriptions.getByIds'; ids: string[] };
		response: TranscriptionRecord[];
	};
	'transcriptions.create': {
		request: { type: 'transcriptions.create'; input: CreateTranscriptionInput };
		response: string;
	};
	'transcriptions.createMany': {
		request: { type: 'transcriptions.createMany'; inputs: CreateTranscriptionInput[] };
		response: string[];
	};
	'transcriptions.updateContent': {
		request: { type: 'transcriptions.updateContent'; input: UpdateTranscriptionContentInput };
		response: null;
	};
	'transcriptions.delete': {
		request: { type: 'transcriptions.delete'; transcriptionId: string };
		response: null;
	};
	'transcriptions.getVerseIndexRowsForVerse': {
		request: { type: 'transcriptions.getVerseIndexRowsForVerse'; verseIdentifier: string; transcriptionIds?: string[] };
		response: VerseIndexRow[];
	};
	'transcriptions.listVerseIndexRows': {
		request: { type: 'transcriptions.listVerseIndexRows' };
		response: VerseIndexRow[];
	};
	'transcriptions.rebuildVerseIndex': {
		request: { type: 'transcriptions.rebuildVerseIndex'; transcriptionIds: string[] };
		response: VerseIndexRebuildResult;
	};
}

export type TranscriptionRpcRequest = TranscriptionRpcMap[keyof TranscriptionRpcMap]['request'];

export type TranscriptionRpcResponse<T extends TranscriptionRpcRequest['type']> = TranscriptionRpcMap[T]['response'];

export interface ProjectRpcMap {
	'projects.list': { request: { type: 'projects.list' }; response: ProjectOption[] };
	'projects.get': { request: { type: 'projects.get'; projectId: string }; response: ProjectRecord | null };
	'projects.create': { request: { type: 'projects.create'; input: CreateProjectInput }; response: string };
	'projects.updateMetadata': { request: { type: 'projects.updateMetadata'; input: UpdateProjectMetadataInput }; response: null };
	'projects.listTranscriptionOptions': { request: { type: 'projects.listTranscriptionOptions' }; response: ProjectTranscriptionOption[] };
	'projects.loadTranscriptionContent': { request: { type: 'projects.loadTranscriptionContent'; transcriptionId: string }; response: string | null };
	'projects.getTranscriptionIds': { request: { type: 'projects.getTranscriptionIds'; projectId: string }; response: string[] };
	'projects.syncTranscriptionIds': { request: { type: 'projects.syncTranscriptionIds'; projectId: string; nextIds: string[] }; response: null };
}

export type ProjectRpcRequest = ProjectRpcMap[keyof ProjectRpcMap]['request'];

export type ProjectRpcResponse<T extends ProjectRpcRequest['type']> = ProjectRpcMap[T]['response'];

export interface CollationRpcMap {
	'collations.listWithProjectNames': { request: { type: 'collations.listWithProjectNames' }; response: CollationListItem[] };
	'collations.create': { request: { type: 'collations.create'; input: CreateCollationInput }; response: string };
	'collations.load': { request: { type: 'collations.load'; collationId: string }; response: LoadedCollation | null };
	'collations.saveArtifact': { request: { type: 'collations.saveArtifact'; input: SaveCollationArtifactInput }; response: string };
	'collations.saveProjection': { request: { type: 'collations.saveProjection'; input: SaveCollationProjectionInput }; response: null };
	'collations.updateMetadata': { request: { type: 'collations.updateMetadata'; input: UpdateCollationMetadataInput }; response: null };
	'collations.delete': { request: { type: 'collations.delete'; collationId: string }; response: null };
}

export type CollationRpcRequest = CollationRpcMap[keyof CollationRpcMap]['request'];

export type CollationRpcResponse<T extends CollationRpcRequest['type']> = CollationRpcMap[T]['response'];

export type DbRequest =
	| { id?: number; type: 'init' }
	| { id?: number; type: 'query'; sql: string; params?: DbValue[] }
	| { id?: number; type: 'execute'; sql: string; params?: DbValue[] }
	| { id?: number; type: 'exec'; sql: string }
	| { id?: number; type: 'transaction'; statements: Array<{ sql: string; params?: DbValue[] }> }
	| { id?: number; type: 'checkpoint' }
	| { id?: number; type: 'reset' }
	| ({ id?: number } & TranscriptionRpcRequest)
	| ({ id?: number } & ProjectRpcRequest)
	| ({ id?: number } & CollationRpcRequest);

export type DbRequestPayload =
	| { type: 'init' }
	| { type: 'query'; sql: string; params?: DbValue[] }
	| { type: 'execute'; sql: string; params?: DbValue[] }
	| { type: 'exec'; sql: string }
	| { type: 'transaction'; statements: Array<{ sql: string; params?: DbValue[] }> }
	| { type: 'checkpoint' }
	| { type: 'reset' }
	| TranscriptionRpcRequest
	| ProjectRpcRequest
	| CollationRpcRequest;

export type DbResponse =
	| { id: number; ok: true; result?: unknown }
	| { id: number; ok: false; error: string };

export type DbInvalidationEvent = {
	type: 'db:invalidate';
	domain: string;
};

export type DbWorkerMessage = DbResponse | DbInvalidationEvent;
