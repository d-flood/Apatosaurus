import { describe, expect, it } from 'vitest';
import { variationUnitId } from './collation-unit-id';

describe('variation unit identity', () => {
	it('derives identity only from the column id', () => {
		expect(variationUnitId('column-17')).toBe('unit:column-17');
	});
});
