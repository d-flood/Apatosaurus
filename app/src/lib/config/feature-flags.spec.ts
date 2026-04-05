import { describe, expect, it } from 'vitest';
import { parseBooleanFlag, resolveCollationEnabled } from './feature-flags';

describe('feature flags', () => {
	describe('parseBooleanFlag', () => {
		it('parses true values', () => {
			expect(parseBooleanFlag('true')).toBe(true);
			expect(parseBooleanFlag('1')).toBe(true);
			expect(parseBooleanFlag('yes')).toBe(true);
			expect(parseBooleanFlag('on')).toBe(true);
			expect(parseBooleanFlag(' TRUE ')).toBe(true);
		});

		it('parses false values', () => {
			expect(parseBooleanFlag('false')).toBe(false);
			expect(parseBooleanFlag('0')).toBe(false);
			expect(parseBooleanFlag('no')).toBe(false);
			expect(parseBooleanFlag('off')).toBe(false);
			expect(parseBooleanFlag(' Off ')).toBe(false);
		});

		it('returns undefined for empty, invalid, or missing values', () => {
			expect(parseBooleanFlag('')).toBeUndefined();
			expect(parseBooleanFlag('maybe')).toBeUndefined();
			expect(parseBooleanFlag(undefined)).toBeUndefined();
		});
	});

	describe('resolveCollationEnabled', () => {
		it('uses explicit flag value when provided', () => {
			expect(resolveCollationEnabled('true', false)).toBe(true);
			expect(resolveCollationEnabled('false', true)).toBe(false);
		});

		it('falls back to dev mode when flag is missing or invalid', () => {
			expect(resolveCollationEnabled(undefined, true)).toBe(true);
			expect(resolveCollationEnabled(undefined, false)).toBe(false);
			expect(resolveCollationEnabled('invalid', true)).toBe(true);
			expect(resolveCollationEnabled('invalid', false)).toBe(false);
		});
	});
});
