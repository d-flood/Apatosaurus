import {
	assertEnvelopeHash,
	openEnvelope,
	sealDocument,
	serializeSealedDocument,
} from './envelope';
import { appSettingsFile } from './layout';
import { readTextFile, writeTextFileAtomic, type StoreOperationOptions } from './opfs-store';
import { invalidShape, quarantineFromError } from './quarantine';

const APP_SETTINGS_FORMAT = 'apatosaurus.app-settings';

export interface AppSettings {
	authorName: string | null;
}

export async function readAppSettings(options: StoreOperationOptions = {}): Promise<AppSettings> {
	let raw: string;
	try {
		raw = await readTextFile(appSettingsFile(), options);
	} catch (error) {
		if (isMissingFileError(error)) return { authorName: null };
		throw error;
	}
	try {
		const opened = openEnvelope(raw);
		if (opened.header.format !== APP_SETTINGS_FORMAT || opened.header.schema_version !== 1) {
			throw invalidShape(`${appSettingsFile()} is not ${APP_SETTINGS_FORMAT} version 1.`);
		}
		await assertEnvelopeHash(opened, APP_SETTINGS_FORMAT);
		const authorName = opened.payload.author_name;
		if (authorName !== null && typeof authorName !== 'string') {
			throw invalidShape('author_name must be a string or null.');
		}
		return { authorName };
	} catch (error) {
		throw new Error(
			`Could not read ${appSettingsFile()}: ${quarantineFromError(error).message}`,
			{
				cause: error,
			}
		);
	}
}

export async function saveAppSettings(
	settings: AppSettings,
	options: StoreOperationOptions = {}
): Promise<void> {
	const document = await sealDocument(APP_SETTINGS_FORMAT, 1, {
		author_name: settings.authorName?.trim() || null,
	});
	await writeTextFileAtomic(appSettingsFile(), serializeSealedDocument(document), options);
}

function isMissingFileError(error: unknown): boolean {
	if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
		return error.name === 'NotFoundError';
	}
	return error instanceof Error && /not found/i.test(error.message);
}
