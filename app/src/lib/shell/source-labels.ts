import type { WitnessSource } from '$lib/collation/collation-types';

export function formatRelativeTime(value: string): string {
	const elapsedSeconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
	const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
	if (Math.abs(elapsedSeconds) < 60) return 'just now';
	const elapsedMinutes = Math.round(elapsedSeconds / 60);
	if (Math.abs(elapsedMinutes) < 60) return formatter.format(elapsedMinutes, 'minute');
	const elapsedHours = Math.round(elapsedMinutes / 60);
	if (Math.abs(elapsedHours) < 24) return formatter.format(elapsedHours, 'hour');
	const elapsedDays = Math.round(elapsedHours / 24);
	if (Math.abs(elapsedDays) < 30) return formatter.format(elapsedDays, 'day');
	const elapsedMonths = Math.round(elapsedDays / 30);
	if (Math.abs(elapsedMonths) < 12) return formatter.format(elapsedMonths, 'month');
	return formatter.format(Math.round(elapsedMonths / 12), 'year');
}

export function formatSourceDate(value: string): string {
	const date = new Date(value);
	return Number.isFinite(date.getTime())
		? date.toLocaleString(undefined, {
				day: 'numeric',
				month: 'short',
				hour: '2-digit',
				minute: '2-digit',
			})
		: value;
}

export function formatWitnessSourceLabel(
	source: WitnessSource | null | undefined,
	versionLabel: string | null
): string {
	if (!source) return 'No source recorded';
	if (source.kind === 'version') return versionLabel || 'Named version';
	return source.capturedAt ? `Current as of ${formatSourceDate(source.capturedAt)}` : 'Current';
}

export function formatConflictCopyTitle(copy: {
	title: string;
	author: string;
	createdAt: string;
}): string {
	const from = copy.author ? ` from ${copy.author}` : '';
	return `Conflict copy of ${copy.title}${from} · ${formatSourceDate(copy.createdAt)}`;
}
