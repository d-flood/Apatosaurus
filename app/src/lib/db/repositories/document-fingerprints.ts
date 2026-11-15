import type { Insertable } from 'kysely';

import { joinStorePath, projectFolder } from '$lib/storage/layout';
import { statFile, writeTextFileAtomic, type StoreOperationOptions } from '$lib/storage/opfs-store';
import type { StoreQuarantineCode } from '$lib/storage/quarantine';
import type { DocumentFileFingerprints, DocumentFileProblems } from '../types.generated';
import type { DbExecutor } from '../worker-kysely';

export type DocumentFingerprintEntityType = 'transcription' | 'collation' | 'version';

export interface DocumentFileProblem {
	path: string;
	projectId: string;
	entityType: DocumentFingerprintEntityType;
	entityId: string;
	code: StoreQuarantineCode;
	message: string;
	detectedAt: string;
}

export class DocumentFileProblemError extends Error {
	constructor(readonly problem: DocumentFileProblem) {
		super(
			`Saving is blocked: ${problem.path} was changed outside the app and no longer parses (${problem.message}). Fix the file, then reopen the project.`
		);
		this.name = 'DocumentFileProblemError';
	}
}

export interface TeiFileWrite {
	projectSlug: string;
	path: string;
	entityType: DocumentFingerprintEntityType;
	entityId: string;
	xml: string;
	fileHash: string;
	contentHash: string;
}

export async function writeTeiFile(
	write: TeiFileWrite,
	storeOptions: StoreOperationOptions
): Promise<Insertable<DocumentFileFingerprints>> {
	const storePath = joinStorePath(projectFolder(write.projectSlug), write.path);
	await writeTextFileAtomic(storePath, write.xml, storeOptions);
	return documentFingerprintRow(write, (await statFile(storePath, storeOptions)).lastModified);
}

export function documentFingerprintRow(
	write: Omit<TeiFileWrite, 'projectSlug'>,
	lastModified: number
): Insertable<DocumentFileFingerprints> {
	return {
		path: write.path,
		entity_type: write.entityType,
		entity_id: write.entityId,
		size: new TextEncoder().encode(write.xml).byteLength,
		last_modified: lastModified,
		file_hash: write.fileHash,
		content_hash: write.contentHash,
	};
}

export async function upsertDocumentFingerprint(
	db: DbExecutor,
	row: Insertable<DocumentFileFingerprints>
): Promise<void> {
	const { path: _path, ...update } = row;
	await db
		.insertInto('document_file_fingerprints')
		.values(row)
		.onConflict(oc => oc.column('path').doUpdateSet(update))
		.execute();
}

export async function getTranscriptionContentHash(
	db: DbExecutor,
	projectTranscriptionId: string
): Promise<string | null> {
	const row = await db
		.selectFrom('document_file_fingerprints')
		.select('content_hash')
		.where('entity_type', '=', 'transcription')
		.where('entity_id', '=', projectTranscriptionId)
		.executeTakeFirst();
	return row?.content_hash ?? null;
}

export async function getCollationContentHash(
	db: DbExecutor,
	collationId: string
): Promise<string | null> {
	const row = await db
		.selectFrom('document_file_fingerprints')
		.select('content_hash')
		.where('entity_type', '=', 'collation')
		.where('entity_id', '=', collationId)
		.executeTakeFirst();
	return row?.content_hash ?? null;
}

export async function assertNoDocumentFileProblem(db: DbExecutor, path: string): Promise<void> {
	const row = await db
		.selectFrom('document_file_problems')
		.selectAll()
		.where('path', '=', path)
		.executeTakeFirst();
	if (row) throw new DocumentFileProblemError(problemFromRow(row));
}

export function problemFromRow(row: DocumentFileProblems): DocumentFileProblem {
	return {
		path: row.path ?? '',
		projectId: row.project_id,
		entityType: row.entity_type as DocumentFingerprintEntityType,
		entityId: row.entity_id,
		code: row.code as StoreQuarantineCode,
		message: row.message,
		detectedAt: row.detected_at,
	};
}
