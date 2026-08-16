import { page, userEvent } from '@vitest/browser/context';
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { collateToAlignmentSnapshot } from '$lib/client/collation/collation-adapter';
import { collationState, type WitnessConfig } from '$lib/client/collation/collation-state.svelte';
import type { WitnessSourceToken } from '$lib/client/collation/collation-types';
import StemmaPhase from './StemmaPhase.svelte';

function tokens(content: string): WitnessSourceToken[] {
	return content.split(/\s+/).map(text => ({
		kind: 'text' as const,
		original: text,
		segments: [{ text, hasUnclear: false, isPunctuation: false, isSupplied: false }],
		gap: null,
	}));
}

function witness(witnessId: string, content: string, isBaseText = false): WitnessConfig {
	return {
		witnessId,
		siglum: witnessId,
		transcriptionId: `${witnessId}-tx`,
		sourceVersion: 'v1',
		content,
		tokens: tokens(content),
		treatment: 'inherit',
		isBaseText,
		isExcluded: false,
		overridesDefault: false,
	};
}

describe('StemmaPhase', () => {
	beforeEach(() => {
		collationState.reset();
		collationState.setWitnesses([witness('A', 'λογος', true), witness('B', 'θεος')]);
		collationState.refreshCollationInput();
		const snapshot = collateToAlignmentSnapshot({
			witnesses: collationState.buildCollationWitnessInputs(),
			options: { segmentation: false },
		});
		collationState.setAlignmentSnapshot(snapshot.snapshot);
		const readings = collationState.getReadingsForUnit(0);
		const a = readings.find(reading => reading.label === 'a')!;
		const b = readings.find(reading => reading.label === 'b')!;
		collationState.setReadingSource(0, b.id, { kind: 'derived', from: a.id });
		collationState.setLemmaReading(0, b.id);
	});

	it('offers connectivity choices and a visible lemma-root repair', async () => {
		render(StemmaPhase);

		await expect.element(page.getByTestId('connectivity-control')).toHaveTextContent('10');
		const customConnectivity = page.getByRole('spinbutton', { name: 'Custom connectivity' });
		await expect.element(customConnectivity).toBeInTheDocument();
		for (const preset of ['1', '2', '3', '5', '10']) {
			await expect
				.element(page.getByRole('button', { name: preset, exact: true }))
				.toBeInTheDocument();
		}
		await expect
			.element(page.getByRole('button', { name: 'Absolute', exact: true }))
			.toBeInTheDocument();
		await expect
			.element(page.getByTestId('connectivity-state'))
			.toHaveTextContent('Connectivity: 10');
		await userEvent.click(page.getByRole('button', { name: 'Absolute', exact: true }));
		expect(collationState.getConnectivity(0)).toBe('absolute');
		await expect
			.element(page.getByTestId('connectivity-state'))
			.toHaveTextContent('Connectivity: Absolute');
		await expect.element(customConnectivity).not.toHaveValue('10');
		await userEvent.fill(customConnectivity, '4');
		await userEvent.tab();
		expect(collationState.getConnectivity(0)).toBe(4);
		await userEvent.fill(customConnectivity, '1.5');
		await userEvent.tab();
		await expect
			.element(
				page.getByText('Connectivity must be a positive whole number. No change was made.')
			)
			.toBeInTheDocument();
		expect(collationState.getConnectivity(0)).toBe(4);
		await userEvent.click(page.getByRole('button', { name: '3', exact: true }));
		expect(collationState.getConnectivity(0)).toBe(3);

		await expect.element(page.getByRole('alert')).toHaveTextContent('lemma');
		const reroot = page.getByRole('button', { name: 'Reroot on lemma' });
		await expect.element(reroot).toBeInTheDocument();
		await userEvent.click(reroot);
		expect(collationState.getLocalStemma(0).violations).toEqual([]);
	});
});
