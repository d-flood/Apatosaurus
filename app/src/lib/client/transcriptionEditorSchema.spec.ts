import { describe, expect, it } from 'vitest';

import {
	formatCorrectionTooltipText,
	getCorrectionRenderExtensions,
	getProfileExtensions,
} from './transcriptionEditorSchema';

describe('transcriptionEditorSchema correction rendering', () => {
	it('rejects an unrecognized editor profile at the extension boundary', () => {
		expect(() => getProfileExtensions('unknown-profile')).toThrow(
			'Unknown editor profile: unknown-profile'
		);
	});

	it('preserves unclear markup in correction tooltip text', () => {
		const tooltipText = formatCorrectionTooltipText([
			{
				hand: 'corrector',
				content: [
					{ type: 'text', text: 'απο' },
					{ type: 'text', text: 'στ', marks: [{ type: 'unclear', attrs: {} }] },
					{ type: 'text', text: 'ολος' },
				],
			},
		]);

		expect(tooltipText).toBe('corrector: απο`στ`ολος');
	});

	it('includes inline break and formwork nodes in correction rendering extensions', () => {
		const names = getCorrectionRenderExtensions().map(extension => extension.name);

		expect(names).toContain('pageBreak');
		expect(names).toContain('lineBreak');
		expect(names).toContain('columnBreak');
		expect(names).toContain('fw');
	});
});
