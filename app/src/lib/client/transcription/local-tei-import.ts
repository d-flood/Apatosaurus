import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import { buildTranscriptionDuplicateKey } from '$lib/igntp/duplicate-key';
import { importTEIDocument } from '$lib/tei/tei-importer';
import { extractTranscriptionRecordMetadataPatch } from '$lib/tei/transcription-record-metadata';

export interface LocalTeiImportDefaults {
	transcriber: string;
	repository: string;
	settlement: string;
	language: string;
}

export interface PreparedLocalTeiImport {
	document: StoredTranscriptionDocument;
	duplicateKey: string | null;
	metadata: LocalTeiImportDefaults & { title: string; siglum: string };
}

export function selectTeiFiles(files: Iterable<File>): File[] {
	return [...files]
		.filter(file => /\.xml$/i.test(file.name))
		.sort((a, b) => filePath(a).localeCompare(filePath(b)));
}

export function filePath(file: File): string {
	return file.webkitRelativePath || file.name;
}

export function prepareLocalTeiImport(
	fileName: string,
	xml: string,
	defaults: LocalTeiImportDefaults
): PreparedLocalTeiImport {
	const document = importTEIDocument(xml);
	const patch = extractTranscriptionRecordMetadataPatch(document);
	const stem = fileName.replace(/\.xml$/i, '');
	const title = patch.title?.trim() || stem;
	const siglum = patch.siglum?.trim() || stem;

	return {
		document,
		duplicateKey: buildTranscriptionDuplicateKey({ siglum, title }),
		metadata: {
			title,
			siglum,
			transcriber: patch.transcriber?.trim() || defaults.transcriber.trim(),
			repository: patch.repository?.trim() || defaults.repository.trim(),
			settlement: patch.settlement?.trim() || defaults.settlement.trim(),
			language: patch.language?.trim() || defaults.language.trim(),
		},
	};
}
