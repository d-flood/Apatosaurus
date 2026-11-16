import type { JsonValue } from '$lib/storage/envelope';
import { PROJECT_TRANSCRIPTION_FIXTURE } from '$lib/storage/formats/payload-fixtures';
import { serializeTranscriptionTei } from '$lib/storage/formats/transcription-tei';
import type { StoredTranscriptionDocument } from '$lib/transcription/content';

export async function exportTranscriptionTeiWithFixtureRecord(
	_id: string,
	document: StoredTranscriptionDocument
): Promise<string> {
	const record = {
		...PROJECT_TRANSCRIPTION_FIXTURE,
		content_json: document as unknown as JsonValue,
	};
	return (await serializeTranscriptionTei(record)).xml;
}
