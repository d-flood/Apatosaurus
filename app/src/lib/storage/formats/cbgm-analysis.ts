import type { DocumentUpgrader, FormatRegistration } from '../migrate-on-read';
import type { JsonObject } from '../envelope';
import { invalidShape } from '../quarantine';
import {
	readArray,
	readBoolean,
	readNullableString,
	readObjectValue,
	readString,
	readStringArray,
} from './validation';

export const CBGM_ANALYSIS_FORMAT = 'apatosaurus.cbgm-analysis';
export const CBGM_ANALYSIS_CURRENT_VERSION = 2;
export const CBGM_ANALYSIS_ENTITY_TYPE = 'cbgm_analysis';
const cbgmAnalysisUpgraders: DocumentUpgrader[] = [upgradeCbgmAnalysisV1];

const COHERENCE_STATES = ['computing', 'awaiting-import', 'ready', 'failed'] as const;
const GLOBAL_STEMMA_STATES = ['none', 'computing', 'ready', 'imported-dot'] as const;

export type CbgmCoherenceState = (typeof COHERENCE_STATES)[number];
export type CbgmGlobalStemmaState = (typeof GLOBAL_STEMMA_STATES)[number];

export type CbgmAnalysisSettings = JsonObject & {
	min_extant_units: number | null;
	min_extant_proportion: number | null;
	excluded_witnesses: string[];
	classic_rules: boolean;
	merge_split_readings: boolean;
	dropped_reading_types: string[];
	trivial_reading_types: string[];
	included_correctors: string[];
};

export type CbgmAnalysisCollation = JsonObject & {
	collation_id: string;
	content_hash: string;
	segment_name: string;
};

export type CbgmUndecidedReading = JsonObject & { unit: string; reading: string };

export type CbgmComputingDevice = JsonObject & { device_id: string; author_name: string };

export type CbgmAnalysisMetadata = JsonObject & {
	id: string;
	project_id: string;
	name: string;
	inputs_frozen_at: string;
	completed_at: string | null;
	settings: CbgmAnalysisSettings;
	collations: CbgmAnalysisCollation[];
	witnesses: string[];
	undecided_readings: CbgmUndecidedReading[];
	input_tei_hash: string;
	cache_hash: string | null;
	coherence: CbgmCoherenceState;
	global_stemma: CbgmGlobalStemmaState;
	computing_device: CbgmComputingDevice | null;
	failure: string | null;
};

function validateCbgmAnalysisMetadata(payload: JsonObject): CbgmAnalysisMetadata {
	const record = payload as Record<string, unknown>;
	const computingDevice =
		record.computing_device === null
			? null
			: readObjectValue(record.computing_device, 'computing_device');
	return {
		id: readString(record, 'id'),
		project_id: readString(record, 'project_id'),
		name: readString(record, 'name'),
		inputs_frozen_at: readString(record, 'inputs_frozen_at'),
		completed_at: readNullableString(record, 'completed_at'),
		settings: readSettings(readObjectValue(record.settings, 'settings')),
		collations: readArray(record, 'collations').map((entry, index) => {
			const collation = readObjectValue(entry, `collations[${index}]`);
			return {
				collation_id: readString(collation, 'collation_id'),
				content_hash: readString(collation, 'content_hash'),
				segment_name: readString(collation, 'segment_name'),
			};
		}),
		witnesses: readStringArray(record, 'witnesses'),
		undecided_readings: readArray(record, 'undecided_readings').map((entry, index) => {
			const reading = readObjectValue(entry, `undecided_readings[${index}]`);
			return { unit: readString(reading, 'unit'), reading: readString(reading, 'reading') };
		}),
		input_tei_hash: readString(record, 'input_tei_hash'),
		cache_hash: readNullableString(record, 'cache_hash'),
		coherence: readState(record, 'coherence', COHERENCE_STATES),
		global_stemma: readState(record, 'global_stemma', GLOBAL_STEMMA_STATES),
		computing_device: computingDevice && {
			device_id: readString(computingDevice, 'device_id'),
			author_name: readString(computingDevice, 'author_name'),
		},
		failure: readNullableString(record, 'failure'),
	};
}

function readSettings(settings: Record<string, unknown>): CbgmAnalysisSettings {
	return {
		min_extant_units: readNullableNumber(settings, 'min_extant_units'),
		min_extant_proportion: readNullableNumber(settings, 'min_extant_proportion'),
		excluded_witnesses: readStringArray(settings, 'excluded_witnesses'),
		classic_rules: readBoolean(settings, 'classic_rules'),
		merge_split_readings: readBoolean(settings, 'merge_split_readings'),
		dropped_reading_types: readStringArray(settings, 'dropped_reading_types'),
		trivial_reading_types: readStringArray(settings, 'trivial_reading_types'),
		included_correctors: readStringArray(settings, 'included_correctors'),
	};
}

function upgradeCbgmAnalysisV1(payload: JsonObject): JsonObject {
	const settings = readObjectValue(payload.settings, 'settings') as JsonObject;
	return { ...payload, settings: { ...settings, trivial_reading_types: [] } };
}

function readNullableNumber(record: Record<string, unknown>, key: string): number | null {
	const value = record[key];
	if (value === null) return null;
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw invalidShape(`${key} must be a finite number or null.`);
	}
	return value;
}

function readState<T extends string>(
	record: Record<string, unknown>,
	key: string,
	states: readonly T[]
): T {
	const value = readString(record, key);
	if (!states.includes(value as T)) {
		throw invalidShape(`${key} must be one of ${states.join(', ')}.`);
	}
	return value as T;
}

export const cbgmAnalysisFormatRegistration: FormatRegistration<CbgmAnalysisMetadata> = {
	format: CBGM_ANALYSIS_FORMAT,
	currentVersion: CBGM_ANALYSIS_CURRENT_VERSION,
	upgraders: cbgmAnalysisUpgraders,
	validate: validateCbgmAnalysisMetadata,
};
