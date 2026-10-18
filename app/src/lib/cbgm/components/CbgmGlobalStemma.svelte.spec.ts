import { page } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import plain from '../../../../../packages/open-cbgm-wasm/tests/fixtures/default/global-stemma-plain.dot?raw';
import lengths from '../../../../../packages/open-cbgm-wasm/tests/fixtures/default/global-stemma-lengths.dot?raw';
import lengthsStrengths from '../../../../../packages/open-cbgm-wasm/tests/fixtures/default/global-stemma-lengths-strengths.dot?raw';
import strengths from '../../../../../packages/open-cbgm-wasm/tests/fixtures/default/global-stemma-strengths.dot?raw';
import type { CbgmAnalysisMetadata } from '$lib/storage/formats';
import type { CbgmQueries } from '../cbgm-queries';
import { cbgmScheduler } from '../cbgm-scheduler.svelte';
import type { GlobalStemmaOptions } from '../cbgm-worker-types';
import CbgmGlobalStemma from './CbgmGlobalStemma.svelte';

const analysis: CbgmAnalysisMetadata = {
	id: 'analysis-1',
	project_id: 'project-1',
	name: '3 John',
	inputs_frozen_at: '2026-10-15T09:00:00.000Z',
	completed_at: '2026-10-15T10:00:00.000Z',
	settings: {
		min_extant_units: null,
		min_extant_proportion: null,
		excluded_witnesses: [],
		classic_rules: false,
		merge_split_readings: false,
		dropped_reading_types: [],
		trivial_reading_types: [],
		included_correctors: [],
	},
	collations: [],
	input_tei_hash: 'sha256:input',
	cache_hash: 'sha256:cache',
	coherence: 'ready',
	witnesses: [],
	undecided_readings: [],
	global_stemma: 'ready',
	computing_device: null,
	failure: null,
};

const dots: Record<string, string> = {
	'false:false': plain,
	'false:true': lengths,
	'true:false': strengths,
	'true:true': lengthsStrengths,
};

afterEach(() => {
	vi.restoreAllMocks();
});

function dashedEdges(): number {
	return document.querySelectorAll('g.edge path[stroke-dasharray]').length;
}

it('re-renders the stored global stemma when strengths or costs are toggled, without enqueueing', async () => {
	const enqueue = vi.spyOn(cbgmScheduler, 'enqueue');
	const globalStemma = vi.fn(
		async (opts: GlobalStemmaOptions) => dots[`${opts.strengths}:${opts.lengths}`]
	);
	const queries = { globalStemma } as unknown as CbgmQueries;

	render(CbgmGlobalStemma, { analysis, queries });

	await expect.element(page.getByText('P74', { exact: true })).toBeInTheDocument();
	expect(page.getByText('7.000', { exact: true }).elements()).toHaveLength(0);
	expect(dashedEdges()).toBe(0);

	await page.getByRole('checkbox', { name: 'Show costs' }).click();
	await expect.element(page.getByText('Global stemma with costs')).toBeInTheDocument();
	await expect.element(page.getByText('7.000', { exact: true }).first()).toBeInTheDocument();
	expect(dashedEdges()).toBe(0);

	await page.getByRole('checkbox', { name: 'Show strengths' }).click();
	await expect
		.element(page.getByText('Global stemma with costs and strengths'))
		.toBeInTheDocument();
	await expect.poll(dashedEdges).toBeGreaterThan(0);

	await page.getByRole('checkbox', { name: 'Show costs' }).click();
	await expect.element(page.getByText('Global stemma with strengths')).toBeInTheDocument();
	await expect.poll(() => page.getByText('7.000', { exact: true }).elements()).toHaveLength(0);

	expect(globalStemma.mock.calls.map(([opts]) => opts)).toEqual([
		{ strengths: false, lengths: false },
		{ strengths: false, lengths: true },
		{ strengths: true, lengths: true },
		{ strengths: true, lengths: false },
	]);
	expect(enqueue).not.toHaveBeenCalled();
});
