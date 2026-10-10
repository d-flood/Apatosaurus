import { LOCATION_MARKER_FILE, hasLocationMarker } from './location-marker';
import type { CloudFileMetadata, CloudStorageProvider } from './providers/provider';

export interface BrowsedFolder {
	id: string;
	name: string;
	hasMarker: boolean;
}

export interface FolderListing {
	hasMarker: boolean;
	folders: BrowsedFolder[];
}

export async function browseFolder(
	provider: CloudStorageProvider,
	folderId: string
): Promise<FolderListing> {
	const entries: CloudFileMetadata[] = [];
	let cursor: string | undefined;
	do {
		const page = await provider.listFiles(folderId, { recursive: false, cursor });
		entries.push(...page.entries);
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	const live = entries.filter(entry => !entry.isDeleted);
	const folders = await Promise.all(
		live
			.filter(entry => entry.isFolder)
			.toSorted((left, right) => left.name.localeCompare(right.name))
			.map(async entry => ({
				id: entry.id,
				name: entry.name,
				hasMarker: await hasLocationMarker(provider, entry.id),
			}))
	);
	return {
		hasMarker: live.some(entry => !entry.isFolder && entry.name === LOCATION_MARKER_FILE),
		folders,
	};
}
