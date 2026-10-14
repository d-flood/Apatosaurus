import type { Kysely } from 'kysely';
import type { Database } from '$lib/db/types.generated';
import { PROJECT_MANIFEST_FORMAT, readCanonicalDocument } from '$lib/storage/formats';
import { projectManifestRelativeFile } from '$lib/storage/layout';
import type { StoreOperationOptions } from '$lib/storage/opfs-store';
import { listProjectPlacements, listRemovedProjects } from '$lib/storage/project-locations';
import { readLocationMarker } from './location-marker';
import { normalizeSlashes, shouldMirrorProjectFile } from './project-archive';
import { importProjectFileTree } from './project-zip-import';
import type { CloudFileMetadata, CloudStorageProvider } from './providers/provider';

export interface DiscoveredLocationProject {
	projectId: string;
	folderName: string;
	imported: boolean;
}

export interface LocationDiscoveryResult {
	locationId: string;
	projects: DiscoveredLocationProject[];
}

export async function discoverLocationProjects(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	rootFolderId: string,
	options: {
		storeOptions?: StoreOperationOptions;
		exclusive?: <T>(work: () => Promise<T>) => Promise<T>;
	} = {}
): Promise<LocationDiscoveryResult> {
	const exclusive = options.exclusive ?? (work => work());
	const marker = await readLocationMarker(provider, rootFolderId);
	if (!marker) throw new Error('This folder is not a project location.');
	const [placements, removed] = await Promise.all([
		listProjectPlacements(options.storeOptions),
		listRemovedProjects(options.storeOptions),
	]);
	const skippedFolders = new Set(
		[...placements, ...removed]
			.filter(entry => entry.locationId === marker.id)
			.map(entry => entry.folderName)
	);
	const found: Array<{
		projectId: string;
		folderName: string;
		files: Array<{ path: string; read: () => Promise<string> }>;
	}> = [];
	for (const folder of await listAll(provider, rootFolderId, false)) {
		if (!folder.isFolder || folder.isDeleted || skippedFolders.has(folder.name)) continue;
		const files = (await listAll(provider, folder.id, true)).filter(
			entry => !entry.isFolder && !entry.isDeleted
		);
		const relative = (entry: CloudFileMetadata) =>
			relativePath(normalizeSlashes(entry.path), normalizeSlashes(folder.path));
		const manifestEntry = files.find(
			entry => relative(entry) === projectManifestRelativeFile()
		);
		if (!manifestEntry) continue;
		const manifest = await readCanonicalDocument(
			PROJECT_MANIFEST_FORMAT,
			await provider.downloadFile(manifestEntry.id),
			{ projectPath: projectManifestRelativeFile() }
		);
		if (!manifest.ok) continue;
		found.push({
			projectId: String(manifest.payload.id),
			folderName: folder.name,
			files: files
				.filter(entry => shouldMirrorProjectFile(relative(entry)))
				.map(entry => ({
					path: relative(entry),
					read: () => provider.downloadFile(entry.id),
				})),
		});
	}
	return exclusive(async () => {
		const projects: DiscoveredLocationProject[] = [];
		for (const { projectId, folderName, files } of found) {
			const local = await db
				.selectFrom('projects')
				.select('id')
				.where('id', '=', projectId)
				.executeTakeFirst();
			if (local) {
				projects.push({ projectId, folderName, imported: false });
				continue;
			}
			const result = await importProjectFileTree(db, files, {
				storeOptions: options.storeOptions,
			});
			if (result.ok) projects.push({ projectId, folderName, imported: true });
		}
		return { locationId: marker.id, projects };
	});
}

async function listAll(
	provider: CloudStorageProvider,
	folderId: string,
	recursive: boolean
): Promise<CloudFileMetadata[]> {
	const entries: CloudFileMetadata[] = [];
	let cursor: string | undefined;
	do {
		const page = await provider.listFiles(folderId, { recursive, cursor });
		entries.push(...page.entries);
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return entries;
}

function relativePath(path: string, root: string): string {
	return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}
