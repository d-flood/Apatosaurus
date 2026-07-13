import type { Kysely, Transaction } from 'kysely';

import type { StoreOperationOptions } from '$lib/client/store';

import type { Database } from '../types.generated';
import * as iiif from './iiif';
import { writeWorkingTranscriptionSnapshot } from './transcription-files';

type DbTransaction = Transaction<Database>;

async function mutateWithCanonicalFile<T>(
	db: Kysely<Database>,
	transcriptionId: string,
	mutation: (trx: DbTransaction) => Promise<T>,
	storeOptions: StoreOperationOptions = {}
): Promise<T> {
	return db.transaction().execute(async trx => {
		const result = await mutation(trx);
		await writeWorkingTranscriptionSnapshot(
			trx,
			transcriptionId,
			new Date().toISOString(),
			storeOptions
		);
		return result;
	});
}

export function ensureManifestSourceWithFiles(
	db: Kysely<Database>,
	input: iiif.EnsureManifestSourceInput,
	storeOptions?: StoreOperationOptions
) {
	return mutateWithCanonicalFile(
		db,
		input.transcriptionId,
		trx => iiif.ensureManifestSource(trx, input),
		storeOptions
	);
}

export function upsertPageCanvasLinkWithFiles(
	db: Kysely<Database>,
	input: Parameters<typeof iiif.upsertPageCanvasLink>[1],
	storeOptions?: StoreOperationOptions
) {
	return mutateWithCanonicalFile(
		db,
		input.transcriptionId,
		trx => iiif.upsertPageCanvasLink(trx, input),
		storeOptions
	);
}

export function savePageCanvasLinksWithFiles(
	db: Kysely<Database>,
	inputs: Parameters<typeof iiif.savePageCanvasLinks>[1],
	storeOptions?: StoreOperationOptions
) {
	if (inputs.length === 0) return Promise.resolve([]);
	return mutateWithCanonicalFile(
		db,
		inputs[0].transcriptionId,
		async trx => {
			const rows = [];
			for (const input of inputs) rows.push(await iiif.upsertPageCanvasLink(trx, input));
			return rows;
		},
		storeOptions
	);
}

export function deletePageCanvasLinkWithFiles(
	db: Kysely<Database>,
	input: iiif.DeletePageCanvasLinkInput,
	storeOptions?: StoreOperationOptions
) {
	return mutateWithCanonicalFile(
		db,
		input.transcriptionId,
		trx => iiif.deletePageCanvasLink(trx, input),
		storeOptions
	);
}

export function deletePageCanvasLinksForPageWithFiles(
	db: Kysely<Database>,
	input: { transcriptionId: string; pageId: string },
	storeOptions?: StoreOperationOptions
) {
	return mutateWithCanonicalFile(
		db,
		input.transcriptionId,
		trx => iiif.deletePageCanvasLinksForPage(trx, input),
		storeOptions
	);
}

export function deleteAllPageCanvasLinksWithFiles(
	db: Kysely<Database>,
	transcriptionId: string,
	storeOptions?: StoreOperationOptions
) {
	return mutateWithCanonicalFile(
		db,
		transcriptionId,
		trx => iiif.deleteAllPageCanvasLinks(trx, transcriptionId),
		storeOptions
	);
}

export function deleteManifestSourceWithFiles(
	db: Kysely<Database>,
	input: iiif.ManifestSourceIdInput,
	storeOptions?: StoreOperationOptions
) {
	return mutateWithCanonicalFile(
		db,
		input.transcriptionId,
		trx => iiif.deleteManifestSource(trx, input),
		storeOptions
	);
}

export function deleteManifestSourceLinksWithFiles(
	db: Kysely<Database>,
	input: iiif.ManifestSourceIdInput,
	storeOptions?: StoreOperationOptions
) {
	return mutateWithCanonicalFile(
		db,
		input.transcriptionId,
		trx => iiif.deleteManifestSourceLinks(trx, input),
		storeOptions
	);
}

export function upsertCanvasAnnotationWithFiles(
	db: Kysely<Database>,
	input: iiif.UpsertCanvasAnnotationInput,
	storeOptions?: StoreOperationOptions
) {
	return mutateWithCanonicalFile(
		db,
		input.transcriptionId,
		trx => iiif.upsertCanvasAnnotation(trx, input),
		storeOptions
	);
}

export function deleteCanvasAnnotationWithFiles(
	db: Kysely<Database>,
	input: iiif.CanvasAnnotationIdInput,
	storeOptions?: StoreOperationOptions
) {
	return mutateWithCanonicalFile(
		db,
		input.transcriptionId,
		trx => iiif.deleteCanvasAnnotation(trx, input),
		storeOptions
	);
}
