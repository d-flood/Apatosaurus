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

		await expect
			.element(browserPage.getByTestId('onboarding-primary-path'))
			.toHaveTextContent('Google Drive or Dropbox');
		await expect
			.element(browserPage.getByTestId('onboarding-primary-path'))
			.toHaveTextContent('folder on this computer');
		await expect.element(browserPage.getByText('Allow persistent storage')).toBeInTheDocument();
	});

	it('hides the folder option when the browser cannot pick folders', async () => {
		render(OnboardingGuidance, {
			localFolderSupported: false,
			persistenceStatus: 'denied',
			installSupported: false,
		});

		await expect
			.element(browserPage.getByTestId('onboarding-primary-path'))
			.toHaveTextContent('Google Drive or Dropbox');
		await expect
			.element(browserPage.getByTestId('onboarding-guidance'))
			.not.toHaveTextContent('folder on this computer');
	});

	it('states the data ownership model and exit paths', async () => {
		render(OnboardingGuidance, {
			localFolderSupported: true,
			persistenceStatus: 'unsupported',
			installSupported: false,
			variant: 'about',
		});

		await expect
			.element(browserPage.getByTestId('data-ownership'))
			.toHaveTextContent('Origin Private File System');
		await expect
			.element(browserPage.getByTestId('data-ownership'))
			.toHaveTextContent('byte-identical copy');
		await expect
			.element(browserPage.getByTestId('data-ownership'))
			.toHaveTextContent('TEI sibling');
		await expect
			.element(browserPage.getByTestId('data-ownership'))
			.toHaveTextContent('zip export');
	});
});
