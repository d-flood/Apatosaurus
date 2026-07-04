import type { JsonObject } from '../envelope';
import { readObjectValue, readString } from './validation';

export type CanonicalCurrentRevision = JsonObject & {
	id: string;
	content_hash: string;
	created_at: string;
	author_name: string;
};

export type CanonicalDraftMetadata = JsonObject & {
	base_revision_id: string | null;
	base_content_hash: string | null;
	saved_at: string;
	author_name: string | null;
};

export function readCurrentRevision(
	record: Record<string, unknown>,
	key: string
): CanonicalCurrentRevision {
	const revision = readObjectValue(record[key], key);
	return {
		id: readString(revision, 'id'),
		content_hash: readString(revision, 'content_hash'),
		created_at: readString(revision, 'created_at'),
		author_name: readString(revision, 'author_name'),
	};
}

export function readDraftMetadata(record: Record<string, unknown>, key: string): CanonicalDraftMetadata {
	const draft = readObjectValue(record[key], key);
	return {
		base_revision_id:
			draft.base_revision_id === null ? null : readString(draft, 'base_revision_id'),
		base_content_hash:
			draft.base_content_hash === null ? null : readString(draft, 'base_content_hash'),
		saved_at: readString(draft, 'saved_at'),
		author_name: draft.author_name === null ? null : readString(draft, 'author_name'),
	};
}
