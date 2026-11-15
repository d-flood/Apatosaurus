import type { CollationDocument as SemanticCollationDocument } from '$lib/collation/collation-document';
import type { CollationVocabulary } from '$lib/collation/collation-apparatus-tei';
import {
	parseCollationTeiChanges,
	parseCollationTeiParts,
	serializeCollationTei,
	type CollationRevisionChange,
	type SerializedCollationTei,
} from '$lib/collation/collation-document-tei';

import type { JsonObject } from '../envelope';
import type { CanonicalCheckpointReference, CanonicalCurrentDraft } from './common';

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

export interface CollationTeiVersion {
	id: string;
	label: string;
	note: string | null;
	author_name: string;
	created_at: string;
	parent_id: string | null;
}

const IDNO = {
	basedOn: 'apatosaurus-based-on',
	basedOnHash: 'apatosaurus-based-on-hash',
	version: 'apatosaurus-version',
	parentVersion: 'apatosaurus-parent-version',
} as const;
const VERSION_CHANGE = 'version';
const BASED_ON_CHANGE = 'based-on';

/**
 * The collation's TEI file. Record fields go in the working-state layer; the based-on Version
 * sits in `<revisionDesc>` so it stays out of the content hash.
 */
export async function serializeCollationPayloadTei(
	payload: CollationPayload,
	vocab: CollationVocabulary,
	version: CollationTeiVersion | null = null
): Promise<SerializedCollationTei> {
	const savedAt = payload.draft.saved_at;
	const basedOn = payload.based_on_checkpoint;
	return serializeCollationTei(payload.document, vocab, {
		notes: payload.notes,
		record: {
			id: payload.id,
			projectId: payload.project_id,
			title: payload.title,
			verseIdentifier: payload.verse_identifier,
			status: payload.status,
			groupPath: payload.group_path,
			sortKey: payload.sort_key,
			notes: payload.notes,
			...(payload.conflict_of_collation_id
				? { conflictOf: payload.conflict_of_collation_id }
				: {}),
		},
		changes: [
			...(payload.created_at ? [{ type: 'created', when: payload.created_at }] : []),
			...(savedAt || payload.draft.author_name !== null
				? [{ type: 'saved', when: savedAt, author: payload.draft.author_name }]
				: []),
			...(payload.updated_at !== savedAt
				? [{ type: 'updated', when: payload.updated_at }]
				: []),
			...(basedOn
				? [
						{
							type: BASED_ON_CHANGE,
							idnos: [
								[IDNO.basedOn, basedOn.id],
								[IDNO.basedOnHash, basedOn.content_hash],
							] as const,
						},
					]
				: []),
			...(version ? [versionChange(version)] : []),
		],
	});
}

export function parseCollationPayloadTei(xml: string): CollationPayload {
	return parseCollationTeiVersion(xml).payload;
}

export function parseCollationTeiVersion(xml: string): {
	payload: CollationPayload;
	version: CollationTeiVersion | null;
} {
	const { document, record, changes } = parseCollationTeiParts(xml);
	const change = (type: string) => changes.find(entry => entry.type === type);
	const saved = change('saved');
	const savedAt = saved?.when ?? '';
	const basedOn = change(BASED_ON_CHANGE);
	const basedOnId = idnoOf(basedOn, IDNO.basedOn);
	const text = (key: string) => String(record[key] ?? '');
	return {
		payload: {
			id: text('id'),
			project_id: text('projectId'),
			title: text('title'),
			verse_identifier: text('verseIdentifier'),
			status: text('status'),
			group_path: text('groupPath'),
			notes: text('notes'),
			sort_key: Number(record.sortKey ?? 0),
			document: document as SemanticCollationDocument & JsonObject,
			based_on_checkpoint: basedOnId
				? { id: basedOnId, content_hash: idnoOf(basedOn, IDNO.basedOnHash) ?? '' }
				: null,
			draft: { saved_at: savedAt, author_name: saved?.author ?? null },
			created_at: change('created')?.when ?? '',
			updated_at: change('updated')?.when ?? savedAt,
			...(record.conflictOf ? { conflict_of_collation_id: text('conflictOf') } : {}),
		},
		version: readVersionChange(changes),
	};
}

/** Reads the Version record from the header alone, without parsing the body. */
export function parseCollationTeiVersionHeader(xml: string): CollationTeiVersion | null {
	return readVersionChange(parseCollationTeiChanges(xml));
}

export function versionChange(version: CollationTeiVersion): CollationRevisionChange {
	return {
		type: VERSION_CHANGE,
		when: version.created_at,
		n: version.label,
		idnos: [
			[IDNO.version, version.id],
			[IDNO.parentVersion, version.parent_id],
		],
		author: version.author_name || null,
		note: version.note,
	};
}

export function isVersionChange(change: CollationRevisionChange): boolean {
	return change.type === VERSION_CHANGE;
}

function readVersionChange(changes: CollationRevisionChange[]): CollationTeiVersion | null {
	const change = changes.find(isVersionChange);
	if (!change) return null;
	return {
		id: idnoOf(change, IDNO.version) ?? '',
		label: change.n ?? '',
		note: change.note ?? null,
		author_name: change.author ?? '',
		created_at: change.when ?? '',
		parent_id: idnoOf(change, IDNO.parentVersion),
	};
}

function idnoOf(change: CollationRevisionChange | undefined, type: string): string | null {
	return change?.idnos?.find(([idnoType]) => idnoType === type)?.[1] ?? null;
}
