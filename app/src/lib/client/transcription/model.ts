import type { TranscriptionRecord as DbTranscriptionRecord } from '$lib/client/db/repositories/transcriptions';
import {
	coerceTranscriptionDocument,
	getReferenceEditionsUsed,
} from '$lib/client/transcription/content';

export type TranscriptionRecord = DbTranscriptionRecord & {
	referenceEditionsUsed?: string[];
};

export function mapLocalTranscriptionRecord(record: DbTranscriptionRecord): TranscriptionRecord {
	const document = coerceTranscriptionDocument(record.content_json);
	return {
		...record,
		referenceEditionsUsed: document ? getReferenceEditionsUsed(document) : [],
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
