import type { CloudStorageProvider } from './providers/provider';

export const LOCATION_MARKER_FILE = 'apatosaurus-location.json';
const LOCATION_MARKER_FORMAT = 'apatosaurus.location';

export interface LocationMarker {
	format: typeof LOCATION_MARKER_FORMAT;
	version: 1;
	id: string;
	created_at: string;
}

export async function readLocationMarker(
	provider: CloudStorageProvider,
	rootFolderId: string
): Promise<LocationMarker | null> {
	const entry = await findRootEntry(provider, rootFolderId, LOCATION_MARKER_FILE);
	if (!entry) return null;
	const marker = JSON.parse(await provider.downloadFile(entry.id)) as Partial<LocationMarker>;
	if (
		marker.format !== LOCATION_MARKER_FORMAT ||
		marker.version !== 1 ||
		typeof marker.id !== 'string' ||
		!marker.id
	) {
		throw new Error(`${LOCATION_MARKER_FILE} is not a valid location marker.`);
	}
	return marker as LocationMarker;
}

export async function ensureLocationMarker(
	provider: CloudStorageProvider,
	rootFolderId: string,
	newId: string,
	now: string
): Promise<{ marker: LocationMarker; created: boolean }> {
	const existing = await readLocationMarker(provider, rootFolderId);
	if (existing) return { marker: existing, created: false };
	const marker: LocationMarker = {
		format: LOCATION_MARKER_FORMAT,
		version: 1,
		id: newId,
		created_at: now,
	};
	await provider.createFile(rootFolderId, LOCATION_MARKER_FILE, JSON.stringify(marker, null, 2));
	return { marker, created: true };
}

export async function hasLocationMarker(
	provider: CloudStorageProvider,
	folderId: string
): Promise<boolean> {
	return Boolean(await findRootEntry(provider, folderId, LOCATION_MARKER_FILE));
}

async function findRootEntry(provider: CloudStorageProvider, rootFolderId: string, name: string) {
	let cursor: string | undefined;
	do {
		const page = await provider.listFiles(rootFolderId, { recursive: false, cursor });
		const entry = page.entries.find(
			candidate => !candidate.isFolder && !candidate.isDeleted && candidate.name === name
		);
		if (entry) return entry;
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return null;
}
