import {
	parseCollationDocument,
	type CollationDocument as SemanticCollationDocument,
} from '$lib/client/collation/collation-document';

import type { DocumentUpgrader, FormatRegistration } from '../migrate-on-read';
import type { JsonObject, SealedDocument } from '../envelope';
import { readCurrentRevision, type CanonicalCurrentRevision } from './common';
import {
	assertContentHashMatches,
	readFiniteNumber,
	readObjectValue,
	readString,
} from './validation';

export const COLLATION_FORMAT = 'apatosaurus.collation';
export const COLLATION_CURRENT_VERSION = 1;
export const collationUpgraders: DocumentUpgrader[] = [];

export type CollationContent = JsonObject & {
	id: string;
	project_id: string;
	title: string;
	verse_identifier: string;
	status: string;
	group_path: string;
	notes: string;
	sort_key: number;
	document: SemanticCollationDocument & JsonObject;
};

export type CollationPayload = CollationContent & {
	current_revision: CanonicalCurrentRevision;
	created_at: string;
	updated_at: string;
};

export type CollationDocument = SealedDocument<CollationPayload, typeof COLLATION_FORMAT>;

export const COLLATION_FIXTURE: CollationPayload = {
	id: 'col-1',
	project_id: 'project-1',
	title: 'John 1:1 Collation',
	verse_identifier: 'John 1:1',
	status: 'draft',
	current_revision: {
		id: 'col-cp-1',
		content_hash: 'sha256:revision-placeholder',
		created_at: '2026-07-03T00:00:00.000Z',
		author_name: 'Editor',
	},
	group_path: '',
	notes: '',
	sort_key: 0,
	created_at: '2026-07-03T00:00:00.000Z',
	updated_at: '2026-07-03T00:00:00.000Z',
	document: {
				type: 'collationDocument',
				version: 1,
				meta: { collationId: 'col-1', projectId: 'project-1', projectName: 'Project' },
				flow: {
					phase: 'readings',
					furthestPhase: 'readings',
					alignmentDisplayMode: 'regularized',
					alignmentLayout: 'grid',
				},
				setup: {
					selectedVerse: null,
					selectedBook: 'John',
					selectedChapter: '1',
					selectedVerseNum: '1',
					witnesses: [],
				},
				settings: {
					regularizationRules: [],
					ignoreWordBreaks: false,
					lowercase: false,
					ignoreTokenWhitespace: true,
					ignorePunctuation: false,
					suppliedTextMode: 'clear',
					segmentation: true,
				},
				alignment: null,
				apparatus: null,
				stemma: null,
	},
};

export function validateCollationPayload(payload: JsonObject): CollationPayload {
	return readCollationPayload(payload as Record<string, unknown>, true);
}

export function readCollationPayload(
	record: Record<string, unknown>,
	withCurrentRevision: true
): CollationPayload;
export function readCollationPayload(
	record: Record<string, unknown>,
	withCurrentRevision: false
): CollationContent & Pick<CollationPayload, 'created_at' | 'updated_at'>;
export function readCollationPayload(
	record: Record<string, unknown>,
	withCurrentRevision: boolean
): CollationPayload | (CollationContent & Pick<CollationPayload, 'created_at' | 'updated_at'>) {
	const base = {
		...readCollationContent(record),
		created_at: readString(record, 'created_at'),
		updated_at: readString(record, 'updated_at'),
	};
	return withCurrentRevision
		? { current_revision: readCurrentRevision(record, 'current_revision'), ...base }
		: base;
}

export function readCollationContent(record: Record<string, unknown>): CollationContent {
	return {
		id: readString(record, 'id'),
		project_id: readString(record, 'project_id'),
		title: readString(record, 'title'),
		verse_identifier: readString(record, 'verse_identifier'),
		status: readString(record, 'status'),
		group_path: readString(record, 'group_path'),
		notes: readString(record, 'notes'),
		sort_key: readFiniteNumber(record, 'sort_key'),
		document: readSemanticDocument(record, 'document'),
	};
}

export async function assertCollationRevisionHash(payload: CollationPayload): Promise<void> {
	await assertContentHashMatches(collationPayloadToContent(payload), payload.current_revision.content_hash, `Collation ${payload.id}`);
}

export function collationPayloadToContent(payload: CollationPayload): CollationContent {
	return {
		id: payload.id,
		project_id: payload.project_id,
		title: payload.title,
		verse_identifier: payload.verse_identifier,
		status: payload.status,
		group_path: payload.group_path,
		notes: payload.notes,
		sort_key: payload.sort_key,
		document: payload.document,
	};
}

export const collationFormatRegistration: FormatRegistration<CollationPayload> = {
	format: COLLATION_FORMAT,
	currentVersion: COLLATION_CURRENT_VERSION,
	upgraders: collationUpgraders,
	validate: validateCollationPayload,
};

function readSemanticDocument(
	record: Record<string, unknown>,
	key: string
): SemanticCollationDocument & JsonObject {
	const value = readObjectValue(record[key], key);
	const document = parseCollationDocument(value);
	if (!document) throw new Error(`${key} must be a collation_document_v1 document.`);
	return document as SemanticCollationDocument & JsonObject;
}
