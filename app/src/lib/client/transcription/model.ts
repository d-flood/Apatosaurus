import type { TranscriptionRecord as DbTranscriptionRecord } from '$lib/client/db/repositories/transcriptions';

export type TranscriptionRecord = DbTranscriptionRecord & {
	_djazzkit_id: string;
	_djazzkit_deleted: boolean;
	_djazzkit_updated_at: string | null;
};

export function mapLocalTranscriptionRecord(record: DbTranscriptionRecord): TranscriptionRecord {
	return {
		...record,
		_djazzkit_id: record.id,
		_djazzkit_deleted: false,
		_djazzkit_updated_at: record.updated_at,
	};
}

export function parseTranscriptionTags(tags: unknown): string[] {
	if (Array.isArray(tags)) {
		return tags.filter((tag): tag is string => typeof tag === 'string');
	}
	if (typeof tags !== 'string') return [];
	try {
		const parsed = JSON.parse(tags);
		if (Array.isArray(parsed)) {
			return parsed.filter((tag): tag is string => typeof tag === 'string');
		}
	} catch {
		return [];
	}
	return [];
}

export function serializeTranscriptionTags(tags: string[]): string {
	return JSON.stringify(tags);
}
