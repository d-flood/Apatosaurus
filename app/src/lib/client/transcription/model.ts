import type { TranscriptionRecord as DbTranscriptionRecord } from '$lib/client/db/repositories/transcriptions';

export type TranscriptionRecord = DbTranscriptionRecord;

export function mapLocalTranscriptionRecord(record: DbTranscriptionRecord): TranscriptionRecord {
	return record;
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
