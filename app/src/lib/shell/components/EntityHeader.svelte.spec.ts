import { page } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import EntityHeader from './EntityHeader.svelte';

const browserPage = page as any;

describe('EntityHeader', () => {
	it('shows project ownership and committed revision', async () => {
		render(EntityHeader, {
			label: 'Transcription',
			projectName: 'Romans Edition',
			commitState: 'clean',
			checkpointRevisionId: 'abcdef1234567890',
		});

		await expect.element(browserPage.getByTestId('entity-project')).toHaveTextContent('Project: Romans Edition');
		await expect.element(browserPage.getByTestId('entity-commit-state')).toHaveTextContent('Committed');
		await expect.element(browserPage.getByTestId('entity-revision')).toHaveTextContent('Revision abcdef12...');
	});

	it('shows dirty state as uncommitted changes', async () => {
		render(EntityHeader, {
			projectName: 'Romans Edition',
			commitState: 'dirty',
			checkpointRevisionId: 'rev-1',
		});

		await expect.element(browserPage.getByTestId('entity-commit-state')).toHaveTextContent('Uncommitted changes');
	});

	it('shows never-committed state without a revision', async () => {
		render(EntityHeader, {
			projectName: 'Romans Edition',
			commitState: 'never-committed',
		});

		await expect.element(browserPage.getByTestId('entity-commit-state')).toHaveTextContent('No committed version yet');
		await expect.element(browserPage.getByTestId('entity-revision')).not.toBeInTheDocument();
	});
});
