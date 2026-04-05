import { describe, expect, it } from 'vitest';

import { buildTranscriptionDuplicateKey, normalizeTranscriptionDuplicateValue } from './duplicate-key';

describe('buildTranscriptionDuplicateKey', () => {
	it('prefers siglum over title', () => {
		expect(buildTranscriptionDuplicateKey({ siglum: ' P118 ', title: 'Romans in P118' })).toBe(
			'p118'
		);
	});

	it('falls back to title when siglum is blank', () => {
		expect(buildTranscriptionDuplicateKey({ siglum: '   ', title: ' Codex Bezae ' })).toBe(
			'codex bezae'
		);
	});

	it('returns null when both siglum and title are empty', () => {
		expect(buildTranscriptionDuplicateKey({ siglum: '', title: '' })).toBeNull();
	});
});

describe('normalizeTranscriptionDuplicateValue', () => {
	it('trims and lowercases values', () => {
		expect(normalizeTranscriptionDuplicateValue('  NT_GRC_01_Rom.XML  ')).toBe(
			'nt_grc_01_rom.xml'
		);
	});
});
