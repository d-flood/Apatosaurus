import { describe, it, expect } from 'vitest';
import type { Correction } from './types';

describe('Correction Mark Type', () => {
	it('should create correction metadata with hand and content', () => {
		const correction: Correction = {
			hand: 'scribe1',
			content: [{ type: 'text', text: 'corrected text' }],
		};

		expect(correction.hand).toBe('scribe1');
		expect(correction.content).toEqual([{ type: 'text', text: 'corrected text' }]);
	});

	it('should support type attribute for correction type', () => {
		const correction: Correction = {
			hand: 'corrector',
			content: [{ type: 'text', text: 'changed' }],
			type: 'deletion',
		};

		expect(correction.type).toBe('deletion');
	});

	it('should support position attribute for correction location', () => {
		const correction: Correction = {
			hand: 'scribe2',
			content: [{ type: 'text', text: 'added text' }],
			position: 'above',
		};

		expect(correction.position).toBe('above');
	});

	it('should support both type and position attributes together', () => {
		const correction: Correction = {
			hand: 'editor',
			content: [{ type: 'text', text: 'modified' }],
			type: 'substitution',
			position: 'margin',
		};

		expect(correction.type).toBe('substitution');
		expect(correction.position).toBe('margin');
	});

	it('should support various correction types', () => {
		const types = ['correction', 'deletion', 'substitution', 'addition', 'transposition'];

		for (const t of types) {
			const correction: Correction = {
				hand: 'hand1',
				content: [],
				type: t,
			};
			expect(correction.type).toBe(t);
		}
	});

	it('should support various correction positions', () => {
		const positions = ['above', 'below', 'left', 'right', 'margin'];

		for (const p of positions) {
			const correction: Correction = {
				hand: 'hand1',
				content: [],
				position: p,
			};
			expect(correction.position).toBe(p);
		}
	});

	it('should support optional type and position attributes', () => {
		const correction: Correction = {
			hand: 'scribe1',
			content: [],
		};

		expect(correction.type).toBeUndefined();
		expect(correction.position).toBeUndefined();
	});

	it('should merge correction metadata correctly', () => {
		const existing: Correction = {
			hand: 'hand1',
			content: [],
			type: 'correction',
			position: 'above',
		};
		const updated: Correction = {
			hand: 'hand2',
			content: [{ type: 'text', text: 'new' }],
			type: 'deletion',
			position: 'margin',
		};

		const merged = { ...existing, ...updated };
		expect(merged.hand).toBe('hand2');
		expect(merged.type).toBe('deletion');
		expect(merged.position).toBe('margin');
	});
});
