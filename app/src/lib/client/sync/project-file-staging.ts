import {
	canonicalFormatForProjectPath,
	deleteDirectory,
	joinStorePath,
	readCanonicalDocument,
	readTextFile,
	writeTextFileAtomic,
	type ProjectManifestPayload,
	type StoreOperationOptions,
	type StoreQuarantineRecord,
} from '$lib/client/store';

export interface ProjectFileCandidate {
	path: string;
	content: string;
}

export interface ValidateProjectFileCandidatesOptions {
	projectId?: string;
	requireManifest?: boolean;
	storeOptions?: StoreOperationOptions;
	nonce?: () => string;
}

export interface ValidatedProjectFileCandidates {
	valid: ProjectFileCandidate[];
	quarantinedFiles: StoreQuarantineRecord[];
}

const STAGING_ROOT = 'staging';

export async function stageAndValidateProjectFiles(
	candidates: ProjectFileCandidate[],
	options: ValidateProjectFileCandidatesOptions = {}
): Promise<ValidatedProjectFileCandidates> {
	const storeOptions = options.storeOptions ?? {};
	const stagingPath = joinStorePath(STAGING_ROOT, (options.nonce ?? createNonce)());
	try {
		const entries = candidates.map(candidate => ({
			path: normalizeProjectEntryPath(candidate.path),
			content: candidate.content,
		}));
		for (const entry of entries) {
			await writeTextFileAtomic(joinStorePath(stagingPath, entry.path), entry.content, storeOptions);
		}

		let projectId = options.projectId;
		const manifestEntry = entries.find(entry => entry.path === 'project.json');
		if (!projectId && manifestEntry) {
			const format = canonicalFormatForProjectPath(manifestEntry.path);
			if (format) {
				const manifest = await readCanonicalDocument<ProjectManifestPayload>(
					format,
					await readTextFile(joinStorePath(stagingPath, manifestEntry.path), storeOptions),
					{ projectPath: manifestEntry.path }
				);
				if (manifest.ok) projectId = manifest.payload.id;
			}
		}

		const valid: ProjectFileCandidate[] = [];
		const quarantinedFiles: StoreQuarantineRecord[] = [];
		for (const entry of entries) {
			const format = canonicalFormatForProjectPath(entry.path);
			if (!format) {
				if (entry.path.endsWith('.tei.xml')) valid.push(entry);
				else quarantinedFiles.push(quarantine(entry.path, `Unsupported project file ${entry.path}.`));
				continue;
			}
			const result = await readCanonicalDocument(
				format,
				await readTextFile(joinStorePath(stagingPath, entry.path), storeOptions),
				{ projectPath: entry.path, projectId }
			);
			if (result.ok) valid.push(entry);
			else quarantinedFiles.push({ path: entry.path, timestamp: new Date().toISOString(), ...result.quarantine });
		}
		if (options.requireManifest && !manifestEntry) {
			quarantinedFiles.push(quarantine('project.json', 'Project file tree does not contain project.json.'));
		}
		return { valid, quarantinedFiles };
	} finally {
		await deleteDirectoryIfExists(stagingPath, storeOptions);
	}
}

export function normalizeProjectEntryPath(path: string): string {
	if (path.startsWith('/') || path.includes('..') || path.includes('\\')) {
		throw new Error(`Invalid project entry path ${JSON.stringify(path)}.`);
	}
	return joinStorePath(path);
}

async function deleteDirectoryIfExists(path: string, storeOptions: StoreOperationOptions): Promise<void> {
	try {
		await deleteDirectory(path, { ...storeOptions, recursive: true });
	} catch (error) {
		if (!isMissingStoreEntryError(error)) throw error;
	}
}

function quarantine(path: string, message: string): StoreQuarantineRecord {
	return { path, code: 'invalid_shape', message, timestamp: new Date().toISOString() };
}

function createNonce(): string {
	return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2, 14);
}

function isMissingStoreEntryError(error: unknown): boolean {
	if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
		return error.name === 'NotFoundError';
	}
	return error instanceof Error && /not found/i.test(error.message);
}
