import { describe, it, expect } from 'vitest';
import type { Abbreviation } from './types';

describe('Abbreviation Mark Type', () => {
	it('should create abbreviation metadata with type and expansion', () => {
		const abbr: Abbreviation = {
			type: 'suspension',
			expansion: 'tion'
		};
		
		expect(abbr.type).toBe('suspension');
		expect(abbr.expansion).toBe('tion');
	});

	it('should support various abbreviation types', () => {
		const types = ['suspension', 'contraction', 'abbreviation mark', 'superscript', 'symbol'];
		
		for (const t of types) {
			const abbr: Abbreviation = { type: t, expansion: 'expanded' };
			expect(abbr.type).toBe(t);
		}
	});

	it('should support empty metadata', () => {
		const abbr: Abbreviation = {
			type: '',
			expansion: ''
		};
		
		expect(abbr.type).toBe('');
		expect(abbr.expansion).toBe('');
	});

	it('should allow partial metadata', () => {
		const abbr1: Abbreviation = { type: 'suspension', expansion: '' };
		expect(abbr1.type).toBe('suspension');
		expect(abbr1.expansion).toBe('');
		
		const abbr2: Abbreviation = { type: '', expansion: 'tion' };
		expect(abbr2.type).toBe('');
		expect(abbr2.expansion).toBe('tion');
	});

	it('should merge abbreviation metadata correctly', () => {
		const existing: Abbreviation = { type: 'contraction', expansion: 'and' };
		const updated: Abbreviation = { type: 'suspension', expansion: 'ous' };
		
		const merged = { ...existing, ...updated };
		expect(merged.type).toBe('suspension');
		expect(merged.expansion).toBe('ous');
	});
});
