import type { CoherenceSettings } from '@apatosaurus/open-cbgm-wasm';
import { resolve } from '$app/paths';

import {
	completeCbgmCoherence,
	createCbgmAnalysis,
	deleteCbgmAnalysis,
	failCbgmCoherence,
	findCbgmAnalysis,
	loadCbgmCollationSnapshots,
} from '$lib/db/client';
import { requestPersistentStorageForMeaningfulWrite } from '$lib/shell/capabilities';
import { notificationCenter } from '$lib/shell/notification-center.svelte';
import type { CbgmAnalysisMetadata, CbgmAnalysisSettings } from '$lib/storage/formats';
import { phaseLabel } from './cbgm-analysis-labels';
import { buildCbgmInput } from './cbgm-input';
import { cbgmScheduler, type CbgmScheduler, type ComputationPhase } from './cbgm-scheduler.svelte';

export type StartCbgmAnalysisRequest = {
	projectId: string;
	name: string;
	collationIds: string[];
	settings: CoherenceSettings;
	notifyOs: boolean;
};

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

export function recomputePrefill(
	analysis: CbgmAnalysisMetadata,
	deletedCollationIds: readonly string[],
	today = new Date()
): CbgmAnalysisPrefill {
	const { settings } = analysis;
	const date = [today.getFullYear(), today.getMonth() + 1, today.getDate()]
		.map(part => String(part).padStart(2, '0'))
		.join('-');
	return {
		name: `${analysis.name} ${date}`,
		collationIds: analysis.collations
			.map(collation => collation.collation_id)
			.filter(id => !deletedCollationIds.includes(id)),
		settings: {
			minExtantUnits: settings.min_extant_units,
			minExtantProportion: settings.min_extant_proportion,
			excludedWitnesses: [...settings.excluded_witnesses],
			classicRules: settings.classic_rules,
			mergeSplitReadings: settings.merge_split_readings,
			droppedReadingTypes: [...settings.dropped_reading_types],
			includedCorrectors: [...settings.included_correctors],
		},
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
		settings
	);
	if (input.tei === null) {
		throw new Error('Units without a lemma reading block this analysis.');
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
		coherence: 'computing',
	});
	void requestPersistentStorageForMeaningfulWrite();
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

export function persistCbgmComputations(
	scheduler: Pick<CbgmScheduler, 'onComplete' | 'onFailure'>
): void {
	scheduler.onComplete(async ({ analysisId, projectId, phase, cache, notifyOs }) => {
		if (phase !== 'coherence') {
			throw new Error(`Finished CBGM ${phase} computations cannot be saved yet.`);
		}
		const analysis = await completeCbgmCoherence(projectId, analysisId, cache);
		announce({ analysisId, name: analysis.name, phase, notifyOs, failure: null });
	});
	scheduler.onFailure(async ({ analysisId, projectId, phase, message, notifyOs }) => {
		const analysis =
			phase === 'coherence'
				? await failCbgmCoherence(projectId, analysisId, message)
				: await findCbgmAnalysis(analysisId);
		const name = analysis?.name ?? 'CBGM analysis';
		announce({ analysisId, name, phase, notifyOs, failure: message });
	});
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
