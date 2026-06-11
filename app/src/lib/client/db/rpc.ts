import type {
	CloudConnectionRecord,
	UpsertCloudConnectionInput,
} from './repositories/cloud-connections';
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
	TranscriptionVersion,
	UpdateTranscriptionContentInput,
	VerseIndexRebuildResult,
	VerseIndexRow,
} from './repositories/transcriptions';
import type {
	CanvasAnnotationIdInput,
	DeletePageCanvasLinkInput,
	EnsureManifestSourceInput,
	FindLinkedPageForCanvasInput,
	ListCanvasAnnotationsInput,
	ManifestSourceIdInput,
	UpsertCanvasAnnotationInput,
} from './repositories/iiif';
import type {
	CollationCheckpoint,
	CommitCollationInput,
	CommitTranscriptionInput,
	TranscriptionCheckpoint,
} from './repositories/revisions';
import type { ManifestSourceSummary, PageCanvasLink, SavePageCanvasLinkInput } from '../iiif/types';
import type { W3CAnnotation } from 'triiiceratops/plugins/annotation-editor';

export type DbValue = string | number | boolean | null | Uint8Array;
export type DbRow = Record<string, unknown>;

export interface TranscriptionRpcMap {
	'transcriptions.listSummaries': {
		request: { type: 'transcriptions.listSummaries' };
		response: TranscriptionSummary[];
	};
	'transcriptions.getSummary': {
		request: { type: 'transcriptions.getSummary'; transcriptionId: string };
		response: TranscriptionSummary | null;
	};
	'transcriptions.getVersionsByIds': {
		request: { type: 'transcriptions.getVersionsByIds'; ids: string[] };
		response: TranscriptionVersion[];
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
		request: {
			type: 'transcriptions.getVerseIndexRowsForVerse';
			verseIdentifier: string;
			transcriptionIds?: string[];
		};
		response: VerseIndexRow[];
	};
	'transcriptions.listVerseIndexRows': {
		request: { type: 'transcriptions.listVerseIndexRows' };
		response: VerseIndexRow[];
	};
	'transcriptions.listVerseIndexRowsForTranscription': {
		request: {
			type: 'transcriptions.listVerseIndexRowsForTranscription';
			transcriptionId: string;
		};
		response: VerseIndexRow[];
	};
	'transcriptions.rebuildVerseIndex': {
		request: { type: 'transcriptions.rebuildVerseIndex'; transcriptionIds: string[] };
		response: VerseIndexRebuildResult;
	};
}

export type TranscriptionRpcRequest = TranscriptionRpcMap[keyof TranscriptionRpcMap]['request'];

export type TranscriptionRpcResponse<T extends TranscriptionRpcRequest['type']> =
	TranscriptionRpcMap[T]['response'];

export interface ProjectRpcMap {
	'projects.list': { request: { type: 'projects.list' }; response: ProjectOption[] };
	'projects.get': {
		request: { type: 'projects.get'; projectId: string };
		response: ProjectRecord | null;
	};
	'projects.create': {
		request: { type: 'projects.create'; input: CreateProjectInput };
		response: string;
	};
	'projects.updateMetadata': {
		request: { type: 'projects.updateMetadata'; input: UpdateProjectMetadataInput };
		response: null;
	};
	'projects.listTranscriptionOptions': {
		request: { type: 'projects.listTranscriptionOptions'; projectId?: string };
		response: ProjectTranscriptionOption[];
	};
	'projects.loadTranscriptionContent': {
		request: { type: 'projects.loadTranscriptionContent'; transcriptionId: string };
		response: string | null;
	};
	'projects.getTranscriptionIds': {
		request: { type: 'projects.getTranscriptionIds'; projectId: string };
		response: string[];
	};
	'projects.syncTranscriptionIds': {
		request: { type: 'projects.syncTranscriptionIds'; projectId: string; nextIds: string[] };
		response: string[];
	};
}

export type ProjectRpcRequest = ProjectRpcMap[keyof ProjectRpcMap]['request'];

export type ProjectRpcResponse<T extends ProjectRpcRequest['type']> = ProjectRpcMap[T]['response'];

export interface CollationRpcMap {
	'collations.listWithProjectNames': {
		request: { type: 'collations.listWithProjectNames' };
		response: CollationListItem[];
	};
	'collations.create': {
		request: { type: 'collations.create'; input: CreateCollationInput };
		response: string;
	};
	'collations.load': {
		request: { type: 'collations.load'; collationId: string };
		response: LoadedCollation | null;
	};
	'collations.saveArtifact': {
		request: { type: 'collations.saveArtifact'; input: SaveCollationArtifactInput };
		response: string;
	};
	'collations.saveProjection': {
		request: { type: 'collations.saveProjection'; input: SaveCollationProjectionInput };
		response: null;
	};
	'collations.updateMetadata': {
		request: { type: 'collations.updateMetadata'; input: UpdateCollationMetadataInput };
		response: null;
	};
	'collations.delete': {
		request: { type: 'collations.delete'; collationId: string };
		response: null;
	};
}

export type CollationRpcRequest = CollationRpcMap[keyof CollationRpcMap]['request'];

export type CollationRpcResponse<T extends CollationRpcRequest['type']> =
	CollationRpcMap[T]['response'];

export interface IiifRpcMap {
	'iiif.listManifestSources': {
		request: { type: 'iiif.listManifestSources'; transcriptionId: string };
		response: ManifestSourceSummary[];
	};
	'iiif.listManifestSourcesForUrl': {
		request: {
			type: 'iiif.listManifestSourcesForUrl';
			transcriptionId: string;
			manifestUrl: string;
		};
		response: ManifestSourceSummary[];
	};
	'iiif.ensureManifestSource': {
		request: { type: 'iiif.ensureManifestSource'; input: EnsureManifestSourceInput };
		response: ManifestSourceSummary;
	};
	'iiif.getManifestSource': {
		request: { type: 'iiif.getManifestSource'; input: ManifestSourceIdInput };
		response: ManifestSourceSummary | null;
	};
	'iiif.listPageCanvasLinks': {
		request: { type: 'iiif.listPageCanvasLinks'; transcriptionId: string };
		response: PageCanvasLink[];
	};
	'iiif.upsertPageCanvasLink': {
		request: { type: 'iiif.upsertPageCanvasLink'; input: SavePageCanvasLinkInput };
		response: PageCanvasLink;
	};
	'iiif.savePageCanvasLinks': {
		request: { type: 'iiif.savePageCanvasLinks'; inputs: SavePageCanvasLinkInput[] };
		response: PageCanvasLink[];
	};
	'iiif.deletePageCanvasLink': {
		request: { type: 'iiif.deletePageCanvasLink'; input: DeletePageCanvasLinkInput };
		response: number;
	};
	'iiif.deletePageCanvasLinksForPage': {
		request: {
			type: 'iiif.deletePageCanvasLinksForPage';
			input: { transcriptionId: string; pageId: string };
		};
		response: number;
	};
	'iiif.deleteAllPageCanvasLinks': {
		request: { type: 'iiif.deleteAllPageCanvasLinks'; transcriptionId: string };
		response: number;
	};
	'iiif.deleteManifestSource': {
		request: { type: 'iiif.deleteManifestSource'; input: ManifestSourceIdInput };
		response: boolean;
	};
	'iiif.deleteManifestSourceLinks': {
		request: { type: 'iiif.deleteManifestSourceLinks'; input: ManifestSourceIdInput };
		response: number;
	};
	'iiif.findLinkedPageForCanvas': {
		request: { type: 'iiif.findLinkedPageForCanvas'; input: FindLinkedPageForCanvasInput };
		response: PageCanvasLink | null;
	};
	'iiif.listCanvasAnnotations': {
		request: { type: 'iiif.listCanvasAnnotations'; input: ListCanvasAnnotationsInput };
		response: W3CAnnotation[];
	};
	'iiif.getCanvasAnnotation': {
		request: { type: 'iiif.getCanvasAnnotation'; input: CanvasAnnotationIdInput };
		response: W3CAnnotation | null;
	};
	'iiif.upsertCanvasAnnotation': {
		request: { type: 'iiif.upsertCanvasAnnotation'; input: UpsertCanvasAnnotationInput };
		response: null;
	};
	'iiif.deleteCanvasAnnotation': {
		request: { type: 'iiif.deleteCanvasAnnotation'; input: CanvasAnnotationIdInput };
		response: null;
	};
}

export type IiifRpcRequest = IiifRpcMap[keyof IiifRpcMap]['request'];

export type IiifRpcResponse<T extends IiifRpcRequest['type']> = IiifRpcMap[T]['response'];

export interface RevisionRpcMap {
	'revisions.commitTranscription': {
		request: { type: 'revisions.commitTranscription'; input: CommitTranscriptionInput };
		response: TranscriptionCheckpoint;
	};
	'revisions.commitCollation': {
		request: { type: 'revisions.commitCollation'; input: CommitCollationInput };
		response: CollationCheckpoint;
	};
	'revisions.isTranscriptionDirty': {
		request: { type: 'revisions.isTranscriptionDirty'; projectTranscriptionId: string };
		response: boolean;
	};
	'revisions.isCollationDirty': {
		request: { type: 'revisions.isCollationDirty'; collationId: string };
		response: boolean;
	};
}

export type RevisionRpcRequest = RevisionRpcMap[keyof RevisionRpcMap]['request'];

export type RevisionRpcResponse<T extends RevisionRpcRequest['type']> =
	RevisionRpcMap[T]['response'];

export interface CloudConnectionRpcMap {
	'cloudConnections.list': {
		request: { type: 'cloudConnections.list' };
		response: CloudConnectionRecord[];
	};
	'cloudConnections.upsert': {
		request: { type: 'cloudConnections.upsert'; input: UpsertCloudConnectionInput };
		response: CloudConnectionRecord;
	};
	'cloudConnections.disconnect': {
		request: { type: 'cloudConnections.disconnect'; connectionId: string };
		response: boolean;
	};
}

export type CloudConnectionRpcRequest =
	CloudConnectionRpcMap[keyof CloudConnectionRpcMap]['request'];

export type CloudConnectionRpcResponse<T extends CloudConnectionRpcRequest['type']> =
	CloudConnectionRpcMap[T]['response'];

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
	| ({ id?: number } & CollationRpcRequest)
	| ({ id?: number } & IiifRpcRequest)
	| ({ id?: number } & RevisionRpcRequest)
	| ({ id?: number } & CloudConnectionRpcRequest);

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
	| CollationRpcRequest
	| IiifRpcRequest
	| RevisionRpcRequest
	| CloudConnectionRpcRequest;

export type DbResponse =
	| { id: number; ok: true; result?: unknown }
	| { id: number; ok: false; error: string };

export type DbInvalidationEvent = {
	type: 'db:invalidate';
	domain: string;
};

export type DbWorkerMessage = DbResponse | DbInvalidationEvent;
