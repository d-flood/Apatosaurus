import {
	EMPTY_TRANSCRIPTION_DOC,
	TRANSCRIPTION_FORMAT,
	type StoredTranscriptionDocument,
	serializeTranscriptionDocument,
} from '$lib/client/transcription/content';
import { createTranscription, createTranscriptions } from '$lib/client/db/client';

export interface CreateTranscriptionInput {
	title: string;
	siglum: string;
	description?: string;
	document?: StoredTranscriptionDocument | null;
	isPublic?: boolean;
	tags?: string[];
	transcriber: string;
	repository: string;
	settlement: string;
	language: string;
}

type RequiredTranscriptionField =
	| 'title'
	| 'siglum'
	| 'transcriber'
	| 'repository'
	| 'settlement'
	| 'language';

const REQUIRED_FIELDS: RequiredTranscriptionField[] = [
	'title',
	'siglum',
	'transcriber',
	'repository',
	'settlement',
	'language',
];

export function listMissingRequiredTranscriptionFields(
	input: Pick<CreateTranscriptionInput, RequiredTranscriptionField>
): RequiredTranscriptionField[] {
	return REQUIRED_FIELDS.filter(field => !input[field]?.trim());
}

export function formatTranscriptionFieldList(fields: string[]): string {
	return fields.join(', ');
}

function buildTranscriptionRecord(input: CreateTranscriptionInput) {
	const now = new Date().toISOString();

	return {
		title: input.title.trim(),
		siglum: input.siglum.trim(),
		description: input.description?.trim() || '',
		contentJson: serializeTranscriptionDocument(input.document || EMPTY_TRANSCRIPTION_DOC),
		format: TRANSCRIPTION_FORMAT,
		createdAt: now,
		updatedAt: now,
		owner: null,
		isPublic: input.isPublic || false,
		tags: input.tags || [],
		transcriber: input.transcriber.trim(),
		repository: input.repository.trim(),
		settlement: input.settlement.trim(),
		language: input.language.trim(),
	};
}

const DEFAULT_CHUNK_SIZE = 10;

export async function createTranscriptionRecords(
	inputs: CreateTranscriptionInput[],
	onChunkComplete?: (completedSoFar: number, total: number) => void,
	chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<string[]> {
	const records = inputs.map(buildTranscriptionRecord);
	const ids: string[] = [];

	for (let i = 0; i < records.length; i += chunkSize) {
		const chunk = records.slice(i, i + chunkSize);
		ids.push(...(await createTranscriptions(chunk)));
		onChunkComplete?.(Math.min(i + chunkSize, records.length), records.length);
	}

	return ids;
}

export async function createTranscriptionRecord(input: CreateTranscriptionInput): Promise<string> {
	const record = buildTranscriptionRecord(input);
	return createTranscription(record);
}
