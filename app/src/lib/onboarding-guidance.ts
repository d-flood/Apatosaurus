import type { StoragePersistenceStatus } from '$lib/client/capabilities';

export interface OnboardingGuidanceInput {
	localFolderSupported: boolean;
	persistenceStatus: StoragePersistenceStatus;
	installSupported: boolean;
}

export interface OnboardingAction {
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
	const primaryPath = input.localFolderSupported
		? {
				title: 'Connect a sync folder',
				body: 'Mirror committed project files to a folder on your computer, optionally inside a Dropbox, OneDrive, or Drive-managed directory.',
				state: 'recommended' as const,
			}
		: {
				title: 'Use zip export/import',
				body: 'Firefox and Safari are supported with full project zip export/import as the backup and transfer path.',
				state: 'recommended' as const,
			};

	return {
		heading: 'Set up local-first project storage',
		intro:
			'Apatosaurus keeps your scholarship in project files first, with the browser database acting as a rebuildable index.',
		primaryPath,
		actions: [
			{
				title: 'Use a Chromium-based browser',
				body: input.localFolderSupported
					? 'Folder sync is available here, so this browser can use the full recommended backup path.'
					: 'This browser can still use the app and zip backups; folder sync needs directory picker support.',
				state: input.localFolderSupported ? 'ready' : 'unavailable',
			},
			{
				title: 'Install the app',
				body: input.installSupported
					? 'Installing the PWA helps Chromium keep storage and folder permissions reliable.'
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
			'Folder sync creates a byte-identical mirror of committed project files; local-only drafts and app settings stay in the browser.',
			'Every committed transcription and collation has a regenerated TEI sibling for archival use outside the app.',
			'You can leave with your data through a sync folder or a full project zip export.',
		],
	};
}

export const localFolderUnsupportedBackupMessage =
	'Folder sync requires directory picker support. Use zip export/import as the all-browser backup path.';

export const zipExportBackupPathMessage =
	'Folder sync is unavailable in this browser. Use zip export as your backup path.';
