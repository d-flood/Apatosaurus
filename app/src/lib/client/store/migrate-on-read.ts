import {
	assertEnvelopeHash,
	openEnvelope,
	sealDocument,
	type JsonObject,
	type SealedDocument,
} from './envelope';
import {
	invalidSchemaVersion,
	invalidShape,
	quarantineFromError,
	type StoreQuarantineReason,
} from './quarantine';

export type DocumentUpgrader = (payload: JsonObject) => JsonObject | Promise<JsonObject>;
export type DocumentValidator<TPayload extends JsonObject> = (payload: JsonObject) => TPayload;
export type DocumentIntegrityValidator<TPayload extends JsonObject> = (
	payload: TPayload,
	originalVersion: number
) => void | Promise<void>;

export interface FormatRegistration<TPayload extends JsonObject = JsonObject> {
	format: string;
	currentVersion: number;
	upgraders: DocumentUpgrader[];
	validate: DocumentValidator<TPayload>;
	validateIntegrity?: DocumentIntegrityValidator<TPayload>;
}

export type ReadDocumentResult<TPayload extends JsonObject = JsonObject> =
	| {
			ok: true;
			document: SealedDocument<TPayload>;
			payload: TPayload;
			upgraded: boolean;
			originalVersion: number;
		}
	| { ok: false; quarantine: StoreQuarantineReason };

export class MigrationRegistry {
	private readonly formats = new Map<string, FormatRegistration>();

	registerFormat<TPayload extends JsonObject>(
		format: string,
		currentVersion: number,
		upgraders: DocumentUpgrader[],
		validate: DocumentValidator<TPayload>,
		validateIntegrity?: DocumentIntegrityValidator<TPayload>
	): void {
		if (!format.trim()) throw new Error('format is required.');
		if (!Number.isInteger(currentVersion) || currentVersion < 1) {
			throw new Error('currentVersion must be a positive integer.');
		}
		if (upgraders.length !== currentVersion - 1) {
			throw new Error(
				`Format ${format} expected ${currentVersion - 1} upgrader(s), received ${upgraders.length}.`
			);
		}
		if (this.formats.has(format)) throw new Error(`Format ${format} is already registered.`);
		this.formats.set(format, {
			format,
			currentVersion,
			upgraders,
			validate,
			validateIntegrity: validateIntegrity as DocumentIntegrityValidator<JsonObject> | undefined,
		});
	}

	async readDocument<TPayload extends JsonObject = JsonObject>(
		format: string,
		raw: string | unknown
	): Promise<ReadDocumentResult<TPayload>> {
		try {
			const registration = this.formats.get(format);
			if (!registration) throw invalidShape(`Format ${format} is not registered.`);

			const opened = openEnvelope(raw);
			if (opened.header.format !== format) {
				throw invalidShape(
					`Document format ${opened.header.format} does not match expected format ${format}.`,
					format,
					opened.header.format
				);
			}
			const originalVersion = opened.header.schema_version;
			if (originalVersion > registration.currentVersion) {
				throw invalidSchemaVersion(
					`Unsupported ${format} schema_version ${originalVersion}.`,
					registration.currentVersion,
					originalVersion
				);
			}
			await assertEnvelopeHash(opened, format);

			let payload = opened.payload;
			for (let version = originalVersion; version < registration.currentVersion; version += 1) {
				const upgrader = registration.upgraders[version - 1];
				if (!upgrader) {
					throw invalidSchemaVersion(
						`No upgrader registered for ${format} schema_version ${version}.`,
						registration.currentVersion,
						version
					);
				}
				payload = assertPayloadObject(await upgrader(payload), `${format} v${version + 1}`);
			}

			const validatedPayload = registration.validate(payload) as TPayload;
			await registration.validateIntegrity?.(validatedPayload, originalVersion);
			const document = await sealDocument(format, registration.currentVersion, validatedPayload);
			return {
				ok: true,
				document,
				payload: validatedPayload,
				upgraded: originalVersion !== registration.currentVersion,
				originalVersion,
			};
		} catch (error) {
			return { ok: false, quarantine: quarantineFromError(error) };
		}
	}

	clear(): void {
		this.formats.clear();
	}
}

const defaultRegistry = new MigrationRegistry();

export function createMigrationRegistry(): MigrationRegistry {
	return new MigrationRegistry();
}

export function registerFormat<TPayload extends JsonObject>(
	format: string,
	currentVersion: number,
	upgraders: DocumentUpgrader[],
	validate: DocumentValidator<TPayload>,
	validateIntegrity?: DocumentIntegrityValidator<TPayload>
): void {
	defaultRegistry.registerFormat(format, currentVersion, upgraders, validate, validateIntegrity);
}

export function readDocument<TPayload extends JsonObject = JsonObject>(
	format: string,
	raw: string | unknown
): Promise<ReadDocumentResult<TPayload>> {
	return defaultRegistry.readDocument(format, raw);
}

export function clearRegisteredFormatsForTests(): void {
	defaultRegistry.clear();
}

function assertPayloadObject(value: unknown, label: string): JsonObject {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw invalidShape(`${label} upgrader must return an object.`);
	}
	return value as JsonObject;
}
