import { coerceTranscriptionDocument } from '$lib/client/transcription/content';
import { resolveReferenceEditionAttributions } from '$lib/reference-editions/attribution';
import {
	listReferenceEditions,
	type ReferenceEditionCatalogEntry,
} from '$lib/reference-editions/catalog';
import { exportTEIDocument } from '$lib/tei/tei-exporter';

import { listUserReferenceEditions } from '../user-reference-editions';
import type { StoreOperationOptions } from '../opfs-store';

import type { ProjectTranscriptionPayload } from './project-transcription';

export function transcriptionDocumentToTei(
	document: ProjectTranscriptionPayload,
	referenceEditions: ReferenceEditionCatalogEntry[] = listReferenceEditions()
): string {
	const transcription = coerceTranscriptionDocument(document.content_json);
	if (!transcription) {
		throw new Error(
			`Project transcription ${document.project_transcription_id} has invalid content.`
		);
	}
	const sourceAttributions = resolveReferenceEditionAttributions(
		transcription.referenceEditionsUsed || [],
		referenceEditions,
		transcription.referenceEditionAttributions
	);
	return exportTEIDocument(transcription, {
		title: document.title,
		transcriber: document.transcriber,
		repository: document.repository,
		settlement: document.settlement,
		idno: document.siglum,
		language: document.language,
		...(sourceAttributions.length > 0 ? { sourceAttributions } : {}),
	});
}

export async function transcriptionDocumentToTeiFromStore(
	document: ProjectTranscriptionPayload,
	storeOptions: StoreOperationOptions = {}
): Promise<string> {
	const referenceEditions = listReferenceEditions(await listUserReferenceEditions(storeOptions));
	return transcriptionDocumentToTei(document, referenceEditions);
}
