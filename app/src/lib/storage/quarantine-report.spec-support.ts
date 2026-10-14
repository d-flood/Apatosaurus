import type {
	StoreQuarantineSink,
	StoreQuarantineRecord,
	StoreQuarantineReason,
	StoreQuarantineableResult,
} from './quarantine';

export class InMemoryQuarantineReport implements StoreQuarantineSink {
	private readonly records: StoreQuarantineRecord[] = [];

	record(
		path: string,
		quarantine: StoreQuarantineReason,
		timestamp = new Date().toISOString()
	): void {
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
