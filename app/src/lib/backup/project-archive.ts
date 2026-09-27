import {
	listDirectory,
	readTextFile,
	type StoreDirectoryEntry,
	type StoreOperationOptions,
} from '$lib/storage/opfs-store';
import { joinStorePath, projectFolder } from '$lib/storage/layout';
import type { DbExecutor } from '$lib/db/worker-kysely';

export interface ProjectArchiveFile {
	path: string;
	storePath: string;
	content: string;
}

export interface ProjectArchiveFilePath {
	path: string;
	storePath: string;
}

export async function listProjectArchiveFiles(
	db: DbExecutor,
	projectId: string,
	options: { storeOptions?: StoreOperationOptions; includeDrafts?: boolean } = {}
): Promise<ProjectArchiveFile[]> {
	const root = await loadProjectStoreRoot(db, projectId);
	const files = await listProjectArchiveFilePaths(root, options);
	return Promise.all(
		files.map(async file => ({
			path: file.path,
			storePath: file.storePath,
			content: await readTextFile(file.storePath, options.storeOptions),
		}))
	);
}

export async function listProjectArchiveFilePaths(
	projectRoot: string,
	options: { storeOptions?: StoreOperationOptions; includeDrafts?: boolean } = {}
): Promise<ProjectArchiveFilePath[]> {
	const files: ProjectArchiveFilePath[] = [];
	await collectProjectArchiveFilePaths(
		projectRoot,
		'',
		files,
		options.storeOptions ?? {},
		options.includeDrafts ?? false
	);
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

export async function loadProjectStoreRoot(db: DbExecutor, projectId: string): Promise<string> {
	const project = await db
		.selectFrom('projects')
		.select('storage_slug')
		.where('id', '=', projectId)
		.executeTakeFirst();
	if (!project?.storage_slug) throw new Error(`Project ${projectId} was not found.`);
	return projectFolder(project.storage_slug);
}

async function collectProjectArchiveFilePaths(
	storePath: string,
	relativePath: string,
	files: ProjectArchiveFilePath[],
	storeOptions: StoreOperationOptions,
	includeDrafts: boolean
): Promise<void> {
	let entries: StoreDirectoryEntry[];
	try {
		entries = await listDirectory(storePath, storeOptions);
	} catch (error) {
		if (isMissingStoreEntryError(error)) return;
		throw error;
	}
	for (const entry of entries) {
		const childRelativePath = joinStorePath(relativePath, entry.name);
		const childStorePath = joinStorePath(storePath, entry.name);
		if (entry.kind === 'directory') {
			await collectProjectArchiveFilePaths(
				childStorePath,
				childRelativePath,
				files,
				storeOptions,
				includeDrafts
			);
			continue;
		}
		if (!shouldMirrorProjectFile(childRelativePath, includeDrafts)) continue;
		files.push({ path: childRelativePath, storePath: childStorePath });
	}
}

export function shouldMirrorProjectFile(path: string, includeDrafts = false): boolean {
	const normalized = normalizeSlashes(path);
	if (!normalized || normalized.includes('.tmp-')) return false;
	if (normalized.endsWith('.working.json')) return includeDrafts;
	return normalized.endsWith('.json') || normalized.endsWith('.tei.xml');
}

export function isMissingStoreEntryError(error: unknown): boolean {
	if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
		return error.name === 'NotFoundError';
	}
	return error instanceof Error && /not found/i.test(error.message);
}

export function normalizeSlashes(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}
