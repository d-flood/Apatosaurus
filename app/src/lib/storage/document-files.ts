import {
	joinStorePath,
	collationCheckpointRelativeFile,
	collationCheckpointTeiRelativeFile,
	collationPrimaryRelativeFile,
	collationTeiRelativeFile,
	collationWorkingRelativeFile,
	transcriptionCheckpointRelativeFile,
	transcriptionCheckpointTeiRelativeFile,
	transcriptionPrimaryRelativeFile,
	transcriptionTeiRelativeFile,
	transcriptionWorkingRelativeFile,
} from './layout';

export type DocumentKind = 'transcription' | 'collation';
/**
 * `unlisted`: a `.tei.xml` entity file its manifest does not name, such as the TEI an older build
 * derived beside a JSON document. `legacy`: a JSON document file awaiting conversion to TEI.
 */
export type DocumentFileRole = 'canonical' | 'unlisted' | 'version' | 'legacy';
export type DocumentStorage = 'json' | 'tei';

export interface DocumentFile {
	role: DocumentFileRole;
	kind: DocumentKind;
	entityId: string;
	versionId?: string;
}

interface ManifestHeads {
	transcriptions: ReadonlyArray<{ primary_path: string }>;
	collations: ReadonlyArray<{ primary_path: string }>;
}

const KIND_FILES = {
	transcription: {
		folder: 'transcriptions',
		canonical: transcriptionTeiRelativeFile,
		version: transcriptionCheckpointTeiRelativeFile,
		legacy: transcriptionPrimaryRelativeFile,
		legacyWorking: transcriptionWorkingRelativeFile,
		legacyVersion: transcriptionCheckpointRelativeFile,
	},
	collation: {
		folder: 'collations',
		canonical: collationTeiRelativeFile,
		version: collationCheckpointTeiRelativeFile,
		legacy: collationPrimaryRelativeFile,
		legacyWorking: collationWorkingRelativeFile,
		legacyVersion: collationCheckpointRelativeFile,
	},
} satisfies Record<DocumentKind, unknown>;

const TEI_SUFFIX = '.tei.xml';
// Order matters: `.working.json` and `.tei.xml` must win over the bare `.json` suffix.
const ENTITY_FILE_SUFFIXES: [string, DocumentFileRole][] = [
	['.working.json', 'legacy'],
	[TEI_SUFFIX, 'unlisted'],
	['.json', 'legacy'],
];

export function documentCanonicalPath(kind: DocumentKind, entityId: string): string {
	return KIND_FILES[kind].canonical(entityId);
}

export function documentVersionPath(
	kind: DocumentKind,
	entityId: string,
	versionId: string
): string {
	return KIND_FILES[kind].version(entityId, versionId);
}

export function documentHistoryFolder(kind: DocumentKind, entityId: string): string {
	return joinStorePath('history', KIND_FILES[kind].folder, entityId);
}

export function legacyDocumentPaths(
	kind: DocumentKind,
	entityId: string
): { primary: string; working: string } {
	return {
		primary: KIND_FILES[kind].legacy(entityId),
		working: KIND_FILES[kind].legacyWorking(entityId),
	};
}

export function legacyVersionPath(kind: DocumentKind, entityId: string, versionId: string): string {
	return KIND_FILES[kind].legacyVersion(entityId, versionId);
}

export function documentStorageOfPath(relativePath: string): DocumentStorage {
	return relativePath.endsWith(TEI_SUFFIX) ? 'tei' : 'json';
}

export function hasLegacyHeads(manifest: ManifestHeads): boolean {
	return [...manifest.transcriptions, ...manifest.collations].some(
		head => documentStorageOfPath(head.primary_path) === 'json'
	);
}

// Folder paths end with `/`.
export function documentDeletionPaths(kind: DocumentKind, entityId: string): string[] {
	return [documentCanonicalPath(kind, entityId), `${documentHistoryFolder(kind, entityId)}/`];
}

export function isCoveredByDeletionPaths(deletionPaths: readonly string[], path: string): boolean {
	return deletionPaths.some(deleted =>
		deleted.endsWith('/') ? path.startsWith(deleted) : path === deleted
	);
}

export function teiPrimaryPathsOfManifest(manifest: ManifestHeads | null): Set<string> {
	return new Set(
		[...(manifest?.transcriptions ?? []), ...(manifest?.collations ?? [])]
			.map(head => head.primary_path)
			.filter(path => documentStorageOfPath(path) === 'tei')
	);
}

// Conversion to TEI moved this JSON file's document into the TEI file its manifest head names.
export function isSupersededJsonDocumentPath(
	relativePath: string,
	teiPrimaryPaths: ReadonlySet<string>
): boolean {
	const file = classifyDocumentPath(relativePath);
	return (
		file?.role === 'legacy' &&
		teiPrimaryPaths.has(documentCanonicalPath(file.kind, file.entityId))
	);
}

// A `.tei.xml` entity file is canonical only when its manifest head names it.
export function classifyDocumentPath(
	relativePath: string,
	teiPrimaryPaths?: ReadonlySet<string>
): DocumentFile | null {
	const segments = relativePath.split('/');
	if (segments.length === 2) {
		const kind = kindForFolder(segments[0]!);
		const name = segments[1]!;
		if (!kind) return null;
		for (const [suffix, role] of ENTITY_FILE_SUFFIXES) {
			const entityId = stripSuffix(name, suffix);
			if (!entityId) continue;
			return {
				role:
					role === 'unlisted' && teiPrimaryPaths?.has(relativePath) ? 'canonical' : role,
				kind,
				entityId,
			};
		}
		return null;
	}
	if (segments.length === 4 && segments[0] === 'history') {
		const kind = kindForFolder(segments[1]!);
		const entityId = segments[2]!;
		const name = segments[3]!;
		if (!kind || !entityId) return null;
		const versionId = stripSuffix(name, TEI_SUFFIX);
		if (versionId) return { role: 'version', kind, entityId, versionId };
		const legacyVersionId = stripSuffix(name, '.json');
		if (legacyVersionId) return { role: 'legacy', kind, entityId, versionId: legacyVersionId };
	}
	return null;
}

function kindForFolder(folder: string): DocumentKind | null {
	if (folder === KIND_FILES.transcription.folder) return 'transcription';
	if (folder === KIND_FILES.collation.folder) return 'collation';
	return null;
}

function stripSuffix(name: string, suffix: string): string | null {
	return name.length > suffix.length && name.endsWith(suffix)
		? name.slice(0, -suffix.length)
		: null;
}
