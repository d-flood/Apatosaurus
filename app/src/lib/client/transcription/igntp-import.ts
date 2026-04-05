import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import { buildTranscriptionDuplicateKey } from '$lib/igntp/duplicate-key';
import type { IgntpCatalogEntry } from '$lib/igntp/types';
import { importTEIDocument } from '$lib/tei/tei-importer';
import { extractTranscriptionRecordMetadataPatch } from '$lib/tei/transcription-record-metadata';

interface PreparedIgntpImportMetadata {
	title: string;
	siglum: string;
	transcriber: string;
	repository: string;
	settlement: string;
	language: string;
}

export interface PreparedIgntpImport {
	document: StoredTranscriptionDocument;
	duplicateKey: string;
	metadata: PreparedIgntpImportMetadata;
}

interface FetchAndPrepareIgntpImportOptions {
	signal?: AbortSignal;
}

export async function fetchAndPrepareIgntpImport(
	entry: IgntpCatalogEntry,
	options: FetchAndPrepareIgntpImportOptions = {}
): Promise<PreparedIgntpImport> {
	const response = await fetch(`/igntp/${entry.path}`, { signal: options.signal });
	if (!response.ok) {
		throw new Error(`Failed to fetch ${entry.fileName} (${response.status})`);
	}

	const xml = await response.text();
	const document = importTEIDocument(xml);
	const patch = extractTranscriptionRecordMetadataPatch(document);
	const title = firstNonEmpty(patch.title, entry.title) || '';
	const siglum = firstNonEmpty(patch.siglum, entry.siglum) || '';
	const duplicateKey = buildTranscriptionDuplicateKey({ siglum, title }) || entry.duplicateKey;

	return {
		document,
		duplicateKey,
		metadata: {
			title,
			siglum,
			transcriber: patch.transcriber?.trim() || '',
			repository: patch.repository?.trim() || '',
			settlement: patch.settlement?.trim() || '',
			language: patch.language?.trim() || '',
		},
	};
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | undefined {
	for (const value of values) {
		const trimmed = value?.trim();
		if (trimmed) return trimmed;
	}
	return undefined;
}
