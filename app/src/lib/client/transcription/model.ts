import type { TranscriptionData } from '$generated/models/Transcription';

export type TranscriptionRecord = TranscriptionData;

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
