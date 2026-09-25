import type {
	ProjectCollationSettings,
	RegularizationRule,
	RegularizationType,
	SuppliedTextMode,
	WitnessTreatment,
} from './collation-types';
import { coerceReadingTypeDefinitions, type ReadingTypeDefinition } from './reading-types';

function coerceRegularizationType(value: unknown): RegularizationType {
	return value === 'ns' ? 'ns' : 'none';
}

function coerceRegularizationRule(value: unknown): RegularizationRule | null {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	if (typeof raw.id !== 'string' || typeof raw.pattern !== 'string') return null;
	return {
		id: raw.id,
		pattern: raw.pattern,
		replacement: typeof raw.replacement === 'string' ? raw.replacement : '',
		scope: raw.scope === 'project' ? 'project' : 'verse',
		description:
			typeof raw.description === 'string'
				? raw.description
				: `${raw.pattern} -> ${typeof raw.replacement === 'string' ? raw.replacement : ''}`,
		enabled: raw.enabled !== false,
		type: coerceRegularizationType(raw.type),
	};
}

export function parseProjectCollationSettings(value: unknown): ProjectCollationSettings {
	let raw: unknown = value;
	if (typeof value === 'string') {
		try {
			raw = JSON.parse(value);
		} catch {
			raw = {};
		}
	}
	if (!raw || typeof raw !== 'object') return {};
	const settings = raw as Record<string, unknown>;
	const regularizationRules = Array.isArray(settings.regularizationRules)
		? settings.regularizationRules
				.map(coerceRegularizationRule)
				.filter((rule): rule is RegularizationRule => rule !== null)
		: [];
	const transcriptionWitnessTreatments: Record<string, WitnessTreatment> | undefined =
		settings.transcriptionWitnessTreatments &&
		typeof settings.transcriptionWitnessTreatments === 'object'
			? (Object.fromEntries(
					Object.entries(
						settings.transcriptionWitnessTreatments as Record<string, unknown>
					).map(([transcriptionId, treatment]) => [
						transcriptionId,
						(treatment === 'full' ? 'full' : 'fragmentary') as WitnessTreatment,
					])
				) as Record<string, WitnessTreatment>)
			: undefined;
	const transcriptionWitnessExcludedHands: Record<string, string[]> | undefined =
		settings.transcriptionWitnessExcludedHands &&
		typeof settings.transcriptionWitnessExcludedHands === 'object'
			? (Object.fromEntries(
					Object.entries(
						settings.transcriptionWitnessExcludedHands as Record<string, unknown>
					).map(([transcriptionId, handIds]) => [
						transcriptionId,
						Array.isArray(handIds)
							? Array.from(
									new Set(
										handIds
											.filter(
												(handId): handId is string =>
													typeof handId === 'string'
											)
											.map(handId => handId.trim())
											.filter(Boolean)
									)
								)
							: [],
					])
				) as Record<string, string[]>)
			: undefined;
	return {
		regularizationRules,
		readingTypes: coerceReadingTypeDefinitions(settings.readingTypes),
		ignoreWordBreaks: settings.ignoreWordBreaks === true,
		lowercase: settings.lowercase === true,
		ignoreTokenWhitespace: settings.ignoreTokenWhitespace !== false,
		ignorePunctuation: settings.ignorePunctuation === true,
		suppliedTextMode: settings.suppliedTextMode === 'gap' ? 'gap' : 'clear',
		segmentation: settings.segmentation !== false,
		transcriptionWitnessTreatments,
		transcriptionWitnessExcludedHands,
	};
}

export function createProjectCollationSettings(
	rules: RegularizationRule[],
	options: {
		ignoreWordBreaks: boolean;
		lowercase: boolean;
		ignoreTokenWhitespace: boolean;
		ignorePunctuation: boolean;
		suppliedTextMode: SuppliedTextMode;
		segmentation: boolean;
		transcriptionWitnessTreatments: Map<string, WitnessTreatment>;
		transcriptionWitnessExcludedHands: Map<string, string[]>;
		readingTypes: ReadingTypeDefinition[];
	}
): ProjectCollationSettings {
	const settings: ProjectCollationSettings = {
		regularizationRules: rules.filter(rule => rule.scope === 'project'),
		readingTypes: options.readingTypes,
		ignoreWordBreaks: options.ignoreWordBreaks,
		lowercase: options.lowercase,
		ignoreTokenWhitespace: options.ignoreTokenWhitespace,
		ignorePunctuation: options.ignorePunctuation,
		suppliedTextMode: options.suppliedTextMode,
		segmentation: options.segmentation,
		transcriptionWitnessTreatments: Object.fromEntries(options.transcriptionWitnessTreatments),
		transcriptionWitnessExcludedHands: Object.fromEntries(
			options.transcriptionWitnessExcludedHands
		),
	};
	// Callers pass `$state` values whose proxies `postMessage` to the database worker
	// cannot clone, so detach the payload into plain data on the way out.
	return JSON.parse(JSON.stringify(settings)) as ProjectCollationSettings;
}

export function mergeProjectRules(
	existingRules: RegularizationRule[],
	projectRules: RegularizationRule[]
): RegularizationRule[] {
	const verseRules = existingRules.filter(rule => rule.scope !== 'project');
	const dedupedProjectRules = new Map(projectRules.map(rule => [rule.id, rule]));
	return [...verseRules, ...dedupedProjectRules.values()];
}
