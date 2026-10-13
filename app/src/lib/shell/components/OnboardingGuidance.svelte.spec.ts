import { page } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import OnboardingGuidance from './OnboardingGuidance.svelte';

const browserPage = page as any;

describe('OnboardingGuidance', () => {
	it('offers a folder on this computer alongside cloud storage when supported', async () => {
		render(OnboardingGuidance, {
			localFolderSupported: true,
			persistenceStatus: 'granted',
			installSupported: true,
		});

		const guidance = browserPage.getByTestId('onboarding-guidance');
		await expect.element(guidance).toHaveTextContent('Google Drive or Dropbox');
		await expect.element(guidance).toHaveTextContent('folder on this computer');
		await expect.element(browserPage.getByText('Allow persistent storage')).toBeInTheDocument();
		await expect.element(browserPage.getByTestId('data-ownership')).not.toBeInTheDocument();
	});

	it('hides the folder option when the browser cannot pick folders', async () => {
		render(OnboardingGuidance, {
			localFolderSupported: false,
			persistenceStatus: 'denied',
			installSupported: false,
		});

		const guidance = browserPage.getByTestId('onboarding-guidance');
		await expect.element(guidance).toHaveTextContent('Google Drive or Dropbox');
		await expect.element(guidance).not.toHaveTextContent('folder on this computer');
	});

	it('states the data ownership model and exit paths', async () => {
		render(OnboardingGuidance, {
			localFolderSupported: true,
			persistenceStatus: 'unsupported',
			installSupported: false,
			variant: 'about',
		});

		const ownership = browserPage.getByTestId('data-ownership');
		await expect.element(ownership).toHaveTextContent('Origin Private File System');
		await expect.element(ownership).toHaveTextContent('exact copy');
		await expect.element(ownership).toHaveTextContent('TEI');
		await expect.element(ownership).toHaveTextContent('zip export');
	});
});
