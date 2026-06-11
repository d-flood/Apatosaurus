import type { DbRequest, DbResponse } from './rpc';
import {
	createCollation,
	deleteCollation,
	listCollationsWithProjectNames,
	loadCollation,
	saveCollationArtifact,
	saveCollationProjection,
	updateCollationMetadata,
} from './repositories/collations';
import {
	createProject,
	getProject,
	getProjectTranscriptionIds,
	listProjects,
	listProjectTranscriptionOptions,
	loadTranscriptionContent,
	syncProjectTranscriptionIds,
	updateProjectMetadata,
} from './repositories/projects';
import {
	createTranscription,
	createTranscriptions,
	deleteTranscription,
	getTranscription,
	getTranscriptionSummary,
	getTranscriptionVersionsByIds,
	getTranscriptionsByIds,
	getVerseIndexRowsForVerse,
	listVerseIndexRowsForTranscription,
	listVerseIndexRows,
	listTranscriptionSummaries,
	rebuildVerseIndexForTranscriptions,
	updateTranscriptionContent,
} from './repositories/transcriptions';
import * as iiifRepository from './repositories/iiif';
import {
	createCommittedCollationCheckpoint,
	createCommittedTranscriptionCheckpoint,
	isCollationDirty,
	isTranscriptionDirty,
} from './repositories/revisions';
import { clearDomainTables } from './repositories/maintenance';
import {
	disconnectCloudConnection,
	listCloudConnections,
	upsertCloudConnection,
} from './repositories/cloud-connections';
import type { Database } from './types.generated';
import { createWorkerKysely } from './worker-kysely';
import { LocalSqliteDatabase } from './worker-sqlite';
import { applyLocalDbMigrations } from './worker-migrator';
import type { Kysely } from 'kysely';

const db = new LocalSqliteDatabase();
let kyselyDb: Kysely<Database> | null = null;
let initialized = false;
let requestQueue = Promise.resolve();

self.onmessage = async (event: MessageEvent<DbRequest>) => {
	const request = event.data;
	const receivedAt = now();
	requestQueue = requestQueue.then(
		() => processRequest(request, receivedAt),
		() => processRequest(request, receivedAt)
	);
};

async function processRequest(request: DbRequest, receivedAt: number): Promise<void> {
	const startedAt = now();
	const queueWaitMs = elapsed(receivedAt);
	try {
		const result = await handleRequest(request);
		logWorkerTiming(request, queueWaitMs, elapsed(startedAt));
		postResponse({ id: request.id ?? 0, ok: true, result });
	} catch (error) {
		console.error('[local-db] worker request failed', {
			type: request.type,
			id: request.id,
			queueWaitMs,
			handlerMs: elapsed(startedAt),
			error: error instanceof Error ? error.message : String(error),
		});
		postResponse({
			id: request.id ?? 0,
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function handleRequest(request: DbRequest): Promise<unknown> {
	if (request.type === 'init') {
		await init();
		return null;
	}
	await init();
	if (request.type === 'query') return db.query(request.sql, request.params ?? []);
	if (request.type === 'execute') return db.execute(request.sql, request.params ?? []);
	if (request.type === 'exec') {
		await db.exec(request.sql);
		return null;
	}
	if (request.type === 'cloudConnections.list') return listCloudConnections(getKyselyDb());
	if (request.type === 'cloudConnections.upsert') {
		const connection = await upsertCloudConnection(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'cloud-connections' });
		return connection;
	}
	if (request.type === 'cloudConnections.disconnect') {
		const disconnected = await disconnectCloudConnection(getKyselyDb(), request.connectionId);
		postMessage({ type: 'db:invalidate', domain: 'cloud-connections' });
		return disconnected;
	}
	if (request.type === 'transcriptions.listSummaries')
		return listTranscriptionSummaries(getKyselyDb());
	if (request.type === 'transcriptions.getSummary')
		return getTranscriptionSummary(getKyselyDb(), request.transcriptionId);
	if (request.type === 'transcriptions.getVersionsByIds')
		return getTranscriptionVersionsByIds(getKyselyDb(), request.ids);
	if (request.type === 'transcriptions.get')
		return getTranscription(getKyselyDb(), request.transcriptionId);
	if (request.type === 'transcriptions.getByIds')
		return getTranscriptionsByIds(getKyselyDb(), request.ids);
	if (request.type === 'transcriptions.create') {
		const id = await createTranscription(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		return id;
	}
	if (request.type === 'transcriptions.createMany') {
		const ids = await createTranscriptions(getKyselyDb(), request.inputs);
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		return ids;
	}
	if (request.type === 'transcriptions.updateContent') {
		await updateTranscriptionContent(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		return null;
	}
	if (request.type === 'transcriptions.delete') {
		await deleteTranscription(getKyselyDb(), request.transcriptionId);
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		return null;
	}
	if (request.type === 'transcriptions.getVerseIndexRowsForVerse') {
		return getVerseIndexRowsForVerse(
			getKyselyDb(),
			request.verseIdentifier,
			request.transcriptionIds
		);
	}
	if (request.type === 'transcriptions.listVerseIndexRows')
		return listVerseIndexRows(getKyselyDb());
	if (request.type === 'transcriptions.listVerseIndexRowsForTranscription') {
		return listVerseIndexRowsForTranscription(getKyselyDb(), request.transcriptionId);
	}
	if (request.type === 'transcriptions.rebuildVerseIndex') {
		const result = await rebuildVerseIndexForTranscriptions(
			getKyselyDb(),
			request.transcriptionIds
		);
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		return result;
	}
	if (request.type === 'projects.list') return listProjects(getKyselyDb());
	if (request.type === 'projects.get') return getProject(getKyselyDb(), request.projectId);
	if (request.type === 'projects.create') {
		const id = await createProject(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'projects' });
		return id;
	}
	if (request.type === 'projects.updateMetadata') {
		await updateProjectMetadata(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'projects' });
		return null;
	}
	if (request.type === 'projects.listTranscriptionOptions')
		return listProjectTranscriptionOptions(getKyselyDb(), request.projectId);
	if (request.type === 'projects.loadTranscriptionContent')
		return loadTranscriptionContent(getKyselyDb(), request.transcriptionId);
	if (request.type === 'projects.getTranscriptionIds')
		return getProjectTranscriptionIds(getKyselyDb(), request.projectId);
	if (request.type === 'projects.syncTranscriptionIds') {
		const ids = await syncProjectTranscriptionIds(
			getKyselyDb(),
			request.projectId,
			request.nextIds
		);
		postMessage({ type: 'db:invalidate', domain: 'projects' });
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return ids;
	}
	if (request.type === 'collations.listWithProjectNames')
		return listCollationsWithProjectNames(getKyselyDb());
	if (request.type === 'collations.create') {
		const id = await createCollation(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'collations' });
		return id;
	}
	if (request.type === 'collations.load')
		return loadCollation(getKyselyDb(), request.collationId);
	if (request.type === 'collations.saveArtifact') {
		const artifactId = await saveCollationArtifact(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'collations' });
		return artifactId;
	}
	if (request.type === 'collations.saveProjection') {
		await saveCollationProjection(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'collations' });
		return null;
	}
	if (request.type === 'collations.updateMetadata') {
		await updateCollationMetadata(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'collations' });
		return null;
	}
	if (request.type === 'collations.delete') {
		await deleteCollation(getKyselyDb(), request.collationId);
		postMessage({ type: 'db:invalidate', domain: 'collations' });
		return null;
	}
	if (request.type === 'iiif.listManifestSources')
		return iiifRepository.listManifestSources(getKyselyDb(), request.transcriptionId);
	if (request.type === 'iiif.listManifestSourcesForUrl')
		return iiifRepository.listManifestSourcesForUrl(
			getKyselyDb(),
			request.transcriptionId,
			request.manifestUrl
		);
	if (request.type === 'iiif.ensureManifestSource') {
		const row = await iiifRepository.ensureManifestSource(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return row;
	}
	if (request.type === 'iiif.getManifestSource')
		return iiifRepository.getManifestSource(getKyselyDb(), request.input);
	if (request.type === 'iiif.listPageCanvasLinks')
		return iiifRepository.listPageCanvasLinks(getKyselyDb(), request.transcriptionId);
	if (request.type === 'iiif.upsertPageCanvasLink') {
		const row = await iiifRepository.upsertPageCanvasLink(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return row;
	}
	if (request.type === 'iiif.savePageCanvasLinks') {
		const rows = await iiifRepository.savePageCanvasLinks(getKyselyDb(), request.inputs);
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return rows;
	}
	if (request.type === 'iiif.deletePageCanvasLink') {
		const count = await iiifRepository.deletePageCanvasLink(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return count;
	}
	if (request.type === 'iiif.deletePageCanvasLinksForPage') {
		const count = await iiifRepository.deletePageCanvasLinksForPage(
			getKyselyDb(),
			request.input
		);
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return count;
	}
	if (request.type === 'iiif.deleteAllPageCanvasLinks') {
		const count = await iiifRepository.deleteAllPageCanvasLinks(
			getKyselyDb(),
			request.transcriptionId
		);
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return count;
	}
	if (request.type === 'iiif.deleteManifestSource') {
		const deleted = await iiifRepository.deleteManifestSource(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return deleted;
	}
	if (request.type === 'iiif.deleteManifestSourceLinks') {
		const count = await iiifRepository.deleteManifestSourceLinks(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return count;
	}
	if (request.type === 'iiif.findLinkedPageForCanvas')
		return iiifRepository.findLinkedPageForCanvas(getKyselyDb(), request.input);
	if (request.type === 'iiif.listCanvasAnnotations')
		return iiifRepository.listCanvasAnnotations(getKyselyDb(), request.input);
	if (request.type === 'iiif.getCanvasAnnotation')
		return iiifRepository.getCanvasAnnotation(getKyselyDb(), request.input);
	if (request.type === 'iiif.upsertCanvasAnnotation') {
		await iiifRepository.upsertCanvasAnnotation(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return null;
	}
	if (request.type === 'iiif.deleteCanvasAnnotation') {
		await iiifRepository.deleteCanvasAnnotation(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'iiif' });
		return null;
	}
	if (request.type === 'revisions.commitTranscription') {
		const checkpoint = await createCommittedTranscriptionCheckpoint(
			getKyselyDb(),
			request.input
		);
		postMessage({ type: 'db:invalidate', domain: 'transcriptions' });
		return checkpoint;
	}
	if (request.type === 'revisions.commitCollation') {
		const checkpoint = await createCommittedCollationCheckpoint(getKyselyDb(), request.input);
		postMessage({ type: 'db:invalidate', domain: 'collations' });
		return checkpoint;
	}
	if (request.type === 'revisions.isTranscriptionDirty')
		return isTranscriptionDirty(getKyselyDb(), request.projectTranscriptionId);
	if (request.type === 'revisions.isCollationDirty')
		return isCollationDirty(getKyselyDb(), request.collationId);
	if (request.type === 'transaction') {
		await db.transaction(request.statements);
		postMessage({
			type: 'db:invalidate',
			domain: inferInvalidationDomain(request.statements.map(s => s.sql).join('\n')),
		});
		return null;
	}
	if (request.type === 'checkpoint') {
		await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
		return null;
	}
	if (request.type === 'reset') {
		await kyselyDb?.destroy();
		kyselyDb = null;
		await db.close();
		initialized = false;
		await init();
		await clearDomainTables(getKyselyDb());
		return null;
	}
	return null;
}

async function init(): Promise<void> {
	if (initialized) return;
	const startedAt = now();
	await timeWorkerStep('db.open', () => db.open());
	await timeWorkerStep('migrations', () => applyLocalDbMigrations(db));
	kyselyDb = timeWorkerStepSync('kysely init', () => createWorkerKysely(db));
	initialized = true;
	console.debug('[local-db] worker init completed', { elapsedMs: elapsed(startedAt) });
}

function getKyselyDb(): Kysely<Database> {
	if (!kyselyDb) kyselyDb = createWorkerKysely(db);
	return kyselyDb;
}

function inferInvalidationDomain(sql: string): string {
	if (/transcriptions|transcription_verse_index/i.test(sql)) return 'transcriptions';
	if (/projects|project_transcriptions/i.test(sql)) return 'projects';
	if (/collations|collation_/i.test(sql)) return 'collations';
	if (/iiif_|page_canvas/i.test(sql)) return 'iiif';
	return 'all';
}

function postResponse(response: DbResponse): void {
	postMessage(response);
}

function logWorkerTiming(request: DbRequest, queueWaitMs: number, handlerMs: number): void {
	if (request.type !== 'init' && request.type !== 'transcriptions.listSummaries') return;
	console.debug('[local-db] worker request completed', {
		type: request.type,
		id: request.id,
		queueWaitMs,
		handlerMs,
	});
}

async function timeWorkerStep<T>(label: string, step: () => Promise<T>): Promise<T> {
	const startedAt = now();
	try {
		const result = await step();
		console.debug(`[local-db] worker ${label} completed`, { elapsedMs: elapsed(startedAt) });
		return result;
	} catch (error) {
		console.error(`[local-db] worker ${label} failed`, {
			elapsedMs: elapsed(startedAt),
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

function timeWorkerStepSync<T>(label: string, step: () => T): T {
	const startedAt = now();
	try {
		const result = step();
		console.debug(`[local-db] worker ${label} completed`, { elapsedMs: elapsed(startedAt) });
		return result;
	} catch (error) {
		console.error(`[local-db] worker ${label} failed`, {
			elapsedMs: elapsed(startedAt),
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

function now(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function elapsed(startedAt: number): number {
	return Math.round(now() - startedAt);
}
