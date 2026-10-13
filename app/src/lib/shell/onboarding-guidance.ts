import type { StoragePersistenceStatus } from '$lib/shell/capabilities';

export interface OnboardingGuidanceInput {
	localFolderSupported: boolean;
	persistenceStatus: StoragePersistenceStatus;
	installSupported: boolean;
}

interface OnboardingAction {
	title: string;
	body: string;
	state: 'ready' | 'recommended' | 'unavailable';
}

export interface OnboardingGuidanceContent {
	actions: OnboardingAction[];
	dataOwnership: string[];
}

export function buildOnboardingGuidanceContent(
	input: OnboardingGuidanceInput
): OnboardingGuidanceContent {
	return {
		actions: [
			{
				title: 'Choose where projects live',
				body: input.localFolderSupported
					? 'Sign in to Google Drive or Dropbox, or pick a folder on this computer.'
					: 'Sign in to Google Drive or Dropbox.',
				state: 'recommended',
			},
			{
				title: 'Install the app',
				body: input.installSupported
					? 'Keeps storage and folder access reliable.'
					: "Use your browser's install option, if offered.",
				state: input.installSupported ? 'recommended' : 'ready',
			},
			{
				title: 'Allow persistent storage',
				body:
					input.persistenceStatus === 'granted'
						? 'Already granted.'
						: 'Protects local files from browser cleanup.',
				state: input.persistenceStatus === 'granted' ? 'ready' : 'recommended',
			},
		],
		dataOwnership: [
			"Projects are stored in your browser's Origin Private File System.",
			'Each project syncs to its location as an exact copy.',
			'Every transcription and collation is also saved as TEI.',
			'Leave anytime with your location or a zip export.',
		],
	};
}
