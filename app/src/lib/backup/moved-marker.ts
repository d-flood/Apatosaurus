import type { DeletedNotice, MovedNotice } from '$lib/storage/project-locations';

export const MOVED_MARKER_FILE = 'moved.json';
const MOVED_MARKER_FORMAT = 'apatosaurus.moved';
export const DELETED_MARKER_FILE = 'deleted.json';
const DELETED_MARKER_FORMAT = 'apatosaurus.deleted';

export interface MovedMarker {
	format: typeof MOVED_MARKER_FORMAT;
	version: 1;
	moved_at: string;
	moved_by: string;
	destination_label: string;
}

export interface DeletedMarker {
	format: typeof DELETED_MARKER_FORMAT;
	version: 1;
	deleted_at: string;
	deleted_by: string;
}

export function serializeMovedMarker(notice: MovedNotice): string {
	const marker: MovedMarker = {
		format: MOVED_MARKER_FORMAT,
		version: 1,
		moved_at: notice.movedAt,
		moved_by: notice.movedBy,
		destination_label: notice.destinationLabel,
	};
	return JSON.stringify(marker, null, 2);
}

export function parseMovedMarker(content: string): MovedNotice {
	const marker = JSON.parse(content) as Partial<MovedMarker>;
	if (
		marker.format !== MOVED_MARKER_FORMAT ||
		marker.version !== 1 ||
		typeof marker.moved_at !== 'string' ||
		typeof marker.moved_by !== 'string' ||
		typeof marker.destination_label !== 'string'
	) {
		throw new Error(`${MOVED_MARKER_FILE} is not a valid moved marker.`);
	}
	return {
		movedAt: marker.moved_at,
		movedBy: marker.moved_by,
		destinationLabel: marker.destination_label,
	};
}

export function serializeDeletedMarker(notice: DeletedNotice): string {
	const marker: DeletedMarker = {
		format: DELETED_MARKER_FORMAT,
		version: 1,
		deleted_at: notice.deletedAt,
		deleted_by: notice.deletedBy,
	};
	return JSON.stringify(marker, null, 2);
}

export function parseDeletedMarker(content: string): DeletedNotice {
	const marker = JSON.parse(content) as Partial<DeletedMarker>;
	if (
		marker.format !== DELETED_MARKER_FORMAT ||
		marker.version !== 1 ||
		typeof marker.deleted_at !== 'string' ||
		typeof marker.deleted_by !== 'string'
	) {
		throw new Error(`${DELETED_MARKER_FILE} is not a valid deleted marker.`);
	}
	return { deletedAt: marker.deleted_at, deletedBy: marker.deleted_by };
}
