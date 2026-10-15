import { page } from '@vitest/browser/context';
import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import type { FindRelativesTable } from '@apatosaurus/open-cbgm-wasm';
import type { CbgmQueries } from '../cbgm-queries';
import CbgmFindRelatives from './CbgmFindRelatives.svelte';
import CbgmTextualFlow from './CbgmTextualFlow.svelte';

const units = [
	{ id: 'one', label: 'Unit one', readings: ['a', 'b'] },
	{ id: 'two', label: 'Unit two', readings: ['a', 'b'] },
];

it('resets reading filters at unit boundaries and ignores the old pending result', async () => {
	let finish!: (value: FindRelativesTable) => void;
	const findRelatives = vi.fn(
		() =>
			new Promise<FindRelativesTable>(resolve => {
				finish = resolve;
			})
	);
	const queries = { witnesses: ['A'], units, findRelatives } as unknown as CbgmQueries;
	render(CbgmFindRelatives, { analysisName: 'Study', queries });
	await page.getByRole('combobox', { name: 'Witness', exact: true }).selectOptions('A');
	const unit = page.getByRole('combobox', { name: 'Variation unit' });
	await unit.selectOptions('one');
	await page.getByRole('checkbox', { name: 'a', exact: true }).click();
	await page.getByRole('button', { name: 'Find relatives', exact: true }).click();
	expect(findRelatives).toHaveBeenCalledWith('A', 'one', ['a']);
	await unit.selectOptions('two');
	await expect.element(page.getByRole('checkbox', { name: 'a', exact: true })).not.toBeChecked();
	finish({
		primary_wit: 'A',
		primary_extant: 1,
		label: 'Old unit',
		connectivity: 1,
		primary_rdg: 'a',
		rows: [],
	});
	await expect
		.element(page.getByRole('button', { name: 'Find relatives', exact: true }))
		.toBeEnabled();
	await expect.element(page.getByText(/Old unit/)).not.toBeInTheDocument();
	await page.getByRole('button', { name: 'Find relatives', exact: true }).click();
	expect(findRelatives).toHaveBeenLastCalledWith('A', 'two', []);
});

it('resets textual-flow options at unit boundaries and ignores an old graph failure', async () => {
	let fail!: (error: Error) => void;
	const textualFlow = vi.fn(
		() =>
			new Promise<string>((_, reject) => {
				fail = reject;
			})
	);
	const queries = { units, textualFlow } as unknown as CbgmQueries;
	render(CbgmTextualFlow, { analysisName: 'Study', queries });
	const unit = page.getByRole('combobox', { name: 'Variation unit' });
	const limit = page.getByRole('spinbutton', { name: 'Connectivity limit' });
	await unit.selectOptions('one');
	await page.getByRole('combobox', { name: 'Graph', exact: true }).selectOptions('variants');
	await limit.fill('3');
	await page.getByRole('checkbox', { name: 'Show flow strengths' }).click();
	await page.getByRole('button', { name: 'Draw graph' }).click();
	await unit.selectOptions('two');
	await expect
		.element(page.getByRole('combobox', { name: 'Graph', exact: true }))
		.toHaveValue('flow');
	await expect.element(limit).toHaveValue(null);
	await expect
		.element(page.getByRole('checkbox', { name: 'Show flow strengths' }))
		.not.toBeChecked();
	fail(new Error('Old graph failure'));
	await expect.element(page.getByRole('button', { name: 'Draw graph' })).toBeEnabled();
	await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
	await expect.element(page.getByRole('button', { name: 'Draw graph' })).toBeEnabled();
	await page.getByRole('button', { name: 'Draw graph' }).click();
	expect(textualFlow).toHaveBeenLastCalledWith('two', 'flow', {
		connectivityLimit: undefined,
		strengths: false,
	});
});
