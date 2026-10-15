import {
	listDirectory,
	readFileBytes,
	readTextFile,
	writeFileBytesAtomic,
	writeTextFileAtomic,
	type StoreDirectoryEntry,
	type StoreOperationOptions,
} from '$lib/storage/opfs-store';
import { isPresencePath, joinStorePath, projectFolder } from '$lib/storage/layout';
import type { DbExecutor } from '$lib/db/worker-kysely';

export type ProjectFileContent = string | Uint8Array;

export interface ProjectArchiveFile {
	path: string;
	storePath: string;
	content: ProjectFileContent;
}

export interface ProjectArchiveFilePath {
	path: string;
	storePath: string;
}

export async function listProjectArchiveFiles(
	db: DbExecutor,
	projectId: string,
	options: { storeOptions?: StoreOperationOptions } = {}
): Promise<ProjectArchiveFile[]> {
	const root = await loadProjectStoreRoot(db, projectId);
	const files = await listProjectArchiveFilePaths(root, options);
	return Promise.all(
		files.map(async file => ({
			path: file.path,
			storePath: file.storePath,
			content: await readProjectFile(file.path, file.storePath, options.storeOptions),
		}))
	);
}

export async function listProjectArchiveFilePaths(
	projectRoot: string,
	options: { storeOptions?: StoreOperationOptions } = {}
): Promise<ProjectArchiveFilePath[]> {
	const files: ProjectArchiveFilePath[] = [];
	await collectProjectArchiveFilePaths(projectRoot, '', files, options.storeOptions ?? {});
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
	storeOptions: StoreOperationOptions
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
				storeOptions
			);
			continue;
		}
		if (!shouldMirrorProjectFile(childRelativePath)) continue;
		files.push({ path: childRelativePath, storePath: childStorePath });
	}
}

export function shouldMirrorProjectFile(path: string): boolean {
	const normalized = normalizeSlashes(path);
	if (!normalized || normalized.includes('.tmp-') || isPresencePath(normalized)) return false;
	if (normalized.endsWith('.working.json')) return false;
	return (
		normalized.endsWith('.json') ||
		normalized.endsWith('.tei.xml') ||
		isCbgmSidecarFile(normalized)
	);
}

export function isCbgmSidecarFile(path: string): boolean {
	return /^cbgm\/[^/]+\.(?:sqlite|input\.xml|global-stemma\.dot)$/.test(normalizeSlashes(path));
}

export function isBinaryProjectFile(path: string): boolean {
	return /^cbgm\/[^/]+\.sqlite$/.test(normalizeSlashes(path));
}

export function projectFileText(content: ProjectFileContent): string {
	return typeof content === 'string' ? content : new TextDecoder().decode(content);
}

export async function readProjectFile(
	path: string,
	storePath: string,
	storeOptions?: StoreOperationOptions
): Promise<ProjectFileContent> {
	return isBinaryProjectFile(path)
		? readFileBytes(storePath, storeOptions)
		: readTextFile(storePath, storeOptions);
}

export async function writeProjectFileAtomic(
	storePath: string,
	content: ProjectFileContent,
	storeOptions?: StoreOperationOptions
): Promise<void> {
	return typeof content === 'string'
		? writeTextFileAtomic(storePath, content, storeOptions)
		: writeFileBytesAtomic(storePath, content, storeOptions);
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
