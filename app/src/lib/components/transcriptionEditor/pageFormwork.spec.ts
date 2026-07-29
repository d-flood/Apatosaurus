import { describe, expect, it } from 'vitest';

import { createDefaultFormWorkAttrs } from './pageFormwork';

describe('page formwork helpers', () => {
	it('creates sensible defaults for page-label formwork insertions', () => {
		const attrs = createDefaultFormWorkAttrs('pageLabel');

		expect(attrs.type).toBe('pageNum');
		expect(attrs.place).toBe('top');
		expect(attrs.segType).toBe('margin');
		expect(attrs.segSubtype).toBe('pagetop');
		expect(attrs).not.toHaveProperty('content');
	});

	it('creates sensible defaults for catchwords and quire signatures', () => {
		const catchwordAttrs = createDefaultFormWorkAttrs('catchword');
		const quireAttrs = createDefaultFormWorkAttrs('quireSignature');

		expect(catchwordAttrs.type).toBe('catchword');
		expect(catchwordAttrs.place).toBe('bottom');
		expect(catchwordAttrs.segSubtype).toBe('colbottom');

		expect(quireAttrs.type).toBe('sig');
		expect(quireAttrs.place).toBe('bottom');
		expect(quireAttrs.segSubtype).toBe('colbottom');
	});
});
