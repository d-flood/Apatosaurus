import { page, userEvent } from '@vitest/browser/context';
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { collateToAlignmentSnapshot } from '$lib/collation/collation-adapter';
import { collationState, type WitnessConfig } from '$lib/collation/collation-state.svelte';
import type { WitnessSourceToken } from '$lib/collation/collation-types';
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
		const snapshot = collateToAlignmentSnapshot({
			witnesses: collationState.buildCollationWitnessInputs(),
			options: { segmentation: false },
		});
		collationState.setAlignmentSnapshot(snapshot.snapshot);
		const readings = collationState.getReadingsForUnit(
			`unit:${collationState.alignmentColumns[0].id}`
		);
		const a = readings.find(reading => reading.label === 'a')!;
		const b = readings.find(reading => reading.label === 'b')!;
		collationState.setReadingSource(`unit:${collationState.alignmentColumns[0].id}`, b.id, {
			kind: 'derived',
			from: a.id,
		});
		collationState.setLemmaReading(`unit:${collationState.alignmentColumns[0].id}`, b.id);
	});

	it('forgets a lift when undo removes the lifted reading, even after redo restores it', async () => {
		render(StemmaPhase);
		collationState.addReading(`unit:${collationState.alignmentColumns[0].id}`);
		const diagram = page.getByRole('group', { name: /Local stemma for unit/ });
		const nodeCount = () =>
			document
				.querySelector('[aria-label^="Local stemma for unit"]')
				?.querySelectorAll('button').length;
		await expect.poll(nodeCount).toBe(3);
		const addedLabel = collationState
			.peekReadingsForUnit(`unit:${collationState.alignmentColumns[0].id}`)
			.find(reading => reading.witnessIds.length === 0)!.label;
		const added = diagram.getByRole('button', { name: new RegExp(`^${addedLabel}:`) });
		await added.click();
		await userEvent.keyboard('{Enter}');
		await expect
			.element(page.getByTestId('stemma-announcer'))
			.toHaveTextContent('Lifted reading');
		collationState.undo();
		await expect.poll(nodeCount).toBe(2);
		collationState.redo();
		await expect.poll(nodeCount).toBe(3);
		const remaining = diagram.getByRole('button').first();
		(remaining.element() as HTMLButtonElement).focus();
		await userEvent.keyboard('u');
		await expect
			.element(page.getByTestId('stemma-announcer'))
			.toHaveTextContent('is marked unclear');
		await expect
			.poll(() => remaining.element().getAttribute('aria-label'))
			.toMatch(/origin undeterminable/);
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
		expect(
			collationState.getConnectivity(`unit:${collationState.alignmentColumns[0].id}`)
		).toBe('absolute');
		await expect
			.element(page.getByTestId('connectivity-state'))
			.toHaveTextContent('Connectivity: Absolute');
		await expect.element(customConnectivity).not.toHaveValue('10');
		await userEvent.fill(customConnectivity, '4');
		await userEvent.tab();
		expect(
			collationState.getConnectivity(`unit:${collationState.alignmentColumns[0].id}`)
		).toBe(4);
		await userEvent.fill(customConnectivity, '1.5');
		await userEvent.tab();
		await expect
			.element(
				page.getByText('Connectivity must be a positive whole number. No change was made.')
			)
			.toBeInTheDocument();
		expect(
			collationState.getConnectivity(`unit:${collationState.alignmentColumns[0].id}`)
		).toBe(4);
		await userEvent.click(page.getByRole('button', { name: '3', exact: true }));
		expect(
			collationState.getConnectivity(`unit:${collationState.alignmentColumns[0].id}`)
		).toBe(3);

		await expect.element(page.getByRole('alert')).toHaveTextContent('lemma');
		const reroot = page.getByRole('button', { name: 'Reroot on lemma' });
		await expect.element(reroot).toBeInTheDocument();
		await userEvent.click(reroot);
		expect(
			collationState.getLocalStemma(`unit:${collationState.alignmentColumns[0].id}`)
				.violations
		).toEqual([]);
	});
});
