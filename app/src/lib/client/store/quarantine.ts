export type StoreQuarantineCode =
	| 'invalid_json'
	| 'invalid_schema_version'
	| 'invalid_shape'
	| 'hash_mismatch';

export interface StoreQuarantineReason {
	code: StoreQuarantineCode;
	message: string;
	expected?: unknown;
	actual?: unknown;
}

export interface StoreQuarantineRecord extends StoreQuarantineReason {
	path: string;
	timestamp: string;
}

export type StoreQuarantineableResult = { ok: true } | { ok: false; quarantine: StoreQuarantineReason };

export class StoreValidationError extends Error {
	constructor(
		readonly code: StoreQuarantineCode,
		message: string,
		readonly expected?: unknown,
		readonly actual?: unknown
	) {
		super(message);
		this.name = 'StoreValidationError';
	}
}

export class InMemoryQuarantineReport {
	private readonly records: StoreQuarantineRecord[] = [];

	record(path: string, quarantine: StoreQuarantineReason, timestamp = new Date().toISOString()): void {
		this.records.push({ path, timestamp, ...quarantine });
	}

	list(): StoreQuarantineRecord[] {
		return this.records.map(record => ({ ...record }));
	}

	clear(): void {
		this.records.length = 0;
	}
}

export function createQuarantineReport(): InMemoryQuarantineReport {
	return new InMemoryQuarantineReport();
}

export function recordQuarantineResult(
	report: InMemoryQuarantineReport,
	path: string,
	result: StoreQuarantineableResult,
	timestamp?: string
): boolean {
	if (result.ok) return false;
	report.record(path, result.quarantine, timestamp);
	return true;
}

export function invalidJson(message: string, expected?: unknown, actual?: unknown): StoreValidationError {
	return new StoreValidationError('invalid_json', message, expected, actual);
}

export function invalidSchemaVersion(
	message: string,
	expected?: unknown,
	actual?: unknown
): StoreValidationError {
	return new StoreValidationError('invalid_schema_version', message, expected, actual);
}

export function invalidShape(message: string, expected?: unknown, actual?: unknown): StoreValidationError {
	return new StoreValidationError('invalid_shape', message, expected, actual);
}

export function hashMismatch(message: string, expected?: unknown, actual?: unknown): StoreValidationError {
	return new StoreValidationError('hash_mismatch', message, expected, actual);
}

export function quarantineFromError(error: unknown): StoreQuarantineReason {
	if (error instanceof StoreValidationError) {
		return {
			code: error.code,
			message: error.message,
			expected: error.expected,
			actual: error.actual,
		};
	}
	return { code: 'invalid_shape', message: error instanceof Error ? error.message : String(error) };
}
