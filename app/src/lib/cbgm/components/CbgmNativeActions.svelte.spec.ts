import { page } from '@vitest/browser/context';
import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import type { CbgmAnalysisMetadata } from '$lib/storage/formats';
import CbgmNativeActions from './CbgmNativeActions.svelte';

it('offers native replacement while a global stemma is still computing', async () => {
	const analysis = {
		id: 'analysis',
		coherence: 'ready',
		global_stemma: 'computing',
		cache_hash: 'cache',
	} as CbgmAnalysisMetadata;
	render(CbgmNativeActions, { analysis });
	await expect
		.element(page.getByRole('heading', { name: 'Import native results' }))
		.toBeVisible();
	await expect
		.element(page.getByText('Importing cancels the computation in progress.'))
		.toBeVisible();
});
