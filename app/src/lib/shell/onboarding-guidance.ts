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
	heading: string;
	intro: string;
	primaryPath: OnboardingAction;
	actions: OnboardingAction[];
	dataOwnership: string[];
}

export function buildOnboardingGuidanceContent(
	input: OnboardingGuidanceInput
): OnboardingGuidanceContent {
	const primaryPath = {
		title: 'Choose where projects live',
		body: input.localFolderSupported
			? 'Sign in with Google Drive or Dropbox, or pick a folder on this computer, and projects sync there automatically.'
			: 'Sign in with Google Drive or Dropbox and projects sync there automatically.',
		state: 'recommended' as const,
	};

	return {
		heading: 'Set up local-first project storage',
		intro: 'Apatosaurus keeps your scholarship in project files first, with the browser database acting as a rebuildable index.',
		primaryPath,
		actions: [
			{
				title: 'Install the app',
				body: input.installSupported
					? 'Installing the PWA helps the browser keep storage and folder permissions reliable.'
					: 'If your browser offers installation from its address bar or menu, use it for a more durable workspace.',
				state: input.installSupported ? 'recommended' : 'ready',
			},
			{
				title: 'Allow persistent storage',
				body:
					input.persistenceStatus === 'granted'
						? 'Persistent storage is already granted for this browser profile.'
						: 'Allow persistent storage when prompted so the browser is less likely to evict local project files.',
				state: input.persistenceStatus === 'granted' ? 'ready' : 'recommended',
			},
			primaryPath,
		],
		dataOwnership: [
			'Project files live in the browser Origin Private File System, under Apatosaurus project folders.',
			'Each project syncs as a byte-identical copy of its project files to its project location; app settings stay in the browser.',
			'Every transcription and collation has a regenerated TEI sibling for archival use outside the app.',
			'You can leave with your data through your project location or a full project zip export.',
		],
	};
}
