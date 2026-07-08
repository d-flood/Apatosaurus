import type {
	GapMetadata,
	RegularizationRule,
	RegularizationType,
	RegularizedToken,
	SuppliedTextMode,
	WitnessConfig,
	WitnessSourceToken,
} from './collation-types';
import type { CollationTokenInput, CollationWitnessInput } from './collation-worker-types';
import { isPunctuationToken, joinTokenTexts } from './token-text';

export interface CollationInputSettings {
	lowercase: boolean;
	ignoreTokenWhitespace: boolean;
	ignorePunctuation: boolean;
	suppliedTextMode: SuppliedTextMode;
}

export interface CollationInputDiagnostic {
	ruleId: string;
	pattern: string;
	scope: RegularizationRule['scope'];
	code: 'invalid_regex' | 'apply_error';
	message: string;
}

export function validateRegularizationRule(rule: RegularizationRule): string | null {
	try {
		new RegExp(rule.pattern, 'gu');
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

export interface DerivedCollationInput {
	perWitnessTokens: Map<string, RegularizedToken[]>;
	witnessInputs: CollationWitnessInput[];
	diagnostics: CollationInputDiagnostic[];
	ruleEffects: RegularizationRuleEffect[];
}

export interface RegularizationRuleEffect {
	ruleId: string;
	pattern: string;
	description: string;
	scope: RegularizationRule['scope'];
	witnessId: string;
	original: string;
	before: string;
	after: string;
	changed: boolean;
}

interface CompiledRule {
	rule: RegularizationRule;
	regex: RegExp;
}

function buildGapPlaceholder(
	gap: GapMetadata | null,
	fallbackSource: GapMetadata['source']
): string {
	const meta = gap ?? { source: fallbackSource, reason: '', unit: '', extent: '' };
	return [`__${meta.source}__`, meta.reason || 'none', meta.unit || 'none', meta.extent || 'none'].join(
		':'
	);
}

function orderedEnabledRules(rules: RegularizationRule[]): RegularizationRule[] {
	const enabled = rules.filter(rule => rule.enabled);
	return [
		...enabled.filter(rule => rule.scope === 'project'),
		...enabled.filter(rule => rule.scope === 'verse'),
	];
}

function compileRules(
	rules: RegularizationRule[],
	diagnostics: CollationInputDiagnostic[]
): CompiledRule[] {
	const compiled: CompiledRule[] = [];
	for (const rule of orderedEnabledRules(rules)) {
		try {
			const error = validateRegularizationRule(rule);
			if (error) throw new Error(error);
			compiled.push({ rule, regex: new RegExp(rule.pattern, 'gu') });
		} catch (error) {
			diagnostics.push({
				ruleId: rule.id,
				pattern: rule.pattern,
				scope: rule.scope,
				code: 'invalid_regex',
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return compiled;
}

export function regularizeCollationText(
	input: string,
	rules: RegularizationRule[],
	diagnostics: CollationInputDiagnostic[] = []
): {
	regularizedText: string;
	ruleIds: string[];
	types: RegularizationType[];
} {
	return applyCompiledRules(input, compileRules(rules, diagnostics), diagnostics);
}

function applyCompiledRules(
	input: string,
	compiledRules: CompiledRule[],
	diagnostics: CollationInputDiagnostic[],
	onRuleEffect?: (rule: RegularizationRule, before: string, after: string) => void
): {
	regularizedText: string;
	ruleIds: string[];
	types: RegularizationType[];
} {
	let result = input.normalize('NFC');
	const ruleIds: string[] = [];
	const typeSet = new Set<RegularizationType>();

	for (const { rule, regex } of compiledRules) {
		try {
			regex.lastIndex = 0;
			const before = result;
			const replaced = result.replace(regex, rule.replacement);
			onRuleEffect?.(rule, before, replaced.normalize('NFC'));
			if (replaced !== result) {
				result = replaced.normalize('NFC');
				ruleIds.push(rule.id);
				if (rule.type !== 'none') typeSet.add(rule.type);
			}
		} catch (error) {
			diagnostics.push({
				ruleId: rule.id,
				pattern: rule.pattern,
				scope: rule.scope,
				code: 'apply_error',
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return {
		regularizedText: result,
		ruleIds,
		types: [...typeSet],
	};
}

function deriveToken(
	witnessId: string,
	sourceToken: WitnessSourceToken,
	settings: CollationInputSettings,
	compiledRules: CompiledRule[],
	diagnostics: CollationInputDiagnostic[],
	ruleEffects: RegularizationRuleEffect[]
): RegularizedToken | null {
	if (sourceToken.kind === 'gap' || sourceToken.kind === 'untranscribed') {
		return {
			original: sourceToken.original,
			originalSegments: sourceToken.segments.map(segment => ({ ...segment })),
			regularized: null,
			alignmentValue: buildGapPlaceholder(
				sourceToken.gap,
				sourceToken.gap?.source ?? sourceToken.kind
			),
			ruleIds: [],
			types: [],
			kind: sourceToken.kind,
			gap: sourceToken.gap,
			hasUnclear: false,
			isPunctuation: false,
			isSupplied: false,
		};
	}

	const original = sourceToken.original;
	const originalSegments = sourceToken.segments.map(segment => ({ ...segment }));
	const hasUnclear = sourceToken.segments.some(segment => segment.hasUnclear);
	const isPunctuationOnly =
		sourceToken.segments.length > 0 && sourceToken.segments.every(segment => segment.isPunctuation);
	const isSupplied = sourceToken.segments.some(segment => segment.isSupplied);

	// Derivation order is fixed: structural preprocessing first, then project rules,
	// then verse rules. Rule matching uses NFC-normalized Unicode regexes.
	let structuralText = sourceToken.segments
		.map(segment => {
			if (segment.hasUnclear) return segment.text;
			if (settings.ignorePunctuation && segment.isPunctuation) return '';
			if (settings.suppliedTextMode === 'gap' && segment.isSupplied) return '';
			return segment.text;
		})
		.join('')
		.replace(/\s+/g, ' ')
		.trim();

	if (settings.lowercase) {
		structuralText = structuralText.toLocaleLowerCase();
	}

	if (settings.ignoreTokenWhitespace) {
		structuralText = structuralText.replace(/\\[ncp]/g, '');
		structuralText = structuralText.replace(/\s+/g, '');
	}

	structuralText = structuralText.normalize('NFC');

	const suppliedOnly =
		sourceToken.segments.length > 0 && sourceToken.segments.every(segment => segment.isSupplied);

	if (settings.suppliedTextMode === 'gap' && suppliedOnly) {
		return {
			original,
			originalSegments,
			regularized: null,
			alignmentValue: buildGapPlaceholder(
				{ source: 'supplied', reason: 'supplied', unit: '', extent: '' },
				'supplied'
			),
			ruleIds: [],
			types: [],
			kind: 'gap',
			gap: { source: 'supplied', reason: 'supplied', unit: '', extent: '' },
			hasUnclear,
			isPunctuation: isPunctuationOnly,
			isSupplied: true,
		};
	}

	if (structuralText.length === 0) return null;

	const regularizedValue = applyCompiledRules(
		structuralText,
		compiledRules,
		diagnostics,
		(rule, before, after) => {
			ruleEffects.push({
				ruleId: rule.id,
				pattern: rule.pattern,
				description: rule.description,
				scope: rule.scope,
				witnessId,
				original: structuralText,
				before,
				after,
				changed: before !== after,
			});
		}
	);
	return {
		original,
		originalSegments,
		regularized: regularizedValue.regularizedText,
		alignmentValue: regularizedValue.regularizedText,
		ruleIds: regularizedValue.ruleIds,
		types: regularizedValue.types,
		kind: 'text',
		gap: null,
		hasUnclear,
		isPunctuation: isPunctuationOnly,
		isSupplied,
	};
}

function tokenToJoinablePart(token: CollationTokenInput) {
	return {
		text: token.t,
		isPunctuation: token.isPunctuation,
		originalSegments: token.originalSegments,
	};
}

function appendTokenText(current: string, token: CollationTokenInput): string {
	return joinTokenTexts([{ text: current }, tokenToJoinablePart(token)]);
}

function mergeIgnoredPunctuationIntoPreviousToken(
	tokens: CollationTokenInput[],
	ignorePunctuation: boolean
): CollationTokenInput[] {
	if (!ignorePunctuation) return tokens.map(token => ({ ...token }));

	const prepared: CollationTokenInput[] = [];
	for (const token of tokens) {
		const cloned: CollationTokenInput = {
			...token,
			sourceTokenIds: token.sourceTokenIds ? [...token.sourceTokenIds] : undefined,
			originalSegments: token.originalSegments?.map(segment => ({ ...segment })),
			gap: token.gap ? { ...token.gap } : token.gap,
			ruleIds: token.ruleIds ? [...token.ruleIds] : undefined,
			regularizationTypes: token.regularizationTypes ? [...token.regularizationTypes] : undefined,
		};
		if (!isPunctuationToken(tokenToJoinablePart(cloned))) {
			prepared.push(cloned);
			continue;
		}
		const previous = prepared[prepared.length - 1];
		if (!previous || previous.kind !== 'text') continue;
		previous.t = appendTokenText(previous.t, cloned);
		previous.sourceTokenIds = [
			...(previous.sourceTokenIds ?? []),
			...(cloned.sourceTokenIds ?? []),
		];
		previous.originalSegments = [
			...(previous.originalSegments ?? []),
			...(cloned.originalSegments ?? []),
		];
	}
	return prepared;
}

function toInputToken(
	witnessId: string,
	index: number,
	token: RegularizedToken
): CollationTokenInput {
	return {
		t: token.original,
		n: token.alignmentValue ?? '',
		sourceTokenIds: [`${witnessId}::source::${index}`],
		kind: token.kind === 'omission' ? 'text' : token.kind,
		displayRegularized: token.regularized,
		originalSegments: token.originalSegments.map(segment => ({ ...segment })),
		gap: token.gap,
		hasUnclear: token.hasUnclear,
		isPunctuation: token.isPunctuation,
		isSupplied: token.isSupplied,
		ruleIds: token.ruleIds,
		regularizationTypes: token.types,
	};
}

function ignoredPunctuationInputToken(
	witnessId: string,
	index: number,
	sourceToken: WitnessSourceToken
): CollationTokenInput | null {
	if (
		sourceToken.kind !== 'text' ||
		sourceToken.segments.length === 0 ||
		!sourceToken.segments.every(segment => segment.isPunctuation)
	) {
		return null;
	}
	return {
		t: sourceToken.original,
		n: '',
		sourceTokenIds: [`${witnessId}::source::${index}`],
		kind: 'text',
		displayRegularized: null,
		originalSegments: sourceToken.segments.map(segment => ({ ...segment })),
		gap: null,
		hasUnclear: sourceToken.segments.some(segment => segment.hasUnclear),
		isPunctuation: true,
		isSupplied: sourceToken.segments.some(segment => segment.isSupplied),
		ruleIds: [],
		regularizationTypes: [],
	};
}

export function deriveCollationInput(
	witnesses: WitnessConfig[],
	settings: CollationInputSettings,
	rules: RegularizationRule[]
): DerivedCollationInput {
	const diagnostics: CollationInputDiagnostic[] = [];
	const ruleEffects: RegularizationRuleEffect[] = [];
	const compiledRules = compileRules(rules, diagnostics);
	const perWitnessTokens = new Map<string, RegularizedToken[]>();
	const witnessInputs: CollationWitnessInput[] = [];

	for (const witness of witnesses.filter(item => !item.isExcluded)) {
		const regularizedTokens: RegularizedToken[] = [];
		const inputTokens: CollationTokenInput[] = [];
		for (const [index, sourceToken] of witness.tokens.entries()) {
			const token = deriveToken(
				witness.witnessId,
				sourceToken,
				settings,
				compiledRules,
				diagnostics,
				ruleEffects
			);
			if (!token) {
				if (settings.ignorePunctuation) {
					const punctuationToken = ignoredPunctuationInputToken(witness.witnessId, index, sourceToken);
					if (punctuationToken) inputTokens.push(punctuationToken);
				}
				continue;
			}
			regularizedTokens.push(token);
			inputTokens.push(toInputToken(witness.witnessId, index, token));
		}
		const mergedTokens = mergeIgnoredPunctuationIntoPreviousToken(
			inputTokens,
			settings.ignorePunctuation
		);
		perWitnessTokens.set(witness.witnessId, regularizedTokens);
		witnessInputs.push({
			id: witness.witnessId,
			content: joinTokenTexts(mergedTokens.map(token => tokenToJoinablePart(token))),
			tokens: mergedTokens,
		});
	}

	return { perWitnessTokens, witnessInputs, diagnostics, ruleEffects };
}
