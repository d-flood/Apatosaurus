import { describe, expect, it } from 'vitest';
import { computeWordDiff } from './alignment-diff';

function simplify(base: string | null, witness: string | null) {
	return computeWordDiff(base, witness).map((s) => ({ kind: s.kind, text: s.text }));
}

describe('computeWordDiff', () => {
	it('returns equal segment for identical text', () => {
		expect(simplify('a b c', 'a b c')).toEqual([{ kind: 'equal', text: 'a b c' }]);
	});

	it('returns delete and insert segments for substitution', () => {
		expect(simplify('a b c', 'a x c')).toEqual([
			{ kind: 'equal', text: 'a' },
			{ kind: 'replace', text: 'x' },
			{ kind: 'equal', text: 'c' },
		]);
	});

	it('returns insertion-only diff when base is empty', () => {
		expect(simplify(null, 'x y')).toEqual([{ kind: 'insert', text: 'x y' }]);
	});

	it('returns deletion-only diff when witness is empty', () => {
		expect(simplify('x y', null)).toEqual([{ kind: 'delete', text: 'x y' }]);
	});

	it('normalizes repeated whitespace', () => {
		expect(simplify('a   b', 'a b')).toEqual([{ kind: 'equal', text: 'a b' }]);
	});

	it('highlights only extra letter as insertion', () => {
		expect(simplify('colour', 'color')).toEqual([
			{ kind: 'equal', text: 'colo' },
			{ kind: 'delete', text: 'u' },
			{ kind: 'equal', text: 'r' },
		]);
	});

	it('highlights only changed letter as replacement', () => {
		expect(simplify('dog', 'dig')).toEqual([
			{ kind: 'equal', text: 'd' },
			{ kind: 'replace', text: 'i' },
			{ kind: 'equal', text: 'g' },
		]);
	});
});
