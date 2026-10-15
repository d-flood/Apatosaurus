import {
	parseCollationDocument,
	readWitnessSource,
	type CollationDocument as SemanticCollationDocument,
} from '$lib/collation/collation-document';

import type { DocumentUpgrader, FormatRegistration } from '../migrate-on-read';
import type { JsonObject } from '../envelope';
import {
	readCurrentDraft,
	readCurrentRevision,
	readNullableCheckpointReference,
	type CanonicalCheckpointReference,
	type CanonicalCurrentDraft,
	type CanonicalDraftMetadata,
} from './common';
import { upgradeAlphaCollation } from './alpha-collation';
import {
	assertContentHashMatches,
	readFiniteNumber,
	readObjectValue,
	readString,
} from './validation';

export const COLLATION_FORMAT = 'apatosaurus.collation';
export const COLLATION_CURRENT_VERSION = 11;
const collationUpgraders: DocumentUpgrader[] = [];

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
	based_on_checkpoint: CanonicalCheckpointReference | null;
	draft: CanonicalCurrentDraft;
	created_at: string;
	updated_at: string;
	conflict_of_collation_id?: string;
};

function validateCollationPayload(payload: JsonObject): CollationPayload {
	const record = payload as Record<string, unknown>;
	return {
		...readCollationContent(record),
		based_on_checkpoint: readNullableCheckpointReference(record, 'based_on_checkpoint'),
		draft: readCurrentDraft(record, 'draft'),
		created_at: readString(record, 'created_at'),
		updated_at: readString(record, 'updated_at'),
		...(record.conflict_of_collation_id === undefined
			? {}
			: { conflict_of_collation_id: readString(record, 'conflict_of_collation_id') }),
	};
}

async function upgradeCollationV6(payload: JsonObject): Promise<JsonObject> {
	const { current_revision: _currentRevision, ...content } = payload;
	const revision = readCurrentRevision(payload, 'current_revision');
	await assertContentHashMatches(
		collationPayloadToContent(readCollationContent(content)),
		revision.content_hash,
		`Collation ${readString(payload, 'id')}`
	);
	return upgradeCollationV7({
		...content,
		based_on_checkpoint: { id: revision.id, content_hash: revision.content_hash },
		draft: { saved_at: readString(payload, 'updated_at'), author_name: null },
	});
}

function upgradeCollationV7(payload: JsonObject): JsonObject {
	const document = readObjectValue(payload.document, 'document');
	const setup = readObjectValue(document.setup, 'document.setup');
	const witnesses = Array.isArray(setup.witnesses) ? setup.witnesses : [];
	const capturedAt = readString(payload, 'updated_at');
	return {
		...payload,
		document: {
			...document,
			setup: {
				...setup,
				witnesses: witnesses.map(node => {
					if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
					const {
						sourceVersion: _sourceVersion,
						sourceContentHash: _sourceContentHash,
						...rest
					} = node as JsonObject;
					const source = readWitnessSource(node as JsonObject, capturedAt);
					return source ? { ...rest, source } : rest;
				}),
			},
		},
	} as JsonObject;
}

async function upgradeAlphaCollationToCurrent(payload: JsonObject): Promise<JsonObject> {
	return upgradeCollationV6(await upgradeAlphaCollation(payload));
}

export function mergeWorkingCollation(
	primary: CollationPayload,
	working: CollationContent & {
		created_at: string;
		updated_at: string;
		draft: CanonicalDraftMetadata;
	}
): CollationPayload {
	return upgradeCollationV7({
		...collationPayloadToContent(working),
		based_on_checkpoint: primary.based_on_checkpoint,
		draft: { saved_at: working.draft.saved_at, author_name: working.draft.author_name },
		created_at: working.created_at,
		updated_at: working.updated_at,
	}) as CollationPayload;
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

export function collationPayloadToContent(payload: CollationContent): CollationContent {
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
	directUpgraders: {
		2: upgradeAlphaCollationToCurrent,
		6: upgradeCollationV6,
		7: upgradeCollationV7,
		8: payload => payload,
		9: payload => payload,
		10: payload => payload,
	},
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
