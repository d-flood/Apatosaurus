import {
	TRANSCRIPTION_FORMAT,
	serializeTranscriptionDocument,
	type StoredTranscriptionDocument,
} from '$lib/client/transcription/content';

export const HARNESS_TRANSCRIPTION_ID = '11111111-1111-4111-8111-111111111111';
export const HARNESS_TRANSCRIPTION_TITLE = 'Transcription Editor Harness';

export const HARNESS_TRANSCRIPTION_DOCUMENT: StoredTranscriptionDocument = {
	type: 'transcriptionDocument',
	pages: [
		{
			type: 'page',
			id: 'Harness Page 1',
			pageId: 'harness-page-1',
			columns: [
				{
					type: 'column',
					number: 1,
					zone: 'top',
					lines: [
						{
							type: 'line',
							number: 1,
							items: [{ type: 'text', text: 'page one top' }],
						},
					],
				},
				{
					type: 'column',
					number: 2,
					zone: 'left',
					lines: [
						{
							type: 'line',
							number: 1,
							items: [{ type: 'text', text: 'page one left' }],
						},
					],
				},
				{
					type: 'column',
					number: 3,
					zone: 'center',
					lines: [
						{
							type: 'line',
							number: 1,
							items: [{ type: 'text', text: 'page one center' }],
						},
					],
				},
				{
					type: 'column',
					number: 4,
					zone: 'right',
					lines: [
						{
							type: 'line',
							number: 1,
							items: [{ type: 'text', text: 'page one right' }],
						},
					],
				},
				{
					type: 'column',
					number: 5,
					zone: 'bottom',
					lines: [
						{
							type: 'line',
							number: 1,
							items: [{ type: 'text', text: 'page one bottom' }],
						},
					],
				},
			],
		},
		{
			type: 'page',
			id: 'Harness Page 2',
			pageId: 'harness-page-2',
			columns: [
				{
					type: 'column',
					number: 1,
					zone: 'top',
					lines: [
						{
							type: 'line',
							number: 1,
							items: [{ type: 'text', text: 'page two top' }],
						},
					],
				},
				{
					type: 'column',
					number: 2,
					zone: 'left',
					lines: [
						{
							type: 'line',
							number: 1,
							items: [{ type: 'text', text: 'page two left' }],
						},
					],
				},
				{
					type: 'column',
					number: 3,
					zone: 'center',
					lines: [
						{
							type: 'line',
							number: 1,
							items: [{ type: 'text', text: 'page two center' }],
						},
					],
				},
				{
					type: 'column',
					number: 4,
					zone: 'right',
					lines: [
						{
							type: 'line',
							number: 1,
							items: [{ type: 'text', text: 'page two right' }],
						},
					],
				},
				{
					type: 'column',
					number: 5,
					zone: 'bottom',
					lines: [
						{
							type: 'line',
							number: 1,
							items: [{ type: 'text', text: 'page two bottom' }],
						},
					],
				},
			],
		},
	],
};

export function buildHarnessTranscriptionCreatePayload(now: string) {
	return {
		_djazzkit_id: HARNESS_TRANSCRIPTION_ID,
		_djazzkit_rev: 0,
		_djazzkit_deleted: false,
		_djazzkit_updated_at: now,
		title: HARNESS_TRANSCRIPTION_TITLE,
		siglum: 'HARNESS',
		description: 'Deterministic browser harness for transcription editor focus regressions.',
		content_json: serializeTranscriptionDocument(HARNESS_TRANSCRIPTION_DOCUMENT),
		format: TRANSCRIPTION_FORMAT,
		created_at: now,
		updated_at: now,
		owner: null,
		is_public: false,
		tags: '[]',
		transcriber: 'OpenCode',
		repository: 'Harness Repository',
		settlement: 'Harness Settlement',
		language: 'Greek',
	};
}

export function buildHarnessTranscriptionUpdatePayload(now: string, createdAt: string) {
	return {
		title: HARNESS_TRANSCRIPTION_TITLE,
		siglum: 'HARNESS',
		description: 'Deterministic browser harness for transcription editor focus regressions.',
		content_json: serializeTranscriptionDocument(HARNESS_TRANSCRIPTION_DOCUMENT),
		format: TRANSCRIPTION_FORMAT,
		created_at: createdAt,
		updated_at: now,
		_djazzkit_updated_at: now,
		owner: null,
		is_public: false,
		tags: '[]',
		transcriber: 'OpenCode',
		repository: 'Harness Repository',
		settlement: 'Harness Settlement',
		language: 'Greek',
	};
}
