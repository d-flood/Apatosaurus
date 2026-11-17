import type { TranscriptionRecord as DbTranscriptionRecord } from '$lib/db/repositories/transcriptions';
import {
	coerceTranscriptionDocument,
	getReferenceEditionsUsed,
	type StoredTranscriptionDocument,
} from '$lib/transcription/content';

export type TranscriptionRecord = DbTranscriptionRecord & {
	referenceEditionsUsed?: string[];
};

export function parseLocalTranscriptionRecord(record: DbTranscriptionRecord): {
	transcription: TranscriptionRecord;
	document: StoredTranscriptionDocument | null;
} {
	const document = coerceTranscriptionDocument(record.content_json);
	return {
		transcription: {
			...record,
			referenceEditionsUsed: document ? getReferenceEditionsUsed(document) : [],
		},
		document,
	};
}

export function mapLocalTranscriptionRecord(record: DbTranscriptionRecord): TranscriptionRecord {
	return parseLocalTranscriptionRecord(record).transcription;
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
