import type { CoherenceSettings } from '@apatosaurus/open-cbgm-wasm';
import { resolve } from '$app/paths';

import {
	clearEditingPresence,
	completeCbgmCoherence,
	createCbgmAnalysis,
	deleteCbgmAnalysis,
	failCbgmCoherence,
	failCbgmGlobalStemma,
	loadCbgmCollationSnapshots,
	getProject,
	readCbgmAnalysisCache,
	readCbgmAnalysisInputTei,
	setCbgmGlobalStemmaState,
	writeEditingPresence,
} from '$lib/db/client';
import { parseProjectCollationSettings } from '$lib/collation/project-settings';
import { requestPersistentStorageForMeaningfulWrite } from '$lib/shell/capabilities';
import { notificationCenter } from '$lib/shell/notification-center.svelte';
import type { CbgmAnalysisMetadata, CbgmAnalysisSettings } from '$lib/storage/formats';
import { phaseLabel } from './cbgm-analysis-labels';
import { buildCbgmInput } from './cbgm-input';
import { cbgmScheduler, type CbgmScheduler, type ComputationPhase } from './cbgm-scheduler.svelte';
import type { CbgmWorkerRequest, CbgmWorkerResponse } from './cbgm-worker-types';

const PRESENCE_REFRESH_MS = 60_000;

export type StartCbgmAnalysisRequest = {
	projectId: string;
	name: string;
	collationIds: string[];
	settings: CoherenceSettings;
	notifyOs: boolean;
	native: boolean;
};

export type CbgmNativeImport = { cache: Uint8Array; globalStemmaDot: string | null };

export type CbgmAnalysisPrefill = {
	name: string;
	collationIds: string[];
	settings: CoherenceSettings;
};

export function analysisSettings(settings: CoherenceSettings): CbgmAnalysisSettings {
	return {
		min_extant_units: settings.minExtantUnits,
		min_extant_proportion: settings.minExtantProportion,
		excluded_witnesses: settings.excludedWitnesses,
		classic_rules: settings.classicRules,
		merge_split_readings: settings.mergeSplitReadings,
		dropped_reading_types: settings.droppedReadingTypes,
		included_correctors: settings.includedCorrectors,
	};
}

export function coherenceSettings(settings: CbgmAnalysisSettings): CoherenceSettings {
	return {
		minExtantUnits: settings.min_extant_units,
		minExtantProportion: settings.min_extant_proportion,
		excludedWitnesses: [...settings.excluded_witnesses],
		classicRules: settings.classic_rules,
		mergeSplitReadings: settings.merge_split_readings,
		droppedReadingTypes: [...settings.dropped_reading_types],
		includedCorrectors: [...settings.included_correctors],
	};
}

export function recomputePrefill(
	analysis: CbgmAnalysisMetadata,
	deletedCollationIds: readonly string[],
	today = new Date()
): CbgmAnalysisPrefill {
	const date = [today.getFullYear(), today.getMonth() + 1, today.getDate()]
		.map(part => String(part).padStart(2, '0'))
		.join('-');
	return {
		name: `${analysis.name} ${date}`,
		collationIds: analysis.collations
			.map(collation => collation.collation_id)
			.filter(id => !deletedCollationIds.includes(id)),
		settings: coherenceSettings(analysis.settings),
	};
}

export async function deleteAnalysis(
	projectId: string,
	analysisId: string,
	scheduler: CbgmScheduler = cbgmScheduler
): Promise<void> {
	await scheduler.cancel(analysisId);
	await deleteCbgmAnalysis(projectId, analysisId);
}

export async function startCbgmAnalysis(
	request: StartCbgmAnalysisRequest,
	scheduler: CbgmScheduler = cbgmScheduler
): Promise<CbgmAnalysisMetadata> {
	const { projectId, settings } = request;
	const { collations, unavailable } = await loadCbgmCollationSnapshots(
		projectId,
		request.collationIds
	);
	if (unavailable.length > 0) {
		throw new Error(
			unavailable.map(({ title, message }) => `${title} is unavailable: ${message}`).join(' ')
		);
	}
	const input = buildCbgmInput(
		collations.map(collation => collation.document),
		settings,
		parseProjectCollationSettings((await getProject(projectId))?.collationSettings ?? null)
			.manualWitnesses ?? []
	);
	if (input.tei === null) {
		throw new Error(
			'Units without a lemma or with unrecorded full manual witnesses block this analysis.'
		);
	}
	const analysis = await createCbgmAnalysis(projectId, {
		name: request.name,
		settings: analysisSettings(settings),
		collations: collations.map(collation => ({
			collation_id: collation.collationId,
			content_hash: collation.contentHash,
			segment_name: collation.segmentName,
		})),
		witnesses: input.witnesses,
		undecidedReadings: input.undecidedReadings,
		inputTei: input.tei,
		coherence: request.native ? 'awaiting-import' : 'computing',
	});
	void requestPersistentStorageForMeaningfulWrite();
	if (request.native) return analysis;
	scheduler.enqueue({
		analysisId: analysis.id,
		projectId,
		phase: 'coherence',
		inputTei: input.tei,
		settings,
		notifyOs: request.notifyOs,
	});
	return analysis;
}

export async function startGlobalStemma(
	analysis: CbgmAnalysisMetadata,
	notifyOs: boolean,
	scheduler: Pick<CbgmScheduler, 'enqueue'> = cbgmScheduler
): Promise<void> {
	const { id: analysisId, project_id: projectId } = analysis;
	const cache = await readCbgmAnalysisCache(analysisId);
	if (!cache) throw new Error('This analysis has no coherence results yet.');
	await setCbgmGlobalStemmaState(projectId, analysisId, 'computing');
	void requestPersistentStorageForMeaningfulWrite();
	scheduler.enqueue({
		analysisId,
		projectId,
		phase: 'global-stemma',
		cache,
		settings: coherenceSettings(analysis.settings),
		notifyOs,
	});
	publishPresence(projectId, analysisId);
}

export async function cancelGlobalStemma(
	analysis: CbgmAnalysisMetadata,
	scheduler: Pick<CbgmScheduler, 'cancel'> = cbgmScheduler
): Promise<void> {
	await scheduler.cancel(analysis.id);
	await setCbgmGlobalStemmaState(analysis.project_id, analysis.id, 'none');
	withdrawPresence(analysis.project_id, analysis.id);
}

export async function importNativeResults(
	analysis: CbgmAnalysisMetadata,
	files: CbgmNativeImport,
	scheduler: Pick<CbgmScheduler, 'cancel'> = cbgmScheduler
): Promise<void> {
	const { id: analysisId, project_id: projectId } = analysis;
	const mismatch = await checkNativeCache({
		type: 'check-native-cache',
		inputTei: await readCbgmAnalysisInputTei(analysisId),
		settings: coherenceSettings(analysis.settings),
		cache: files.cache,
	});
	if (mismatch) throw new Error(`This database doesn't match the analysis. ${mismatch}`);
	await scheduler.cancel(analysisId);
	await completeCbgmCoherence(projectId, analysisId, files.cache);
	if (files.globalStemmaDot !== null) {
		await setCbgmGlobalStemmaState(
			projectId,
			analysisId,
			'imported-dot',
			undefined,
			files.globalStemmaDot
		);
	} else {
		await setCbgmGlobalStemmaState(projectId, analysisId, 'none');
	}
	withdrawPresence(projectId, analysisId);
	void requestPersistentStorageForMeaningfulWrite();
}

function checkNativeCache(
	request: Extract<CbgmWorkerRequest, { type: 'check-native-cache' }>
): Promise<string | null> {
	const worker = new Worker(new URL('./cbgm.worker.ts', import.meta.url), { type: 'module' });
	return new Promise<string | null>((resolve, reject) => {
		worker.onmessage = ({ data }: MessageEvent<CbgmWorkerResponse>) => {
			if (data.ok) resolve(data.result as string | null);
			else reject(new Error(data.error));
		};
		worker.onerror = event => reject(new Error(event.message || 'CBGM worker failed.'));
		worker.postMessage(request);
	}).finally(() => worker.terminate());
}

export function persistCbgmComputations(
	scheduler: Pick<CbgmScheduler, 'onComplete' | 'onFailure'>
): void {
	scheduler.onComplete(async ({ analysisId, projectId, phase, cache, notifyOs }) => {
		const analysis =
			phase === 'coherence'
				? await completeCbgmCoherence(projectId, analysisId, cache)
				: await setCbgmGlobalStemmaState(projectId, analysisId, 'ready', cache);
		if (phase === 'global-stemma') withdrawPresence(projectId, analysisId);
		announce({ analysisId, name: analysis.name, phase, notifyOs, failure: null });
	});
	scheduler.onFailure(async ({ analysisId, projectId, phase, message, notifyOs }) => {
		const analysis =
			phase === 'coherence'
				? await failCbgmCoherence(projectId, analysisId, message)
				: await failCbgmGlobalStemma(projectId, analysisId, message);
		if (phase === 'global-stemma') withdrawPresence(projectId, analysisId);
		announce({ analysisId, name: analysis.name, phase, notifyOs, failure: message });
	});
}

export function refreshCbgmPresence(scheduler: Pick<CbgmScheduler, 'progress'>): void {
	setInterval(() => {
		const progress = scheduler.progress;
		if (progress?.phase === 'global-stemma' && progress.state === 'running') {
			publishPresence(progress.projectId, progress.analysisId);
		}
	}, PRESENCE_REFRESH_MS);
}

function publishPresence(projectId: string, analysisId: string): void {
	void writeEditingPresence(projectId, analysisId).catch(error =>
		console.warn('[presence] write failed', error)
	);
}

function withdrawPresence(projectId: string, analysisId: string): void {
	void clearEditingPresence(projectId, analysisId).catch(error =>
		console.warn('[presence] clear failed', error)
	);
}

function announce({
	analysisId,
	name,
	phase,
	notifyOs,
	failure,
}: {
	analysisId: string;
	name: string;
	phase: ComputationPhase;
	notifyOs: boolean;
	failure: string | null;
}): void {
	const id = `cbgm:${analysisId}:${phase}`;
	const title = `CBGM ${phaseLabel(phase).toLowerCase()} ${failure === null ? 'finished' : 'failed'}`;
	const message =
		failure === null
			? `${phaseLabel(phase)} for ${name} is ready.`
			: `${phaseLabel(phase)} for ${name} failed: ${failure}`;
	notificationCenter.upsert({
		id,
		title,
		message,
		tone: failure === null ? 'success' : 'error',
		actions: [
			{
				id: 'open',
				label: 'Open analysis',
				variant: 'primary',
				href: resolve('/cbgm/[analysisId]', { analysisId }),
			},
		],
	});
	if (notifyOs) void sendOsNotification(id, title, message);
}

async function sendOsNotification(tag: string, title: string, body: string): Promise<void> {
	if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
	try {
		const registration = await navigator.serviceWorker?.getRegistration();
		if (registration) await registration.showNotification(title, { body, tag });
		else new Notification(title, { body, tag });
	} catch (error) {
		console.error('[cbgm] OS notification failed', error);
	}
}
