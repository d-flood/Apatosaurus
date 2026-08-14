import { describe, expect, it } from 'vitest';
import {
	BUNDLED_READING_TYPES,
	coerceReadingTypeDefinitions,
	proposeReadingType,
	resolveReadingTypeVocabulary,
} from './reading-types';

function propose(overrides: {
	isOmission?: boolean;
	hasUnclear?: boolean;
	hasSupplied?: boolean;
	regularizationTypes?: string[];
}) {
	return proposeReadingType({
		isOmission: false,
		hasUnclear: false,
		hasSupplied: false,
		regularizationTypes: [],
		...overrides,
	});
}

describe('reading type vocabulary', () => {
	it('offers neither omission nor lacuna as an editorial choice', () => {
		const selectable = BUNDLED_READING_TYPES.filter(type => type.selectable).map(
			type => type.id
		);

		expect(selectable).not.toContain('omission');
		expect(selectable).not.toContain('lac');
		expect(selectable).not.toContain('lacuna');
		expect(selectable).toEqual(['deficient', 'apparent', 'nonsense', 'orthographic']);
	});

	it('extends the bundled vocabulary with project values and lets a project relabel one', () => {
		const vocabulary = resolveReadingTypeVocabulary([
			{ id: 'itacism', label: 'Itacism', description: '', selectable: true },
			{ id: 'nonsense', label: 'Not Greek', description: '', selectable: true },
		]);

		expect(vocabulary.find(type => type.id === 'itacism')?.label).toBe('Itacism');
		expect(vocabulary.find(type => type.id === 'nonsense')?.label).toBe('Not Greek');
		expect(vocabulary.filter(type => type.id === 'nonsense')).toHaveLength(1);
	});

	it('refuses to let project data make a bundled non-selectable type selectable', () => {
		const parsed = coerceReadingTypeDefinitions([
			{ id: 'omission', label: 'Omission' },
			{ id: 'omission-like', label: 'Omission-like' },
		]);

		expect(parsed.find(type => type.id === 'omission')?.selectable).toBe(false);
		expect(parsed.find(type => type.id === 'omission-like')?.selectable).toBe(true);
		expect(
			resolveReadingTypeVocabulary(parsed)
				.filter(type => type.selectable)
				.map(type => type.id)
		).not.toContain('omission');
	});
});

describe('proposing a reading type', () => {
	it('proposes nothing for an ordinary reading', () => {
		expect(propose({})).toBeNull();
	});

	it('proposes omission for a reading the aligner determined attests no text', () => {
		expect(propose({ isOmission: true })).toBe('omission');
	});

	it('proposes deficient for unclear or supplied text', () => {
		expect(propose({ hasUnclear: true })).toBe('deficient');
		expect(propose({ hasSupplied: true })).toBe('deficient');
	});

	it('proposes nonsense where a ns-typed regularization rule fired', () => {
		expect(propose({ regularizationTypes: ['ns'] })).toBe('nonsense');
		expect(propose({ regularizationTypes: ['none'] })).toBeNull();
	});

	it('prefers deficient over nonsense, because unreadable text is not yet nonsense', () => {
		expect(propose({ hasUnclear: true, regularizationTypes: ['ns'] })).toBe('deficient');
	});
});
