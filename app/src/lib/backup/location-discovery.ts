import type { Kysely } from 'kysely';
import type { Database } from '$lib/db/types.generated';
import { PROJECT_MANIFEST_FORMAT, readCanonicalDocument } from '$lib/storage/formats';
import { projectManifestRelativeFile } from '$lib/storage/layout';
import type { StoreOperationOptions } from '$lib/storage/opfs-store';
import { listProjectPlacements, listRemovedProjects } from '$lib/storage/project-locations';
import { readLocationMarker } from './location-marker';
import { normalizeSlashes, shouldMirrorProjectFile } from './project-archive';
import { importProjectFileTree } from './project-zip-import';
import { mapConcurrently } from './map-concurrently';
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
		failedImports?: Map<string, string>;
	} = {}
): Promise<LocationDiscoveryResult> {
	const exclusive = options.exclusive ?? (work => work());
	const failedImports = options.failedImports ?? new Map<string, string>();
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
	const found: Array<{ projectId: string; folder: CloudFileMetadata; manifestRevision: string }> =
		[];
	for (const folder of await listAll(provider, rootFolderId, false)) {
		if (!folder.isFolder || folder.isDeleted || skippedFolders.has(folder.name)) continue;
		const manifestEntry = (await listAll(provider, folder.id, false)).find(
			entry =>
				!entry.isFolder && !entry.isDeleted && entry.name === projectManifestRelativeFile()
		);
		if (!manifestEntry) continue;
		const failureKey = `${marker.id}/${folder.name}`;
		if (failedImports.get(failureKey) === manifestEntry.revision) continue;
		const manifest = await readCanonicalDocument(
			PROJECT_MANIFEST_FORMAT,
			await provider.downloadFile(manifestEntry.id),
			{ projectPath: projectManifestRelativeFile() }
		);
		if (!manifest.ok) continue;
		found.push({
			projectId: String(manifest.payload.id),
			folder,
			manifestRevision: manifestEntry.revision,
		});
	}

	const isLocal = (projectId: string) =>
		db.selectFrom('projects').select('id').where('id', '=', projectId).executeTakeFirst();
	const local = await exclusive(async () => {
		const ids = new Set<string>();
		for (const { projectId } of found) if (await isLocal(projectId)) ids.add(projectId);
		return ids;
	});
	const projects: DiscoveredLocationProject[] = found
		.filter(({ projectId }) => local.has(projectId))
		.map(({ projectId, folder }) => ({ projectId, folderName: folder.name, imported: false }));

	for (const { projectId, folder, manifestRevision } of found) {
		if (local.has(projectId)) continue;
		const relative = (entry: CloudFileMetadata) =>
			relativePath(normalizeSlashes(entry.path), normalizeSlashes(folder.path));
		const entries = (await listAll(provider, folder.id, true)).filter(
			entry => !entry.isFolder && !entry.isDeleted && shouldMirrorProjectFile(relative(entry))
		);
		const files = await mapConcurrently(entries, async entry => {
			const content = await provider.downloadFile(entry.id);
			return { path: relative(entry), read: async () => content };
		});
		const failureKey = `${marker.id}/${folder.name}`;
		const imported = await exclusive(async () => {
			if (await isLocal(projectId)) return false;
			const result = await importProjectFileTree(db, files, {
				storeOptions: options.storeOptions,
			});
			if (!result.ok) failedImports.set(failureKey, manifestRevision);
			return result.ok;
		});
		if (imported) {
			failedImports.delete(failureKey);
			projects.push({ projectId, folderName: folder.name, imported: true });
		}
	}
	return { locationId: marker.id, projects };
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
