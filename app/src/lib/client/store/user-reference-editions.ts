import { parseReferenceEditionWithMetadataInWorker } from '$lib/client/reference-editions/reference-edition-worker';
import type { ParsedReferenceEditionResult } from '$lib/client/reference-editions/reference-edition-worker-types';
import type { ReferenceEditionCatalogEntry } from '$lib/reference-editions/catalog';
import { parseReferenceEditionXml } from '$lib/reference-editions/parse';

import {
	assertEnvelopeHash,
	openEnvelope,
	sealDocument,
	serializeSealedDocument,
	type JsonObject,
} from './envelope';
import {
	userReferenceEditionFile,
	userReferenceEditionQuarantineFile,
	userReferenceEditionsFolder,
} from './layout';
import {
	deleteFile,
	listDirectory,
	moveFile,
	readTextFile,
	withDocumentStoreWriterLock,
	writeTextFileAtomic,
	type StoreOperationOptions,
} from './opfs-store';
import { quarantineFromError, recordStoreQuarantine } from './quarantine';

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
	return (await inspectUserReferenceEditions(options)).editions;
}

export interface UserReferenceEditionInspection {
	editions: ReferenceEditionCatalogEntry[];
	invalidPaths: string[];
}

export async function inspectUserReferenceEditions(
	options: StoreOperationOptions = {}
): Promise<UserReferenceEditionInspection> {
	let files;
	try {
		files = (await listDirectory(userReferenceEditionsFolder(), options)).filter(
			entry => entry.kind === 'file' && entry.name.endsWith('.json')
		);
	} catch (error) {
		if (isMissingEntryError(error)) return { editions: [], invalidPaths: [] };
		throw error;
	}

	const records = await Promise.all(
		files.map(async file => {
			try {
				return {
					file,
					record: await validateStoredUserReferenceEdition(
						await readTextFile(file.path, options),
						file.name.slice(0, -'.json'.length)
					),
				};
			} catch (error) {
				recordStoreQuarantine(
					options.quarantineSink,
					file.path,
					quarantineFromError(error)
				);
				return { file, record: null };
			}
		})
	);
	return {
		editions: records
			.flatMap(result => (result.record ? [toCatalogEntry(result.record)] : []))
			.sort((left, right) => left.title.localeCompare(right.title)),
		invalidPaths: records.flatMap(result => (result.record ? [] : [result.file.path])),
	};
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
	const sealed = await sealDocument(
		USER_REFERENCE_EDITION_FORMAT,
		USER_REFERENCE_EDITION_VERSION,
		{
			edition_id: record.id,
			title: record.title,
			attribution: record.attribution,
			xml: record.xml,
		} satisfies UserReferenceEditionPayload
	);
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

export async function restoreUserReferenceEditions(
	raws: string[],
	options: StoreOperationOptions = {}
): Promise<{ restored: number; skipped: number }> {
	const records = await Promise.all(raws.map(raw => validateStoredUserReferenceEdition(raw)));
	return withDocumentStoreWriterLock(async lockedOptions => {
		const changes: Array<{
			path: string;
			quarantinePath?: string;
			quarantineError?: unknown;
		}> = [];
		let skipped = 0;
		try {
			for (const [index, record] of records.entries()) {
				const path = userReferenceEditionFile(record.id);
				let quarantineError: unknown;
				try {
					const localRaw = await readTextFile(path, lockedOptions);
					try {
						await validateStoredUserReferenceEdition(localRaw, record.id);
						skipped += 1;
						continue;
					} catch (error) {
						quarantineError = error;
					}
				} catch (error) {
					if (!isMissingEntryError(error)) throw error;
				}

				const change: (typeof changes)[number] = { path };
				if (quarantineError !== undefined) {
					change.quarantinePath = userReferenceEditionQuarantineFile(
						record.id,
						(options.nonce ?? createNonce)()
					);
					change.quarantineError = quarantineError;
					await moveFile(path, change.quarantinePath, lockedOptions);
				}
				changes.push(change);
				await writeTextFileAtomic(path, raws[index]!, lockedOptions);
			}
		} catch (error) {
			for (const change of changes.reverse()) {
				try {
					await deleteFile(change.path, lockedOptions);
				} catch (deleteError) {
					if (!isMissingEntryError(deleteError)) throw deleteError;
				}
				if (change.quarantinePath) {
					await moveFile(change.quarantinePath, change.path, lockedOptions);
				}
			}
			throw error;
		}

		for (const change of changes) {
			if (change.quarantineError !== undefined) {
				recordStoreQuarantine(
					lockedOptions.quarantineSink,
					change.path,
					quarantineFromError(change.quarantineError)
				);
			}
		}
		return { restored: changes.length, skipped };
	}, options);
}

export async function validateStoredUserReferenceEdition(
	raw: string,
	expectedId?: string
): Promise<StoredUserReferenceEdition> {
	const record = await readStoredEdition(raw);
	const canonicalId = `user-${await hashText(record.xml)}`;
	if (record.id !== canonicalId || (expectedId !== undefined && record.id !== expectedId)) {
		throw new Error('Stored reference edition has an invalid identity.');
	}
	const parsed = parseReferenceEditionXml(record.xml);
	if (parsed.source.units.length === 0) {
		throw new Error('Reference edition must contain at least one milestone.');
	}
	return record;
}

function createNonce(): string {
	return (
		globalThis.crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
	);
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
	const digest = await globalThis.crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(value)
	);
	return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
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
