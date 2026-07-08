import { describe, expect, it } from 'vitest';
import type { RegularizationRule, WitnessConfig, WitnessSourceToken } from './collation-types';
import { deriveCollationInput } from './regularization';

function makeRule(overrides: Partial<RegularizationRule>): RegularizationRule {
	return {
		id: 'rule',
		pattern: 'x',
		replacement: 'y',
		scope: 'verse',
		description: '',
		enabled: true,
		type: 'none',
		...overrides,
	};
}

function makeToken(text: string): WitnessSourceToken {
	return {
		kind: 'text',
		original: text,
		segments: [{ text, hasUnclear: false, isPunctuation: false, isSupplied: false }],
		gap: null,
	};
}

function makeWitness(text: string): WitnessConfig {
	return {
		witnessId: 'A',
		siglum: 'A',
		transcriptionId: 'tx-A',
		content: text,
		tokens: [makeToken(text)],
		treatment: 'inherit',
		isBaseText: true,
		isExcluded: false,
		overridesDefault: false,
	};
}

const defaultSettings = {
	lowercase: false,
	ignoreTokenWhitespace: true,
	ignorePunctuation: false,
	suppliedTextMode: 'clear' as const,
};

describe('deriveCollationInput', () => {
	it('applies project-scope rules before verse-scope rules in list order', () => {
		const result = deriveCollationInput([makeWitness('abc')], defaultSettings, [
			makeRule({ id: 'verse-first-in-list', scope: 'verse', pattern: 'x', replacement: 'z' }),
			makeRule({ id: 'project-1', scope: 'project', pattern: 'a', replacement: 'x' }),
			makeRule({ id: 'project-2', scope: 'project', pattern: 'x', replacement: 'y' }),
		]);

		expect(result.witnessInputs[0]?.tokens?.[0]?.n).toBe('ybc');
		expect(result.witnessInputs[0]?.tokens?.[0]?.ruleIds).toEqual(['project-1', 'project-2']);
	});

	it('uses Unicode regexes for Greek final sigma matching', () => {
		const result = deriveCollationInput([makeWitness('λόγος')], defaultSettings, [
			makeRule({ id: 'final-sigma', pattern: '[σς]$', replacement: 'ϲ' }),
		]);

		expect(result.witnessInputs[0]?.tokens?.[0]?.n).toBe('λόγοϲ');
	});

	it('normalizes decomposed polytonic Greek text to NFC before matching', () => {
		const decomposedAlphaWithMarks = 'α\u0314\u0345';
		const result = deriveCollationInput([makeWitness(decomposedAlphaWithMarks)], defaultSettings, [
			makeRule({ id: 'breathing-iota', pattern: 'ᾁ', replacement: 'alpha' }),
		]);

		expect(result.witnessInputs[0]?.tokens?.[0]?.n).toBe('alpha');
		expect(result.perWitnessTokens.get('A')?.[0]?.regularized).toBe('alpha');
	});

	it('reports invalid regex rules without silently skipping them', () => {
		const result = deriveCollationInput([makeWitness('θεος')], defaultSettings, [
			makeRule({ id: 'bad', pattern: '(', replacement: '' }),
		]);

		expect(result.witnessInputs[0]?.tokens?.[0]?.n).toBe('θεος');
		expect(result.diagnostics).toEqual([
			expect.objectContaining({ ruleId: 'bad', code: 'invalid_regex', pattern: '(' }),
		]);
	});

	it('records each enabled rule effect without requiring UI re-application', () => {
		const result = deriveCollationInput([makeWitness('θς λογος')], defaultSettings, [
			makeRule({ id: 'ns', pattern: 'θς', replacement: 'θεος', type: 'ns' }),
			makeRule({ id: 'no-effect', pattern: 'παυλος', replacement: 'παῦλος' }),
		]);

		expect(result.ruleEffects).toEqual([
			expect.objectContaining({
				ruleId: 'ns',
				witnessId: 'A',
				original: 'θςλογος',
				before: 'θςλογος',
				after: 'θεοςλογος',
				changed: true,
			}),
			expect.objectContaining({
				ruleId: 'no-effect',
				witnessId: 'A',
				before: 'θεοςλογος',
				after: 'θεοςλογος',
				changed: false,
			}),
		]);
	});
});
