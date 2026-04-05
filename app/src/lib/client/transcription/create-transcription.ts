import { nanoid } from 'nanoid';

import { ensureDjazzkitRuntime } from '$lib/client/djazzkit-runtime';
import {
	EMPTY_TRANSCRIPTION_DOC,
	TRANSCRIPTION_FORMAT,
	type StoredTranscriptionDocument,
	serializeTranscriptionDocument,
} from '$lib/client/transcription/content';
import { serializeTranscriptionTags } from '$lib/client/transcription/model';
import { rebuildVerseIndexForTranscriptions } from '$lib/client/transcription/verse-index';
import { Transcription } from '$generated/models/Transcription';
import { suppressNotifications, resumeNotifications } from '@djazzkit/core';

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
	const transcriptionId =
		typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? crypto.randomUUID()
			: nanoid();
	const now = new Date().toISOString();

	return {
		id: transcriptionId,
		data: {
			_djazzkit_id: transcriptionId,
			_djazzkit_rev: 0,
			_djazzkit_deleted: false,
			_djazzkit_updated_at: now,
			title: input.title.trim(),
			siglum: input.siglum.trim(),
			description: input.description?.trim() || '',
			content_json: serializeTranscriptionDocument(input.document || EMPTY_TRANSCRIPTION_DOC),
			format: TRANSCRIPTION_FORMAT,
			created_at: now,
			updated_at: now,
			owner: null,
			is_public: input.isPublic || false,
			tags: serializeTranscriptionTags(input.tags || []),
			transcriber: input.transcriber.trim(),
			repository: input.repository.trim(),
			settlement: input.settlement.trim(),
			language: input.language.trim(),
		},
	};
}

const DEFAULT_CHUNK_SIZE = 10;

export async function createTranscriptionRecords(
	inputs: CreateTranscriptionInput[],
	onChunkComplete?: (completedSoFar: number, total: number) => void,
	chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<string[]> {
	await ensureDjazzkitRuntime();

	const records = inputs.map(buildTranscriptionRecord);

	suppressNotifications();
	try {
		for (let i = 0; i < records.length; i += chunkSize) {
			const chunk = records.slice(i, i + chunkSize);
			await Transcription.objects.createMany(chunk.map(r => r.data));
			try {
				await rebuildVerseIndexForTranscriptions(chunk.map((record) => record.id));
			} catch (error) {
				console.error('[Verse Index] Failed to index created transcription chunk:', error);
			}
			onChunkComplete?.(Math.min(i + chunkSize, records.length), records.length);
		}
	} finally {
		await resumeNotifications();
	}

	return records.map(r => r.id);
}

export async function createTranscriptionRecord(input: CreateTranscriptionInput): Promise<string> {
	await ensureDjazzkitRuntime();

	const record = buildTranscriptionRecord(input);
	await Transcription.objects.create(record.data);
	try {
		await rebuildVerseIndexForTranscriptions([record.id]);
	} catch (error) {
		console.error('[Verse Index] Failed to index created transcription:', error);
	}
	return record.id;
}
