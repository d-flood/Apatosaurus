import { ALPHA_READING_TYPES } from './alpha-collation';
import { openEnvelope, type JsonObject } from '../envelope';
import { hashCanonicalPayload } from '../canonical-json';
import {
	PROJECT_MANIFEST_FORMAT,
	type CollationPayload,
	type ProjectManifestPayload,
} from '../formats';
import {
	COLLATION_CHECKPOINT_FORMAT,
	COLLATION_FORMAT,
	WORKING_COLLATION_FORMAT,
	legacyFormatForProjectPath,
	readLegacyDocument,
	serializeLegacyDocument,
	type WorkingCollationPayload,
} from '.';
import {
	listDirectory,
	readTextFile,
	writeTextFileAtomic,
	withDocumentStoreWriterLock,
	type StoreOperationOptions,
} from '../opfs-store';
import { joinStorePath, projectFolder, projectsFolder } from '../layout';

interface ProjectEntry {
	path: string;
	content: string;
	format: string | null;
	payload?: JsonObject;
}

export async function reconcileAlphaProjectUpgrade(entries: ProjectEntry[]): Promise<void> {
	const manifestEntry = entries.find(entry => entry.format === PROJECT_MANIFEST_FORMAT);
	const manifest = manifestEntry?.payload as ProjectManifestPayload | undefined;
	if (!manifest || !manifestEntry) return;
	const classifications = new Set<string>();
	let changed = false;
	for (const entry of entries) {
		if (
			entry.format !== COLLATION_FORMAT ||
			openEnvelope(entry.content).header.schema_version !== 2
		)
			continue;
		const original = openEnvelope(entry.content).payload as unknown as {
			current_revision: { id: string; content_hash: string };
		};
		const upgraded = entry.payload as CollationPayload;
		const head = manifest.collations.find(head => head.collation_id === upgraded.id);
		if (
			!head &&
			manifest.tombstones.some(
				tombstone =>
					tombstone.entity_type === 'collation' &&
					tombstone.entity_id === upgraded.id &&
					tombstone.deletion_revision_id === original.current_revision.id
			)
		)
			continue;
		if (
			!head?.current_revision ||
			head.current_revision.id !== original.current_revision.id ||
			head.current_revision.content_hash !== original.current_revision.content_hash
		) {
			throw new Error(`Alpha collation ${upgraded.id} does not match its manifest revision.`);
		}
		head.current_revision.content_hash = upgraded.based_on_checkpoint!.content_hash;
		for (const candidate of entries) {
			if (candidate.format !== WORKING_COLLATION_FORMAT) continue;
			const working = candidate.payload as WorkingCollationPayload;
			if (working.id !== upgraded.id) continue;
			if (
				working.draft.base_revision_id === original.current_revision.id &&
				working.draft.base_content_hash === original.current_revision.content_hash
			) {
				working.draft.base_content_hash = upgraded.based_on_checkpoint!.content_hash;
				candidate.content = await serializeLegacyDocument(
					WORKING_COLLATION_FORMAT,
					working
				);
			}
		}
		changed = true;
	}
	const hasAlphaHistory = entries.some(
		entry =>
			entry.format === COLLATION_CHECKPOINT_FORMAT &&
			openEnvelope(entry.content).header.schema_version === 2
	);
	if (!changed && !hasAlphaHistory) return;
	for (const entry of entries) {
		if (
			entry.format !== COLLATION_FORMAT &&
			entry.format !== WORKING_COLLATION_FORMAT &&
			entry.format !== COLLATION_CHECKPOINT_FORMAT
		)
			continue;
		const content =
			entry.format === COLLATION_CHECKPOINT_FORMAT ? entry.payload?.payload : entry.payload;
		const document = (content as CollationPayload | undefined)?.document;
		for (const unit of document?.apparatus?.units ?? []) {
			for (const type of Object.values(unit.decisions.readingType ?? {}))
				if (type) classifications.add(type);
		}
	}
	const settings = manifest.collation_settings;
	if (settings !== null && (typeof settings !== 'object' || Array.isArray(settings)))
		throw new Error('Project collation settings must be an object.');
	const vocabulary = settings?.readingTypes;
	if (vocabulary !== undefined && !Array.isArray(vocabulary))
		throw new Error('Project reading types must be an array.');
	const existing = vocabulary ?? [];
	manifest.collation_settings = {
		...settings,
		readingTypes: [
			...existing,
			...ALPHA_READING_TYPES.filter(
				type =>
					classifications.has(type.id) &&
					!existing.some(
						value =>
							value &&
							typeof value === 'object' &&
							!Array.isArray(value) &&
							value.id === type.id
					)
			),
		],
	};
	manifest.manifest_content_hash = await hashCanonicalPayload({
		project_id: manifest.id,
		transcriptions: manifest.transcriptions,
		collations: manifest.collations,
		tombstones: manifest.tombstones,
	});
	manifestEntry.content = await serializeLegacyDocument(PROJECT_MANIFEST_FORMAT, manifest);
	for (const entry of entries) {
		if (
			entry.format === COLLATION_FORMAT &&
			manifest.collations.some(head => head.collation_id === entry.payload?.id)
		)
			entry.content = await serializeLegacyDocument(COLLATION_FORMAT, entry.payload!);
	}
}

interface UpgradeJournal {
	version: 1;
	files: Array<{ path: string; original: string; upgraded: string }>;
}

const ALPHA_UPGRADE_FOLDER = 'upgrades/alpha-c7d94ee';
const SCANNED_MARKER_PATH = `${ALPHA_UPGRADE_FOLDER}/scanned.json`;

/**
 * Originals and journal stay outside the synced tree. The scanned marker lists folders
 * that need nothing further, so a start whose folders are all listed reads nothing else.
 * `rescan` ignores the marker, for files just placed in a folder it may list.
 */
export async function upgradeAlphaProjects(
	storeOptions: StoreOperationOptions = {},
	{ rescan = false } = {}
): Promise<boolean> {
	if (!rescan) {
		const folders = await listProjectFolderNames(storeOptions);
		if (folders === null) return false;
		const scanned = await readScannedMarker(storeOptions);
		if (folders.every(name => scanned.has(name))) return false;
	}
	return withDocumentStoreWriterLock(async options => {
		let projects;
		try {
			projects = await listDirectory(projectsFolder(), options);
		} catch (error) {
			if (isMissing(error)) return false;
			throw error;
		}
		let changed = false;
		const checked: string[] = [];
		for (const project of projects) {
			if (project.kind !== 'directory') continue;
			const backup = `${ALPHA_UPGRADE_FOLDER}/${project.name}`;
			const journalPath = `${backup}/journal.json`;
			let journal: UpgradeJournal | null = null;
			try {
				journal = JSON.parse(await readTextFile(journalPath, options)) as UpgradeJournal;
			} catch (error) {
				if (!isMissing(error)) throw error;
			}
			if (journal) {
				try {
					await readTextFile(`${backup}/complete.json`, options);
					try {
						await readTextFile(`${backup}/indexed.json`, options);
						checked.push(project.name);
					} catch (error) {
						if (!isMissing(error)) throw error;
						changed = true;
					}
					continue;
				} catch (error) {
					if (!isMissing(error)) throw error;
				}
			} else {
				if (!(await hasAlphaCollations(projectFolder(project.name), options))) {
					checked.push(project.name);
					continue;
				}
				const files = await readProjectFiles(projectFolder(project.name), options);
				const entries: ProjectEntry[] = [];
				for (const file of files) {
					const format = legacyFormatForProjectPath(file.path);
					if (!format) continue;
					const result = await readLegacyDocument(format, file.content, {
						projectPath: file.path,
					});
					if (!result.ok)
						throw new Error(
							`Cannot upgrade ${project.name}/${file.path}: ${result.quarantine.message}`
						);
					entries.push({ ...file, format, payload: result.payload });
				}
				const manifest = entries.find(entry => entry.format === PROJECT_MANIFEST_FORMAT)
					?.payload as ProjectManifestPayload | undefined;
				if (!manifest)
					throw new Error(`Cannot upgrade ${project.name} without a valid manifest.`);
				for (const entry of entries) {
					const payload =
						entry.format === COLLATION_CHECKPOINT_FORMAT
							? entry.payload?.payload
							: entry.payload;
					if (
						(entry.format === COLLATION_FORMAT ||
							entry.format === WORKING_COLLATION_FORMAT ||
							entry.format === COLLATION_CHECKPOINT_FORMAT) &&
						(payload as CollationPayload).project_id !== manifest.id
					)
						throw new Error(`Collation ${entry.path} belongs to another project.`);
				}
				await reconcileAlphaProjectUpgrade(entries);
				const originals = new Map(files.map(file => [file.path, file.content]));
				journal = {
					version: 1,
					files: entries
						.filter(
							entry =>
								!entry.path.startsWith('history/') &&
								entry.content !== originals.get(entry.path)
						)
						.map(entry => ({
							path: entry.path,
							original: originals.get(entry.path)!,
							upgraded: entry.content,
						})),
				};
				for (const file of files)
					await writeTextFileAtomic(
						`${backup}/original/${file.path}`,
						file.content,
						options
					);
				await writeTextFileAtomic(journalPath, JSON.stringify(journal), options);
			}
			if (journal.version !== 1 || !Array.isArray(journal.files))
				throw new Error('Invalid alpha upgrade journal.');
			for (const file of [...journal.files].sort(
				(a, b) => Number(a.path === 'project.json') - Number(b.path === 'project.json')
			)) {
				const path = joinStorePath(projectFolder(project.name), file.path);
				const current = await readTextFile(path, options);
				if (current === file.upgraded) continue;
				if (current !== file.original)
					throw new Error(
						`Cannot resume alpha upgrade: ${path} changed during conversion.`
					);
				await writeTextFileAtomic(path, file.upgraded, options);
			}
			await writeTextFileAtomic(
				`${backup}/complete.json`,
				JSON.stringify({ version: 1 }),
				options
			);
			changed = true;
		}
		try {
			await writeTextFileAtomic(
				SCANNED_MARKER_PATH,
				JSON.stringify({ version: 1, projects: checked }),
				options
			);
		} catch (error) {
			console.warn('[alpha-upgrade] could not record scanned project folders', error);
		}
		return changed;
	}, storeOptions);
}

async function listProjectFolderNames(options: StoreOperationOptions): Promise<string[] | null> {
	try {
		return (await listDirectory(projectsFolder(), options))
			.filter(entry => entry.kind === 'directory')
			.map(entry => entry.name);
	} catch (error) {
		if (isMissing(error)) return null;
		throw error;
	}
}

async function readScannedMarker(options: StoreOperationOptions): Promise<Set<string>> {
	try {
		const marker = JSON.parse(await readTextFile(SCANNED_MARKER_PATH, options)) as {
			version?: number;
			projects?: unknown;
		};
		if (marker.version !== 1 || !Array.isArray(marker.projects)) return new Set();
		return new Set(marker.projects.filter(name => typeof name === 'string'));
	} catch (error) {
		if (isMissing(error) || error instanceof SyntaxError) return new Set();
		throw error;
	}
}

export async function markAlphaUpgradesIndexed(options: StoreOperationOptions = {}): Promise<void> {
	let projects;
	try {
		projects = await listDirectory(ALPHA_UPGRADE_FOLDER, options);
	} catch (error) {
		if (isMissing(error)) return;
		throw error;
	}
	for (const project of projects) {
		if (project.kind !== 'directory') continue;
		await readTextFile(`${project.path}/complete.json`, options);
		await writeTextFileAtomic(
			`${project.path}/indexed.json`,
			JSON.stringify({ version: 1 }),
			options
		);
	}
}

async function readProjectFiles(
	folder: string,
	options: StoreOperationOptions,
	relative = ''
): Promise<Array<{ path: string; content: string }>> {
	const files: Array<{ path: string; content: string }> = [];
	for (const entry of await listDirectory(folder, options)) {
		const path = joinStorePath(relative, entry.name);
		if (entry.kind === 'directory')
			files.push(...(await readProjectFiles(entry.path, options, path)));
		else if (!entry.name.includes('.tmp-'))
			files.push({ path, content: await readTextFile(entry.path, options) });
	}
	return files;
}

async function hasAlphaCollations(
	folder: string,
	options: StoreOperationOptions
): Promise<boolean> {
	let entries;
	try {
		entries = await listDirectory(`${folder}/collations`, options);
	} catch (error) {
		if (isMissing(error)) return false;
		throw error;
	}
	for (const entry of entries) {
		if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
		const raw = await readTextFile(entry.path, options);
		try {
			if (openEnvelope(raw).header.schema_version === 2) return true;
		} catch {}
	}
	return false;
}

function isMissing(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.name === 'NotFoundError' || /not found/i.test(error.message))
	);
}
