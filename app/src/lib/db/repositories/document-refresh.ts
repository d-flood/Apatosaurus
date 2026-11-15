import type { Insertable } from 'kysely';

import {
	PROJECT_MANIFEST_FORMAT,
	parseCollationPayloadTei,
	parseCollationTeiVersion,
	parseTranscriptionTei,
	parseTranscriptionTeiVersion,
	readCanonicalDocument,
	type ProjectManifestPayload,
} from '$lib/storage/formats';
import { teiContentHash } from '$lib/storage/tei-content';
import {
	classifyDocumentPath,
	documentStorageOfPath,
	type DocumentKind,
} from '$lib/storage/document-files';
import { buildCollationProjectionFromDocument } from '$lib/collation/collation-projection';
import { hashContent } from '$lib/storage/content-hash';
import { projectFolder, projectManifestFile } from '$lib/storage/layout';
import {
	readTextFile,
	statFilesUnder,
	type StoreFileStat,
	type StoreOperationOptions,
} from '$lib/storage/opfs-store';

import type { DocumentFileFingerprints, DocumentFileProblems } from '../types.generated';
import type { DbExecutor } from '../worker-kysely';
import {
	documentFingerprintRow,
	problemFromRow,
	upsertDocumentFingerprint,
	type DocumentFileProblem,
} from './document-fingerprints';
import {
	numberUnlabelledVersions,
	transcriptionIndexRowsFromPrimary,
	type IndexRebuildProgress,
} from './index-rebuild';
import { inTransaction } from './revisions';
import {
	collationIndexRowsFromPayload,
	replaceCollationIndexRows,
	saveCollationProjection,
} from './collations';
import { replaceTranscriptionIndexRows } from './transcription-files';

export interface DocumentFileRefreshReport {
	checked: number;
	hashed: number;
	reindexedPaths: string[];
	problems: DocumentFileProblem[];
}

const PROGRESS_THRESHOLD = 5;

interface CanonicalFile {
	path: string;
	storePath: string;
	kind: DocumentKind;
	entityType: 'transcription' | 'collation' | 'version';
	entityId: string;
	/** The project transcription id or collation id that owns the file. */
	documentId: string;
}

interface StatedFile extends CanonicalFile {
	stat: StoreFileStat;
	fingerprint: DocumentFileFingerprints | undefined;
}

export async function refreshChangedDocumentFiles(
	db: DbExecutor,
	projectId: string,
	storeOptions: StoreOperationOptions = {},
	onProgress?: (progress: IndexRebuildProgress) => void
): Promise<DocumentFileRefreshReport> {
	const project = await db
		.selectFrom('projects')
		.select('storage_slug')
		.where('id', '=', projectId)
		.executeTakeFirst();
	if (!project) throw new Error(`Project ${projectId} was not found.`);
	const slug = project.storage_slug;
	const files = await statCanonicalTeiFiles(slug, storeOptions);
	const [fingerprints, problems] = await Promise.all([
		loadFingerprints(db, files),
		loadProblems(db, projectId),
	]);
	const stated = files.map(file => ({ ...file, fingerprint: fingerprints.get(file.path) }));
	const changed = stated.filter(
		file =>
			!sameStat(file.fingerprint, file.stat) && !sameStat(problems.get(file.path), file.stat)
	);

	const report: DocumentFileRefreshReport = {
		checked: stated.length,
		hashed: 0,
		reindexedPaths: [],
		problems: [],
	};
	const showProgress = changed.length > PROGRESS_THRESHOLD;
	let done = 0;
	const step = () => {
		if (showProgress) onProgress?.({ done: done++, total: changed.length });
	};
	step();
	// Currents first: a new Version's row needs its document row, a collation's witnesses their
	// transcriptions.
	const ordered = [
		...changed.filter(file => file.entityType === 'transcription'),
		...changed.filter(file => file.entityType === 'collation'),
		...changed.filter(file => file.entityType === 'version'),
	];
	try {
		const versionRows: ParsedVersion[] = [];
		const collationVersions: ParsedCollationVersion[] = [];
		for (const file of ordered) {
			const xml = await readTextFile(file.storePath, storeOptions);
			const fileHash = await hashContent(xml);
			report.hashed += 1;
			if (file.fingerprint?.file_hash === fileHash) {
				await inTransaction(db, async trx => {
					await trx
						.updateTable('document_file_fingerprints')
						.set({ size: file.stat.size, last_modified: file.stat.lastModified })
						.where('path', '=', file.path)
						.execute();
					await trx
						.deleteFrom('document_file_problems')
						.where('path', '=', file.path)
						.execute();
				});
			} else {
				try {
					if (file.entityType === 'transcription') {
						await reindexCurrent(db, projectId, file, xml, fileHash);
						report.reindexedPaths.push(file.path);
					} else if (file.entityType === 'collation') {
						await reindexCollationCurrent(db, projectId, file, xml, fileHash);
						report.reindexedPaths.push(file.path);
					} else if (file.kind === 'collation') {
						collationVersions.push(await parseCollationVersion(file, xml, fileHash));
					} else {
						versionRows.push(await parseVersion(file, xml, fileHash));
					}
				} catch (error) {
					await recordProblem(db, projectId, file, error);
				}
			}
			step();
		}
		await indexVersions(db, versionRows, report);
		await indexCollationVersions(db, collationVersions, report);
	} finally {
		if (showProgress) onProgress?.({ done: changed.length, total: changed.length });
	}
	report.problems = await listDocumentFileProblems(db, projectId);
	return report;
}

export interface DocumentFileProblemListing extends DocumentFileProblem {
	kind: DocumentKind | null;
	documentId: string;
	projectTranscriptionId: string;
	transcriptionId: string | null;
	title: string | null;
}

export async function listDocumentFileProblems(
	db: DbExecutor,
	projectId: string
): Promise<DocumentFileProblemListing[]> {
	const rows = await db
		.selectFrom('document_file_problems')
		.selectAll()
		.where('project_id', '=', projectId)
		.orderBy('path')
		.execute();
	const files = new Map(rows.map(row => [row.path, classifyDocumentPath(row.path ?? '')]));
	const problems = rows.map(row => {
		const problem = problemFromRow(row);
		const file = files.get(row.path);
		return {
			...problem,
			kind: file?.kind ?? null,
			documentId: file?.entityId ?? '',
			projectTranscriptionId: file?.kind === 'transcription' ? file.entityId : '',
		};
	});
	const collationIds = [
		...new Set(
			[...files.values()].flatMap(file => (file?.kind === 'collation' ? [file.entityId] : []))
		),
	];
	const collationTitles = new Map(
		collationIds.length
			? (
					await db
						.selectFrom('collations')
						.select(['id', 'title'])
						.where('id', 'in', collationIds)
						.execute()
				).map(row => [row.id, row.title] as const)
			: []
	);
	const ptids = [
		...new Set(problems.map(problem => problem.projectTranscriptionId).filter(Boolean)),
	];
	const titles = new Map(
		ptids.length
			? (
					await db
						.selectFrom('project_transcriptions')
						.innerJoin(
							'transcriptions',
							'transcriptions.id',
							'project_transcriptions.transcription_id'
						)
						.select([
							'project_transcriptions.id as ptid',
							'transcriptions.id as transcription_id',
							'transcriptions.title as title',
						])
						.where('project_transcriptions.id', 'in', ptids)
						.execute()
				).map(row => [row.ptid, row] as const)
			: []
	);
	return problems.map(problem => {
		const file = files.get(problem.path);
		if (file?.kind === 'collation')
			return {
				...problem,
				transcriptionId: null,
				title: collationTitles.get(file.entityId) ?? null,
			};
		const indexed = titles.get(problem.projectTranscriptionId);
		return {
			...problem,
			transcriptionId: indexed?.transcription_id ?? null,
			title: indexed?.title ?? null,
		};
	});
}

async function statCanonicalTeiFiles(
	slug: string,
	storeOptions: StoreOperationOptions
): Promise<Array<CanonicalFile & { stat: StoreFileStat }>> {
	const root = projectFolder(slug);
	const [read, stats] = await Promise.all([
		readTextFile(projectManifestFile(slug), storeOptions).then(text =>
			readCanonicalDocument<ProjectManifestPayload>(PROJECT_MANIFEST_FORMAT, text)
		),
		statFilesUnder(root, storeOptions),
	]);
	if (!read.ok) throw new Error(`Project manifest is invalid: ${read.quarantine.message}`);
	const teiHeads = new Set([
		...read.payload.transcriptions
			.filter(head => documentStorageOfPath(head.primary_path) === 'tei')
			.map(head => `transcription:${head.project_transcription_id}`),
		...read.payload.collations
			.filter(head => documentStorageOfPath(head.primary_path) === 'tei')
			.map(head => `collation:${head.collation_id}`),
	]);
	const files: Array<CanonicalFile & { stat: StoreFileStat }> = [];
	for (const [storePath, stat] of stats) {
		const path = storePath.slice(root.length + 1);
		if (documentStorageOfPath(path) !== 'tei') continue;
		const file = classifyDocumentPath(path);
		if (!file || !teiHeads.has(`${file.kind}:${file.entityId}`)) continue;
		const base = { path, storePath, stat, kind: file.kind, documentId: file.entityId };
		if (file.role === 'unlisted')
			files.push({ ...base, entityType: file.kind, entityId: file.entityId });
		else if (file.role === 'version' && file.versionId)
			files.push({ ...base, entityType: 'version', entityId: file.versionId });
	}
	return files;
}

async function reindexCurrent(
	db: DbExecutor,
	projectId: string,
	file: StatedFile,
	xml: string,
	fileHash: string
): Promise<void> {
	const payload = parseTranscriptionTei(xml);
	if (payload.project_transcription_id !== file.documentId)
		throw identityError(
			`Transcription TEI identity ${payload.project_transcription_id} does not match ${file.path}.`
		);
	const rows = transcriptionIndexRowsFromPrimary(projectId, payload);
	const fingerprint = documentFingerprintRow(
		{
			path: file.path,
			entityType: 'transcription',
			entityId: file.entityId,
			xml,
			fileHash,
			contentHash: await teiContentHash(xml),
		},
		file.stat.lastModified
	);
	await inTransaction(db, async trx => {
		const existing = await trx
			.selectFrom('project_transcriptions')
			.select('transcription_id')
			.where('id', '=', file.documentId)
			.executeTakeFirst();
		if (existing && existing.transcription_id !== payload.id)
			throw identityError(
				`Transcription TEI id ${payload.id} does not match indexed ${existing.transcription_id}.`
			);
		if (!existing) {
			await trx.insertInto('transcriptions').values(rows.transcription).execute();
			await trx
				.insertInto('project_transcriptions')
				.values(rows.projectTranscription)
				.execute();
		}
		await replaceTranscriptionIndexRows(trx, payload.id, rows);
		await upsertDocumentFingerprint(trx, fingerprint);
		await trx.deleteFrom('document_file_problems').where('path', '=', file.path).execute();
	});
}

async function reindexCollationCurrent(
	db: DbExecutor,
	projectId: string,
	file: StatedFile,
	xml: string,
	fileHash: string
): Promise<void> {
	const payload = parseCollationPayloadTei(xml);
	if (payload.id !== file.documentId || payload.project_id !== projectId)
		throw identityError(
			`Collation TEI identity ${payload.id} does not match ${file.path} in project ${projectId}.`
		);
	const rows = collationIndexRowsFromPayload(projectId, payload);
	const fingerprint = documentFingerprintRow(
		{
			path: file.path,
			entityType: 'collation',
			entityId: file.entityId,
			xml,
			fileHash,
			contentHash: await teiContentHash(xml),
		},
		file.stat.lastModified
	);
	await inTransaction(db, async trx => {
		const existing = await trx
			.selectFrom('collations')
			.select('id')
			.where('id', '=', payload.id)
			.executeTakeFirst();
		if (!existing) await trx.insertInto('collations').values(rows.collation).execute();
		await replaceCollationIndexRows(trx, rows);
		await saveCollationProjection(trx, {
			collationId: payload.id,
			...buildCollationProjectionFromDocument(payload.document),
		});
		await upsertDocumentFingerprint(trx, fingerprint);
		await trx.deleteFrom('document_file_problems').where('path', '=', file.path).execute();
	});
}

type ParsedCollationVersion = Awaited<ReturnType<typeof parseCollationVersion>>;

async function parseCollationVersion(file: StatedFile, xml: string, fileHash: string) {
	const { payload, version } = parseCollationTeiVersion(xml);
	if (!version || version.id !== file.entityId || payload.id !== file.documentId)
		throw identityError(
			`Collation Version file does not record Version ${file.entityId} of ${file.documentId}.`
		);
	const contentHash = await teiContentHash(xml);
	return {
		file,
		row: {
			id: version.id,
			collation_id: payload.id,
			parent_checkpoint_id: version.parent_id,
			content_hash: contentHash,
			is_committed: 1,
			label: version.label,
			commit_message: version.note,
			author_name: version.author_name,
			created_at: version.created_at,
		},
		fingerprint: documentFingerprintRow(
			{
				path: file.path,
				entityType: 'version',
				entityId: version.id,
				xml,
				fileHash,
				contentHash,
			},
			file.stat.lastModified
		),
	};
}

async function indexCollationVersions(
	db: DbExecutor,
	versions: ParsedCollationVersion[],
	report: DocumentFileRefreshReport
): Promise<void> {
	if (versions.length === 0) return;
	const collationIds = [...new Set(versions.map(version => version.row.collation_id))];
	const indexed = new Set(
		(
			await db.selectFrom('collations').select('id').where('id', 'in', collationIds).execute()
		).map(row => row.id)
	);
	const existing = await db
		.selectFrom('collation_checkpoints')
		.selectAll()
		.where('collation_id', 'in', collationIds)
		.execute();
	const incoming = new Set(versions.map(version => version.row.id));
	const labels = new Map(
		collationIds.flatMap(collationId =>
			numberUnlabelledVersions([
				...existing.filter(
					row => row.collation_id === collationId && !incoming.has(row.id ?? '')
				),
				...versions
					.map(version => version.row)
					.filter(row => row.collation_id === collationId),
			]).map(row => [row.id, row.label] as const)
		)
	);
	const byDate = [...versions].sort((left, right) =>
		left.row.created_at.localeCompare(right.row.created_at)
	);
	await inTransaction(db, async trx => {
		for (const { file, row, fingerprint } of byDate) {
			if (!indexed.has(row.collation_id)) continue;
			const values = { ...row, label: labels.get(row.id) ?? row.label };
			const { id: _id, ...update } = values;
			await trx
				.insertInto('collation_checkpoints')
				.values(values)
				.onConflict(oc => oc.column('id').doUpdateSet(update))
				.execute();
			await upsertDocumentFingerprint(trx, fingerprint);
			await trx.deleteFrom('document_file_problems').where('path', '=', file.path).execute();
			report.reindexedPaths.push(file.path);
		}
	});
}

type ParsedVersion = Awaited<ReturnType<typeof parseVersion>>;

async function parseVersion(file: StatedFile, xml: string, fileHash: string) {
	parseTranscriptionTei(xml);
	const header = parseTranscriptionTeiVersion(xml);
	const version = header.version;
	if (
		!version ||
		version.id !== file.entityId ||
		header.projectTranscriptionId !== file.documentId
	)
		throw identityError(
			`Transcription Version file does not record Version ${file.entityId} of ${file.documentId}.`
		);
	const contentHash = await teiContentHash(xml);
	return {
		file,
		row: {
			id: version.id,
			transcription_id: header.transcriptionId,
			parent_checkpoint_id: version.parent_id,
			format: header.contentFormat,
			content_hash: contentHash,
			is_committed: 1,
			label: version.label,
			commit_message: version.note,
			author_name: version.author_name,
			created_at: version.created_at,
		},
		fingerprint: documentFingerprintRow(
			{
				path: file.path,
				entityType: 'version',
				entityId: version.id,
				xml,
				fileHash,
				contentHash,
			},
			file.stat.lastModified
		),
	};
}

async function indexVersions(
	db: DbExecutor,
	versions: ParsedVersion[],
	report: DocumentFileRefreshReport
): Promise<void> {
	if (versions.length === 0) return;
	const transcriptionIds = [...new Set(versions.map(version => version.row.transcription_id))];
	const indexed = new Set(
		(
			await db
				.selectFrom('transcriptions')
				.select('id')
				.where('id', 'in', transcriptionIds)
				.execute()
		).map(row => row.id)
	);
	const existing = await db
		.selectFrom('transcription_checkpoints')
		.selectAll()
		.where('transcription_id', 'in', transcriptionIds)
		.execute();
	const incoming = new Set(versions.map(version => version.row.id));
	const labels = new Map(
		transcriptionIds.flatMap(transcriptionId =>
			numberUnlabelledVersions([
				...existing.filter(
					row => row.transcription_id === transcriptionId && !incoming.has(row.id ?? '')
				),
				...versions
					.map(version => version.row)
					.filter(row => row.transcription_id === transcriptionId),
			]).map(row => [row.id, row.label] as const)
		)
	);
	// Parents first, so a new Version's parent row exists when it is inserted.
	const byDate = [...versions].sort((left, right) =>
		left.row.created_at.localeCompare(right.row.created_at)
	);
	await inTransaction(db, async trx => {
		for (const { file, row, fingerprint } of byDate) {
			if (!indexed.has(row.transcription_id)) continue;
			const values = { ...row, label: labels.get(row.id) ?? row.label };
			const { id: _id, ...update } = values;
			await trx
				.insertInto('transcription_checkpoints')
				.values(values)
				.onConflict(oc => oc.column('id').doUpdateSet(update))
				.execute();
			await upsertDocumentFingerprint(trx, fingerprint);
			await trx.deleteFrom('document_file_problems').where('path', '=', file.path).execute();
			report.reindexedPaths.push(file.path);
		}
	});
}

async function recordProblem(
	db: DbExecutor,
	projectId: string,
	file: StatedFile,
	error: unknown
): Promise<void> {
	const row: Insertable<DocumentFileProblems> = {
		path: file.path,
		project_id: projectId,
		entity_type: file.entityType,
		entity_id: file.entityId,
		code: error instanceof IdentityError ? 'invalid_shape' : 'invalid_tei',
		message: error instanceof Error ? error.message : String(error),
		size: file.stat.size,
		last_modified: file.stat.lastModified,
		detected_at: new Date().toISOString(),
	};
	const { path: _path, ...update } = row;
	await db
		.insertInto('document_file_problems')
		.values(row)
		.onConflict(oc => oc.column('path').doUpdateSet(update))
		.execute();
}

class IdentityError extends Error {}

function identityError(message: string): IdentityError {
	return new IdentityError(message);
}

function sameStat(
	recorded: { size: number; last_modified: number } | undefined,
	stat: StoreFileStat
): boolean {
	return recorded?.size === stat.size && recorded.last_modified === stat.lastModified;
}

async function loadFingerprints(db: DbExecutor, files: CanonicalFile[]) {
	const rows = new Map<string, DocumentFileFingerprints>();
	const paths = files.map(file => file.path);
	for (let start = 0; start < paths.length; start += 500) {
		const chunk = await db
			.selectFrom('document_file_fingerprints')
			.selectAll()
			.where('path', 'in', paths.slice(start, start + 500))
			.execute();
		for (const row of chunk) if (row.path) rows.set(row.path, row);
	}
	return rows;
}

async function loadProblems(db: DbExecutor, projectId: string) {
	const rows = await db
		.selectFrom('document_file_problems')
		.selectAll()
		.where('project_id', '=', projectId)
		.execute();
	return new Map(rows.map(row => [row.path ?? '', row]));
}
