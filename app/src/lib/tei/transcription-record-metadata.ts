import type {
	TeiHeaderInfo,
	TeiMetadata as TEIMetadata,
	TranscriptionDocument,
} from '@apatopwa/tei-transcription';

import type { TranscriptionRecord } from '$lib/client/transcription/model';

type MetadataPatchKeys =
	| 'title'
	| 'transcriber'
	| 'repository'
	| 'settlement'
	| 'siglum'
	| 'language';

export type TranscriptionRecordMetadataPatch = Partial<Pick<TranscriptionRecord, MetadataPatchKeys>>;

export function buildTEIMetadataFromTranscription(record: TranscriptionRecord): TEIMetadata {
	const createdDate = new Date(record.created_at || new Date().toISOString())
		.toISOString()
		.split('T')[0];

	return {
		title: record.title || 'Untitled Transcription',
		transcriber: record.transcriber || record.owner || 'Unknown',
		date: createdDate,
		repository: record.repository || 'Unknown Repository',
		settlement: record.settlement || 'Unknown',
		idno: record.siglum || 'Unknown Manuscript',
		language: record.language || 'grc',
	};
}

export function extractTranscriptionRecordMetadataPatch(
	document: Pick<TranscriptionDocument, 'metadata' | 'header'>
): TranscriptionRecordMetadataPatch {
	const metadata = document.metadata;
	const header = document.header;
	const title =
		firstNonEmpty(
			metadata?.title,
			findPreferredTitle(header),
		) || undefined;
	const transcriber =
		firstNonEmpty(
			metadata?.transcriber,
			findPreferredResponsibilityName(header),
		) || undefined;
	const repository =
		firstNonEmpty(metadata?.repository, header?.msIdentifier?.repository) || undefined;
	const settlement =
		firstNonEmpty(metadata?.settlement, header?.msIdentifier?.settlement) || undefined;
	const siglum = firstNonEmpty(metadata?.idno, header?.msIdentifier?.idno) || undefined;
	const language = firstNonEmpty(metadata?.language, header?.language) || undefined;

	return compactPatch({
		title,
		transcriber,
		repository,
		settlement,
		siglum,
		language,
	});
}

function findPreferredTitle(header: TeiHeaderInfo | undefined): string | undefined {
	if (!header?.titles?.length) return undefined;
	return (
		header.titles.find(title => title.type === 'document')?.text ||
		header.titles.find(title => title.type === 'short')?.text ||
		header.titles[0]?.text
	);
}

function findPreferredResponsibilityName(header: TeiHeaderInfo | undefined): string | undefined {
	if (!header?.responsibilities?.length) return undefined;
	return (
		header.responsibilities.find(resp => /transcrib/i.test(resp.resp))?.name ||
		header.responsibilities.find(resp => /created by/i.test(resp.resp))?.name ||
		header.responsibilities[0]?.name
	);
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | undefined {
	for (const value of values) {
		const trimmed = value?.trim();
		if (trimmed) return trimmed;
	}
	return undefined;
}

function compactPatch<T extends Record<string, string | undefined>>(patch: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(patch).filter(([, value]) => typeof value === 'string' && value.length > 0)
	) as Partial<T>;
}
