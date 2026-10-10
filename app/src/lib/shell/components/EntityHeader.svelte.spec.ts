import { page } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import EntityHeader from './EntityHeader.svelte';

const browserPage = page as any;

describe('EntityHeader', () => {
	it('shows project ownership', async () => {
		render(EntityHeader, { label: 'Transcription', projectName: 'Romans Edition' });

		await expect
			.element(browserPage.getByTestId('entity-project'))
			.toHaveTextContent('Project: Romans Edition');
	});

	it('falls back when the project is unavailable', async () => {
		render(EntityHeader, { projectName: null });

		await expect
			.element(browserPage.getByTestId('entity-project'))
			.toHaveTextContent('Project: Project unavailable');
	});
});
