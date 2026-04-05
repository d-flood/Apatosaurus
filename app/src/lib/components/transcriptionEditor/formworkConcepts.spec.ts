import { describe, expect, it } from 'vitest';

import { classifyFormWork } from './formworkConcepts';

describe('formwork concept classification', () => {
	it('classifies the real Romans running-title pattern as page-top running title formwork', () => {
		const result = classifyFormWork({
			type: 'runTitle',
			rend: 'center',
			segType: 'margin',
			segSubtype: 'pagetop',
			segN: '@P262r-01',
		});

		expect(result.contentConcept).toBe('runningTitle');
		expect(result.placementConcept).toBe('pageTop');
		expect(result.editorSurface).toBe('pageChrome');
		expect(result.entryPoint).toBe('page');
	});

	it('maps page number style fw values to the page-label concept even when placed at the top', () => {
		const result = classifyFormWork({
			type: 'pageNum',
			place: 'top',
		});

		expect(result.contentConcept).toBe('pageLabel');
		expect(result.placementConcept).toBe('pageTop');
		expect(result.editorSurface).toBe('pageMetadata');
		expect(result.entryPoint).toBe('page');
	});

	it('maps catchwords to page-boundary formwork', () => {
		const result = classifyFormWork({
			type: 'catchword',
			place: 'bottom',
		});

		expect(result.contentConcept).toBe('catchword');
		expect(result.placementConcept).toBe('pageBottom');
		expect(result.editorSurface).toBe('pageBoundary');
		expect(result.entryPoint).toBe('page');
	});

	it('maps signature-style formwork to codicology concepts', () => {
		const result = classifyFormWork({
			type: 'sig',
			place: 'bottom',
		});

		expect(result.contentConcept).toBe('quireSignature');
		expect(result.editorSurface).toBe('codicology');
		expect(result.entryPoint).toBe('codicology');
	});

	it('classifies above-line formwork as interlinear placement when no narrow content type is present', () => {
		const result = classifyFormWork({
			segType: 'line',
			segSubtype: 'above',
		});

		expect(result.contentConcept).toBe('marginalLabel');
		expect(result.placementConcept).toBe('lineAbove');
		expect(result.editorSurface).toBe('interlinearPlacement');
		expect(result.entryPoint).toBe('marginalia');
		expect(result.marginaliaCategory).toBe('Interlinear');
	});

	it('classifies margin-left placement from schema-style place tokens', () => {
		const result = classifyFormWork({
			place: 'margin left',
		});

		expect(result.contentConcept).toBe('marginalLabel');
		expect(result.placementConcept).toBe('lineLeft');
		expect(result.editorSurface).toBe('marginPlacement');
		expect(result.entryPoint).toBe('marginalia');
		expect(result.marginaliaCategory).toBe('Marginal');
	});

	it('falls back to generic formwork when there is not enough structure yet', () => {
		const result = classifyFormWork({ type: 'ornament' });

		expect(result.contentConcept).toBe('genericFormwork');
		expect(result.placementConcept).toBe('unknown');
		expect(result.entryPoint).toBe('marginalia');
		expect(result.marginaliaCategory).toBe('Other');
	});
});
