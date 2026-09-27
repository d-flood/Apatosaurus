import type { PreparedWitness } from './collation-runner';
import type { WitnessConfig, WitnessSourceToken, WitnessTreatment } from './collation-types';

export function cloneWitnessSourceTokens(
	tokens: WitnessSourceToken[] | undefined
): WitnessSourceToken[] {
	return (tokens ?? []).map(token => ({
		...token,
		segments: token.segments.map(segment => ({ ...segment })),
		gap: token.gap ? { ...token.gap } : null,
	}));
}

function normalizeConcreteWitnessTreatment(treatment: WitnessTreatment): 'full' | 'fragmentary' {
	return treatment === 'full' ? 'full' : 'fragmentary';
}

export function buildWitnessSourceKey(source: {
	transcriptionId: string;
	handId?: string;
	kind?: WitnessConfig['kind'];
}): string {
	return `${source.transcriptionId}::${source.kind ?? 'firsthand'}::${source.handId ?? 'firsthand'}`;
}

export function ensureBaseTextSelection(configs: WitnessConfig[]): WitnessConfig[] {
	if (configs.length === 0) return configs;
	if (configs.some(witness => witness.isBaseText)) return configs;
	return configs.map((witness, index) => ({
		...witness,
		isBaseText: index === 0,
	}));
}

export function applyWitnessTreatmentSource(
	witness: WitnessConfig,
	treatments: Map<string, WitnessTreatment>
): WitnessConfig {
	const kind = witness.kind ?? 'firsthand';
	if (kind !== 'corrector') {
		const fullTokens = cloneWitnessSourceTokens(witness.fullTokens ?? witness.tokens);
		const fullContent = witness.fullContent ?? witness.content;
		return {
			...witness,
			kind,
			content: fullContent,
			tokens: fullTokens,
			fullContent,
			fullTokens,
			treatment: witness.treatment === 'inherit' ? 'full' : witness.treatment,
		};
	}
	const activeTreatment =
		witness.treatment === 'inherit'
			? normalizeConcreteWitnessTreatment(
					treatments.get(witness.transcriptionId) ?? 'fragmentary'
				)
			: normalizeConcreteWitnessTreatment(witness.treatment);
	const nextTokens =
		activeTreatment === 'full'
			? cloneWitnessSourceTokens(witness.fullTokens ?? witness.tokens)
			: cloneWitnessSourceTokens(witness.fragmentaryTokens ?? witness.tokens);
	const nextContent =
		activeTreatment === 'full'
			? (witness.fullContent ?? witness.content)
			: (witness.fragmentaryContent ?? witness.content);
	return {
		...witness,
		kind,
		content: nextContent,
		tokens: nextTokens,
	};
}

export function buildWitnessConfigFromPrepared(
	prepared: PreparedWitness,
	treatments: Map<string, WitnessTreatment>,
	options?: { isBaseText?: boolean }
): WitnessConfig {
	return applyWitnessTreatmentSource(
		{
			witnessId: prepared.id,
			siglum: prepared.siglum,
			transcriptionId: prepared.transcriptionUid,
			kind: prepared.kind,
			handId: prepared.handId,
			sourceVersion: prepared.sourceVersion,
			content: prepared.content,
			tokens: cloneWitnessSourceTokens(prepared.tokens),
			fullContent: prepared.fullContent,
			fullTokens: cloneWitnessSourceTokens(prepared.fullTokens ?? prepared.tokens),
			fragmentaryContent: prepared.fragmentaryContent,
			fragmentaryTokens: cloneWitnessSourceTokens(
				prepared.fragmentaryTokens ?? prepared.tokens
			),
			treatment: prepared.kind === 'corrector' ? 'inherit' : 'full',
			isBaseText: options?.isBaseText === true,
			isExcluded: false,
			overridesDefault: false,
		},
		treatments
	);
}

export function didPreparedWitnessChangeSource(
	witness: WitnessConfig,
	prepared: PreparedWitness
): boolean {
	if ((witness.kind ?? 'firsthand') !== prepared.kind) return true;
	if ((witness.handId ?? 'firsthand') !== prepared.handId) return true;
	if (witness.siglum !== prepared.siglum) return true;
	if ((witness.sourceVersion ?? '') !== prepared.sourceVersion) return true;
	if ((witness.fullContent ?? witness.content) !== (prepared.fullContent ?? prepared.content))
		return true;
	if ((witness.fragmentaryContent ?? '') !== (prepared.fragmentaryContent ?? '')) return true;
	if (
		JSON.stringify(witness.fullTokens ?? witness.tokens) !==
		JSON.stringify(prepared.fullTokens ?? prepared.tokens)
	) {
		return true;
	}
	return (
		JSON.stringify(witness.fragmentaryTokens ?? []) !==
		JSON.stringify(prepared.fragmentaryTokens ?? [])
	);
}
