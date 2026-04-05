import { describe, expect, it } from 'vitest';

import {
	annotatePageChromeInJson,
	createDefaultFormWorkAttrs,
} from './pageFormwork';
import { buildPlainTextFormWorkContent } from './formworkContent';

describe('page formwork helpers', () => {
	it('annotates page chrome attrs from running-title fw content', () => {
		const pm: any = {
			type: 'manuscript',
			content: [
				{
					type: 'page',
					attrs: { pageName: '262r' },
					content: [
						{
							type: 'column',
							attrs: { columnNumber: 1 },
							content: [
								{
									type: 'line',
									attrs: { lineNumber: 1 },
									content: [
										{
											type: 'fw',
											attrs: {
												type: 'runTitle',
												segType: 'margin',
												segSubtype: 'pagetop',
												content: buildPlainTextFormWorkContent('προς ρωμαιους'),
											},
										},
										{ type: 'text', text: 'alpha' },
									],
								},
							],
						},
					],
				},
			],
		};

		annotatePageChromeInJson(pm);

		expect(pm.content[0].attrs.runningTitle).toBe('προς ρωμαιους');
		expect(pm.content[0].attrs.pageLabel).toBeNull();
	});

	it('annotates footer-style page chrome attrs from catchword and quire-signature formwork', () => {
		const pm: any = {
			type: 'manuscript',
			content: [
				{
					type: 'page',
					attrs: { pageName: '262v' },
					content: [
						{
							type: 'column',
							attrs: { columnNumber: 1 },
							content: [
								{
									type: 'line',
									attrs: { lineNumber: 1 },
									content: [
										{
											type: 'fw',
											attrs: {
												type: 'sig',
												place: 'bottom',
												content: buildPlainTextFormWorkContent('ιβ'),
											},
										},
										{
											type: 'fw',
											attrs: {
												type: 'catchword',
												place: 'bottom',
												content: buildPlainTextFormWorkContent('παυλος'),
											},
										},
									],
								},
							],
						},
					],
				},
			],
		};

		annotatePageChromeInJson(pm);

		expect(pm.content[0].attrs.quireSignature).toBe('ιβ');
		expect(pm.content[0].attrs.catchword).toBe('παυλος');
	});

	it('creates sensible defaults for page-label formwork insertions', () => {
		const attrs = createDefaultFormWorkAttrs('pageLabel', 'ιβ');

		expect(attrs.type).toBe('pageNum');
		expect(attrs.place).toBe('top');
		expect(attrs.segType).toBe('margin');
		expect(attrs.segSubtype).toBe('pagetop');
		expect(attrs.content).toEqual([{ type: 'text', text: 'ιβ' }]);
	});

	it('creates sensible defaults for catchwords and quire signatures', () => {
		const catchwordAttrs = createDefaultFormWorkAttrs('catchword', 'παυλος');
		const quireAttrs = createDefaultFormWorkAttrs('quireSignature', 'ιβ');

		expect(catchwordAttrs.type).toBe('catchword');
		expect(catchwordAttrs.place).toBe('bottom');
		expect(catchwordAttrs.segSubtype).toBe('colbottom');

		expect(quireAttrs.type).toBe('sig');
		expect(quireAttrs.place).toBe('bottom');
		expect(quireAttrs.segSubtype).toBe('colbottom');
	});
});
