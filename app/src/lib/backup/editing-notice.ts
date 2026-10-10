const NOTICE_WINDOW_MS = 5 * 60_000;

export interface PresenceRecord {
	deviceId: string;
	deviceName: string;
	author: string | null;
	accountId: string | null;
	documentId: string;
	editedAt: string;
}

export function editingNotice(
	records: readonly PresenceRecord[],
	self: { deviceId: string; accountId: string | null },
	now: number
): string | null {
	const latest = records
		.filter(record => record.deviceId !== self.deviceId)
		.map(record => ({ record, age: now - Date.parse(record.editedAt) }))
		.filter(({ age }) => age < NOTICE_WINDOW_MS)
		.sort((left, right) => left.age - right.age)[0];
	if (!latest) return null;
	const { record } = latest;
	const minutes = Math.max(0, Math.floor(latest.age / 60_000));
	return record.accountId !== null && record.accountId === self.accountId
		? `You edited this on ${record.deviceName} · ${minutes} min ago`
		: `${record.author ?? 'Someone'} has been editing this · ${minutes} min ago`;
}
