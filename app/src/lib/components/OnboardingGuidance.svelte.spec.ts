import { page } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import OnboardingGuidance from './OnboardingGuidance.svelte';

const browserPage = page as any;

describe('OnboardingGuidance', () => {
	it('renders the full recommended setup when folder sync is supported', async () => {
		render(OnboardingGuidance, {
			localFolderSupported: true,
			persistenceStatus: 'granted',
			installSupported: true,
		});

		await expect.element(browserPage.getByTestId('onboarding-guidance')).toHaveTextContent('Chromium-based browser');
		await expect.element(browserPage.getByTestId('onboarding-primary-path')).toHaveTextContent('Connect a sync folder');
		await expect.element(browserPage.getByTestId('onboarding-primary-path')).toHaveTextContent('Dropbox, OneDrive, or Drive');
		await expect.element(browserPage.getByText('Allow persistent storage')).toBeInTheDocument();
	});

	it('renders the zip export path when folder sync is unavailable', async () => {
		render(OnboardingGuidance, {
			localFolderSupported: false,
			persistenceStatus: 'denied',
			installSupported: false,
		});

		await expect.element(browserPage.getByTestId('onboarding-primary-path')).toHaveTextContent('Use zip export/import');
		await expect.element(browserPage.getByTestId('onboarding-primary-path')).toHaveTextContent('Firefox and Safari');
		await expect.element(browserPage.getByText('Connect a sync folder')).not.toBeInTheDocument();
	});

	it('states the data ownership model and exit paths', async () => {
		render(OnboardingGuidance, {
			localFolderSupported: true,
			persistenceStatus: 'unsupported',
			installSupported: false,
			variant: 'about',
		});

		await expect.element(browserPage.getByTestId('data-ownership')).toHaveTextContent('Origin Private File System');
		await expect.element(browserPage.getByTestId('data-ownership')).toHaveTextContent('byte-identical mirror');
		await expect.element(browserPage.getByTestId('data-ownership')).toHaveTextContent('TEI sibling');
		await expect.element(browserPage.getByTestId('data-ownership')).toHaveTextContent('zip export');
	});
});
