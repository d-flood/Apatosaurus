import { page } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import OnboardingGuidance from './OnboardingGuidance.svelte';

const browserPage = page as any;

describe('OnboardingGuidance', () => {
	it('offers a single sign-in step and no folder on this computer', async () => {
		render(OnboardingGuidance);

		const guidance = browserPage.getByTestId('onboarding-guidance');
		await expect
			.element(browserPage.getByRole('heading', { name: 'Keep your projects safe' }))
			.toBeInTheDocument();
		const steps = guidance.getByRole('listitem');
		await expect.element(steps).toHaveTextContent('Sign in with Google Drive or Dropbox');
		expect(steps.elements()).toHaveLength(1);
		await expect.element(guidance).not.toHaveTextContent('folder on this computer');
		await expect.element(guidance).not.toHaveTextContent('Install the app');
		await expect.element(guidance).not.toHaveTextContent('persistent storage');
		await expect.element(browserPage.getByTestId('data-ownership')).not.toBeInTheDocument();
	});

	it('states the data ownership model and exit paths only on About', async () => {
		render(OnboardingGuidance, { variant: 'about' });

		const ownership = browserPage.getByTestId('data-ownership');
		await expect
			.element(ownership)
			.toHaveTextContent(
				'Project files live in a working copy on this device, inside Apatosaurus project folders.'
			);
		await expect.element(ownership).not.toHaveTextContent('Origin Private File System');
		await expect.element(ownership).toHaveTextContent('exact copy');
		await expect.element(ownership).toHaveTextContent('TEI');
		await expect.element(ownership).toHaveTextContent('zip export');
	});
});
