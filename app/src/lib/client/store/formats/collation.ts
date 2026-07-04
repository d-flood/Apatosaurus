import {
	buildCollationHashPayload,
	type SerializedCollation,
	type SerializedCollationArtifact,
	type SerializedCollationReading,
	type SerializedCollationReadingWitness,
	type SerializedCollationToken,
	type SerializedCollationVariationUnit,
	type SerializedCollationWitness,
} from '$lib/client/db/repositories/revisions';

import type { DocumentUpgrader, FormatRegistration } from '../migrate-on-read';
import type { JsonObject, JsonValue, SealedDocument } from '../envelope';
import { readCurrentRevision, type CanonicalCurrentRevision } from './common';
import {
	assertContentHashMatches,
	readArray,
	readBoolean,
	readFiniteNumber,
	readJsonValue,
	readNullableString,
	readObjectValue,
	readString,
} from './validation';

export const COLLATION_FORMAT = 'apatosaurus.collation';
export const COLLATION_CURRENT_VERSION = 1;
export const collationUpgraders: DocumentUpgrader[] = [];

export type CanonicalCollationWitness = JsonObject & SerializedCollationWitness;
export type CanonicalCollationToken = JsonObject & SerializedCollationToken;
export type CanonicalCollationVariationUnit = JsonObject & SerializedCollationVariationUnit;
export type CanonicalCollationReading = JsonObject & SerializedCollationReading;
export type CanonicalCollationReadingWitness = JsonObject & SerializedCollationReadingWitness;
export type CanonicalCollationArtifact = JsonObject &
	Omit<SerializedCollationArtifact, 'payload'> & { payload: JsonValue };

export type CollationPayload = JsonObject & {
	id: string;
	project_id: string | null;
	title: string;
	verse_identifier: string;
	status: string;
	current_revision: CanonicalCurrentRevision;
	group_path: string;
	notes: string;
	sort_key: number;
	created_at: string;
	updated_at: string;
	witnesses: CanonicalCollationWitness[];
	tokens: CanonicalCollationToken[];
	variation_units: CanonicalCollationVariationUnit[];
	readings: CanonicalCollationReading[];
	reading_witnesses: CanonicalCollationReadingWitness[];
	artifacts: CanonicalCollationArtifact[];
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
	witnesses: [
		{
			id: 'witness-a',
			witness_id: 'A',
			content: 'in principio',
			position: 0,
			project_transcription_id: 'pt-1',
			transcription_id: 'tx-1',
			source_revision_id: 'tx-cp-1',
			source_content_hash: 'sha256:tx',
		},
	],
	tokens: [{ id: 'token-a-1', witness_id: 'A', token_index: 0, token_text: 'in' }],
	variation_units: [
		{ id: 'unit-1', start_index: 0, end_index: 1, unit_type: 'variation', base_text: 'in' },
	],
	readings: [
		{
			id: 'reading-a',
			variation_unit_id: 'unit-1',
			reading_order: 0,
			reading_text: 'in',
			is_lacuna: false,
			is_omission: false,
		},
	],
	reading_witnesses: [{ reading_id: 'reading-a', witness_id: 'A' }],
	artifacts: [
		{
			id: 'artifact-1',
			artifact_type: 'collation_document_v1',
			payload: {
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
		},
	],
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
): Omit<CollationPayload, 'current_revision'>;
export function readCollationPayload(
	record: Record<string, unknown>,
	withCurrentRevision: boolean
): CollationPayload | Omit<CollationPayload, 'current_revision'> {
	const base = {
		id: readString(record, 'id'),
		project_id: readNullableString(record, 'project_id'),
		title: readString(record, 'title'),
		verse_identifier: readString(record, 'verse_identifier'),
		status: readString(record, 'status'),
		group_path: readString(record, 'group_path'),
		notes: readString(record, 'notes'),
		sort_key: readFiniteNumber(record, 'sort_key'),
		created_at: readString(record, 'created_at'),
		updated_at: readString(record, 'updated_at'),
		witnesses: readCollationWitnesses(record, 'witnesses'),
		tokens: readCollationTokens(record, 'tokens'),
		variation_units: readVariationUnits(record, 'variation_units'),
		readings: readCollationReadings(record, 'readings'),
		reading_witnesses: readReadingWitnesses(record, 'reading_witnesses'),
		artifacts: readCollationArtifacts(record, 'artifacts'),
	};
	return withCurrentRevision
		? { current_revision: readCurrentRevision(record, 'current_revision'), ...base }
		: base;
}

export async function assertCollationRevisionHash(payload: CollationPayload): Promise<void> {
	await assertContentHashMatches(
		buildCollationHashPayload(collationPayloadToSerializedCollation(payload)),
		payload.current_revision.content_hash,
		`Collation ${payload.id}`
	);
}

export function collationPayloadToSerializedCollation(payload: CollationPayload): SerializedCollation {
	return {
		id: payload.id,
		project_id: payload.project_id,
		title: payload.title,
		verse_identifier: payload.verse_identifier,
		status: payload.status,
		group_path: payload.group_path,
		notes: payload.notes,
		sort_key: payload.sort_key,
		witnesses: payload.witnesses,
		tokens: payload.tokens,
		variation_units: payload.variation_units,
		readings: payload.readings,
		reading_witnesses: payload.reading_witnesses,
		artifacts: payload.artifacts,
	};
}

export const collationFormatRegistration: FormatRegistration<CollationPayload> = {
	format: COLLATION_FORMAT,
	currentVersion: COLLATION_CURRENT_VERSION,
	upgraders: collationUpgraders,
	validate: validateCollationPayload,
};

function readCollationWitnesses(
	record: Record<string, unknown>,
	key: string
): CanonicalCollationWitness[] {
	return readArray(record, key).map((entry, index) => {
		const row = readObjectValue(entry, `${key}[${index}]`);
		return {
			id: readString(row, 'id'),
			witness_id: readString(row, 'witness_id'),
			content: readString(row, 'content'),
			position: readFiniteNumber(row, 'position'),
			project_transcription_id: readNullableString(row, 'project_transcription_id'),
			transcription_id: readNullableString(row, 'transcription_id'),
			source_revision_id: readString(row, 'source_revision_id'),
			source_content_hash: readString(row, 'source_content_hash'),
		};
	});
}

function readCollationTokens(record: Record<string, unknown>, key: string): CanonicalCollationToken[] {
	return readArray(record, key).map((entry, index) => {
		const row = readObjectValue(entry, `${key}[${index}]`);
		return {
			id: readString(row, 'id'),
			witness_id: readString(row, 'witness_id'),
			token_index: readFiniteNumber(row, 'token_index'),
			token_text: readString(row, 'token_text'),
		};
	});
}

function readVariationUnits(
	record: Record<string, unknown>,
	key: string
): CanonicalCollationVariationUnit[] {
	return readArray(record, key).map((entry, index) => {
		const row = readObjectValue(entry, `${key}[${index}]`);
		return {
			id: readString(row, 'id'),
			start_index: readFiniteNumber(row, 'start_index'),
			end_index: readFiniteNumber(row, 'end_index'),
			unit_type: readString(row, 'unit_type'),
			base_text: readString(row, 'base_text'),
		};
	});
}

function readCollationReadings(
	record: Record<string, unknown>,
	key: string
): CanonicalCollationReading[] {
	return readArray(record, key).map((entry, index) => {
		const row = readObjectValue(entry, `${key}[${index}]`);
		return {
			id: readString(row, 'id'),
			variation_unit_id: readString(row, 'variation_unit_id'),
			reading_order: readFiniteNumber(row, 'reading_order'),
			reading_text: readString(row, 'reading_text'),
			is_lacuna: readBoolean(row, 'is_lacuna'),
			is_omission: readBoolean(row, 'is_omission'),
		};
	});
}

function readReadingWitnesses(
	record: Record<string, unknown>,
	key: string
): CanonicalCollationReadingWitness[] {
	return readArray(record, key).map((entry, index) => {
		const row = readObjectValue(entry, `${key}[${index}]`);
		return {
			reading_id: readString(row, 'reading_id'),
			witness_id: readString(row, 'witness_id'),
		};
	});
}

function readCollationArtifacts(
	record: Record<string, unknown>,
	key: string
): CanonicalCollationArtifact[] {
	return readArray(record, key).map((entry, index) => {
		const row = readObjectValue(entry, `${key}[${index}]`);
		return {
			id: readString(row, 'id'),
			artifact_type: readString(row, 'artifact_type'),
			payload: readJsonValue(row, 'payload'),
		};
	});
}
