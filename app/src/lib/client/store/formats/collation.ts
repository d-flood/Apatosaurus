import {
	parseCollationDocument,
	type CollationDocument as SemanticCollationDocument,
} from '$lib/client/collation/collation-document';

import type { DocumentUpgrader, FormatRegistration } from '../migrate-on-read';
import type { JsonObject, SealedDocument } from '../envelope';
import { readCurrentRevision, type CanonicalCurrentRevision } from './common';
import {
	assertContentHashMatches,
	readArray,
	readFiniteNumber,
	readObjectValue,
	readString,
} from './validation';

export const COLLATION_FORMAT = 'apatosaurus.collation';
export const COLLATION_CURRENT_VERSION = 2;
export const collationUpgraders: DocumentUpgrader[] = [upgradeCollationV1];

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

export async function assertCollationRevisionHash(
	payload: CollationPayload,
	originalVersion = COLLATION_CURRENT_VERSION
): Promise<void> {
	if (originalVersion < COLLATION_CURRENT_VERSION) return;
	await assertContentHashMatches(
		collationPayloadToContent(payload),
		payload.current_revision.content_hash,
		`Collation ${payload.id}`
	);
}

export function upgradeLegacyCollationContent(record: Record<string, unknown>): CollationContent {
	return {
		id: readString(record, 'id'),
		project_id: readString(record, 'project_id'),
		title: readString(record, 'title'),
		verse_identifier: readString(record, 'verse_identifier'),
		status: readString(record, 'status'),
		group_path: readString(record, 'group_path'),
		notes: readString(record, 'notes'),
		sort_key: readFiniteNumber(record, 'sort_key'),
		document: readLegacySemanticDocument(record),
	};
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

async function upgradeCollationV1(payload: JsonObject): Promise<JsonObject> {
	const record = payload as Record<string, unknown>;
	const currentRevision = readObjectValue(record.current_revision, 'current_revision');
	await assertContentHashMatches(
		buildLegacyCollationHashPayload(record),
		readString(currentRevision, 'content_hash'),
		`Collation ${readString(record, 'id')}`
	);
	return {
		...upgradeLegacyCollationContent(record),
		current_revision: record.current_revision as JsonObject,
		created_at: readString(record, 'created_at'),
		updated_at: readString(record, 'updated_at'),
	};
}

function readLegacySemanticDocument(
	record: Record<string, unknown>
): SemanticCollationDocument & JsonObject {
	for (const [index, value] of readArray(record, 'artifacts').entries()) {
		const artifact = readObjectValue(value, `artifacts[${index}]`);
		if (readString(artifact, 'artifact_type') !== 'collation_document_v1') continue;
		const document = parseCollationDocument(artifact.payload);
		if (document) return document as SemanticCollationDocument & JsonObject;
	}
	throw new Error('artifacts must contain a valid collation_document_v1 document.');
}

export function buildLegacyCollationHashPayload(record: Record<string, unknown>): JsonObject {
	const witnesses = readLegacyRows(record, 'witnesses');
	const tokens = readLegacyRows(record, 'tokens');
	const units = readLegacyRows(record, 'variation_units');
	const readings = readLegacyRows(record, 'readings');
	const readingWitnesses = readLegacyRows(record, 'reading_witnesses');
	const artifacts = readLegacyRows(record, 'artifacts');
	return {
		id: readString(record, 'id'),
		project_id: readString(record, 'project_id'),
		title: readString(record, 'title'),
		verse_identifier: readString(record, 'verse_identifier'),
		status: readString(record, 'status'),
		group_path: readString(record, 'group_path'),
		notes: readString(record, 'notes'),
		sort_key: readFiniteNumber(record, 'sort_key'),
		witnesses: witnesses
			.sort(
				(left, right) =>
					compareNumbers(left.position, right.position) ||
					compareStrings(left.id, right.id)
			)
			.map(row =>
				pick(row, [
					'witness_id',
					'content',
					'position',
					'project_transcription_id',
					'transcription_id',
					'source_revision_id',
					'source_content_hash',
				])
			),
		tokens: tokens
			.sort(
				(left, right) =>
					compareStrings(left.witness_id, right.witness_id) ||
					compareNumbers(left.token_index, right.token_index)
			)
			.map(row => pick(row, ['witness_id', 'token_index', 'token_text'])),
		variation_units: units
			.sort(
				(left, right) =>
					compareNumbers(left.start_index, right.start_index) ||
					compareNumbers(left.end_index, right.end_index) ||
					compareStrings(left.id, right.id)
			)
			.map(unit => ({
				...pick(unit, ['start_index', 'end_index', 'unit_type', 'base_text']),
				readings: readings
					.filter(reading => reading.variation_unit_id === unit.id)
					.sort(
						(left, right) =>
							compareNumbers(left.reading_order, right.reading_order) ||
							compareStrings(left.id, right.id)
					)
					.map(reading => ({
						...pick(reading, [
							'reading_order',
							'reading_text',
							'is_lacuna',
							'is_omission',
						]),
						witness_ids: readingWitnesses
							.filter(row => row.reading_id === reading.id)
							.map(row => readString(row, 'witness_id'))
							.sort(compareStrings),
					})),
			})),
		artifacts: artifacts
			.sort(
				(left, right) =>
					compareStrings(left.artifact_type, right.artifact_type) ||
					compareStrings(left.id, right.id)
			)
			.map(row => pick(row, ['artifact_type', 'payload'])),
	};
}

function readLegacyRows(record: Record<string, unknown>, key: string): Record<string, unknown>[] {
	return readArray(record, key).map((value, index) => readObjectValue(value, `${key}[${index}]`));
}

function pick(record: Record<string, unknown>, keys: string[]): JsonObject {
	return Object.fromEntries(keys.map(key => [key, record[key]])) as JsonObject;
}

function compareNumbers(left: unknown, right: unknown): number {
	return Number(left) - Number(right);
}

function compareStrings(left: unknown, right: unknown): number {
	return String(left).localeCompare(String(right));
}
