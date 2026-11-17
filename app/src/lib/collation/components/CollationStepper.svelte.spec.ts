import { page } from '@vitest/browser/context';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { collateToAlignmentSnapshot } from '$lib/collation/collation-adapter';
import { collationState, type WitnessConfig } from '$lib/collation/collation-state.svelte';
import CollationStepper from './CollationStepper.svelte';

function makeWitness(witnessId: string, content: string, isBaseText = false): WitnessConfig {
	return {
		witnessId,
		siglum: witnessId,
		transcriptionId: `${witnessId}-tx`,
		content,
		tokens: content.split(/\s+/).map(token => ({
			kind: 'text' as const,
			original: token,
			segments: [{ text: token, hasUnclear: false, isPunctuation: false, isSupplied: false }],
			gap: null,
		})),
		treatment: 'inherit',
		isBaseText,
		isExcluded: false,
		overridesDefault: false,
	};
}

const LABELS = ['Setup', 'Alignment', 'Readings', 'Stemma', 'Review'];

function steps() {
	return LABELS.map(label => page.getByRole('link', { name: label, exact: true }));
}

function disabledLabels() {
	return LABELS.filter(
		label =>
			document.querySelector(`a[aria-label="${label}"]`)?.getAttribute('aria-disabled') ===
			'true'
	);
}

describe('CollationStepper at phone width', () => {
	const original = { width: window.innerWidth, height: window.innerHeight };

	beforeEach(async () => {
		collationState.reset();
		await page.viewport(375, 812);
	});

	afterEach(async () => {
		await page.viewport(original.width, original.height);
	});

	async function expectFitsAndNoCheckmarks() {
		const nav = page.getByRole('navigation', { name: 'Collation workflow steps' });
		await expect.element(nav).toBeVisible();
		for (const step of steps()) await expect.element(step).toBeVisible();
		const right = Math.max(
			...[...document.querySelectorAll('[role="navigation"] a')].map(
				node => node.getBoundingClientRect().right
			)
		);
		expect(right).toBeLessThanOrEqual(375);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
		expect(document.querySelectorAll('[role="navigation"] svg')).toHaveLength(0);
		expect(
			[...document.querySelectorAll('[role="navigation"] a')].map(node =>
				node.textContent?.replace(/\s+/g, ' ').trim()
			)
		).toEqual(LABELS.map((label, index) => `${index + 1} ${label}`));
	}

	it('disables every phase but Setup without an alignment', async () => {
		render(CollationStepper);
		await expectFitsAndNoCheckmarks();
		expect(disabledLabels()).toEqual(['Alignment', 'Readings', 'Stemma', 'Review']);
		await expect
			.element(page.getByRole('link', { name: 'Setup', exact: true }))
			.toHaveAttribute('aria-current', 'step');
	});

	it('opens every phase once the collation has an alignment', async () => {
		collationState.setWitnesses([makeWitness('A', 'λογος', true), makeWitness('B', 'θεος')]);
		collationState.setAlignmentSnapshot(
			collateToAlignmentSnapshot({
				witnesses: collationState.buildCollationWitnessInputs(),
			}).snapshot
		);
		collationState.setPhase('stemma');
		render(CollationStepper);
		await expectFitsAndNoCheckmarks();
		expect(disabledLabels()).toEqual([]);
		await expect
			.element(page.getByRole('link', { name: 'Stemma', exact: true }))
			.toHaveAttribute('aria-current', 'step');
	});
});
