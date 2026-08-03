import { parseReferenceEditionWithMetadataInWorker } from '$lib/client/reference-editions/reference-edition-worker';
import type { ParsedReferenceEditionResult } from '$lib/client/reference-editions/reference-edition-worker-types';
import type { ReferenceEditionCatalogEntry } from '$lib/reference-editions/catalog';

import {
	assertEnvelopeHash,
	openEnvelope,
	sealDocument,
	serializeSealedDocument,
	type JsonObject,
} from './envelope';
import {
	userReferenceEditionFile,
	userReferenceEditionsFolder,
} from './layout';
import {
	deleteFile,
	listDirectory,
	readTextFile,
	writeTextFileAtomic,
	type StoreOperationOptions,
} from './opfs-store';

interface StoredUserReferenceEdition {
	id: string;
	title: string;
	attribution: string;
	xml: string;
}

interface UserReferenceEditionPayload extends JsonObject {
	edition_id: string;
	title: string;
	attribution: string;
	xml: string;
}

const USER_REFERENCE_EDITION_FORMAT = 'apatosaurus.user-reference-edition';
const USER_REFERENCE_EDITION_VERSION = 1;

export interface RegisterUserReferenceEditionInput {
	xml: string;
	fileName: string;
	title?: string;
	attribution?: string;
}

type ParseReferenceEdition = (input: { xml: string }) => Promise<ParsedReferenceEditionResult>;
type UserReferenceEditionOptions = StoreOperationOptions & { parse?: ParseReferenceEdition };

export async function listUserReferenceEditions(
	options: StoreOperationOptions = {}
): Promise<ReferenceEditionCatalogEntry[]> {
	let files;
	try {
		files = (await listDirectory(userReferenceEditionsFolder(), options)).filter(
			entry => entry.kind === 'file' && entry.name.endsWith('.json')
		);
	} catch (error) {
		if (isMissingEntryError(error)) return [];
		throw error;
	}

	const records = await Promise.all(
		files.map(async file => readStoredEdition(await readTextFile(file.path, options)))
	);
	return records
		.map(record => toCatalogEntry(record))
		.sort((left, right) => left.title.localeCompare(right.title));
}

export async function registerUserReferenceEdition(
	input: RegisterUserReferenceEditionInput,
	options: UserReferenceEditionOptions = {}
): Promise<ReferenceEditionCatalogEntry> {
	const xml = input.xml;
	const parsed = await (options.parse ?? parseReferenceEditionWithMetadataInWorker)({ xml });
	const attribution = (parsed.metadata.attribution || input.attribution || '').trim();
	if (!attribution) throw new Error('Attribution is required for this reference edition.');

	const id = `user-${await hashText(xml)}`;
	const path = userReferenceEditionFile(id);
	try {
		await readTextFile(path, options);
		throw new Error('This reference edition is already on this device.');
	} catch (error) {
		if (!isMissingEntryError(error)) throw error;
	}

	const title = (parsed.metadata.title || input.title || fileStem(input.fileName)).trim();
	const record: StoredUserReferenceEdition = {
		id,
		title: title || 'Untitled reference edition',
		attribution,
		xml,
	};
	const sealed = await sealDocument(USER_REFERENCE_EDITION_FORMAT, USER_REFERENCE_EDITION_VERSION, {
		edition_id: record.id,
		title: record.title,
		attribution: record.attribution,
		xml: record.xml,
	} satisfies UserReferenceEditionPayload);
	await writeTextFileAtomic(path, serializeSealedDocument(sealed), options);
	return toCatalogEntry(record);
}

export async function loadUserReferenceEditionXml(
	entry: ReferenceEditionCatalogEntry,
	options: StoreOperationOptions = {}
): Promise<string> {
	if (entry.source !== 'user' || !entry.storePath) {
		throw new Error('Reference edition is not a stored user edition.');
	}
	return (await readStoredEdition(await readTextFile(entry.storePath, options))).xml;
}

export async function removeUserReferenceEdition(
	entry: ReferenceEditionCatalogEntry,
	options: StoreOperationOptions = {}
): Promise<void> {
	if (entry.source !== 'user' || !entry.storePath) return;
	await deleteFile(entry.storePath, options);
}

function toCatalogEntry(record: StoredUserReferenceEdition): ReferenceEditionCatalogEntry {
	return {
		id: record.id,
		title: record.title,
		attribution: record.attribution,
		source: 'user',
		storePath: userReferenceEditionFile(record.id),
	};
}

async function readStoredEdition(raw: string): Promise<StoredUserReferenceEdition> {
	const opened = openEnvelope(raw);
	if (
		opened.header.format !== USER_REFERENCE_EDITION_FORMAT ||
		opened.header.schema_version !== USER_REFERENCE_EDITION_VERSION
	) {
		throw new Error('Stored reference edition is invalid.');
	}
	await assertEnvelopeHash(opened, USER_REFERENCE_EDITION_FORMAT);
	const payload = opened.payload as Partial<UserReferenceEditionPayload>;
	if (
		typeof payload.edition_id !== 'string' ||
		!payload.edition_id ||
		typeof payload.title !== 'string' ||
		!payload.title ||
		typeof payload.attribution !== 'string' ||
		!payload.attribution ||
		typeof payload.xml !== 'string'
	) {
		throw new Error('Stored reference edition is invalid.');
	}
	return {
		id: payload.edition_id,
		title: payload.title,
		attribution: payload.attribution,
		xml: payload.xml,
	};
}

async function hashText(value: string): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return [...new Uint8Array(digest)]
		.map(byte => byte.toString(16).padStart(2, '0'))
		.join('');
}

function fileStem(fileName: string): string {
	return fileName.replace(/\.[^.]+$/, '').trim();
}

function isMissingEntryError(error: unknown): boolean {
	if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
		return error.name === 'NotFoundError';
	}
	return error instanceof Error && /not found/i.test(error.message);
}
