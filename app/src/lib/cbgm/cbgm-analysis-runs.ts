import type { CoherenceSettings } from '@apatosaurus/open-cbgm-wasm';

import {
	completeCbgmCoherence,
	createCbgmAnalysis,
	failCbgmCoherence,
	loadCbgmCollationSnapshots,
} from '$lib/db/client';
import { requestPersistentStorageForMeaningfulWrite } from '$lib/shell/capabilities';
import type { CbgmAnalysisMetadata, CbgmAnalysisSettings } from '$lib/storage/formats';
import { buildCbgmInput } from './cbgm-input';
import { cbgmScheduler, type CbgmScheduler } from './cbgm-scheduler.svelte';

export type StartCbgmAnalysisRequest = {
	projectId: string;
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
		notifyOs: false,
	});
	return analysis;
}

export function persistCbgmComputations(scheduler: CbgmScheduler): void {
	scheduler.onComplete(async ({ analysisId, projectId, phase, cache }) => {
		if (phase !== 'coherence') {
			throw new Error(`Finished CBGM ${phase} computations cannot be saved yet.`);
		}
		await completeCbgmCoherence(projectId, analysisId, cache);
	});
	scheduler.onFailure(async ({ analysisId, projectId, phase, message }) => {
		if (phase === 'coherence') await failCbgmCoherence(projectId, analysisId, message);
	});
}
