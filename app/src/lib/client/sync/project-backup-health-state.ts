export type ProjectBackupHealthStateStatus =
	| 'fresh'
	| 'protected-by-sync'
	| 'protected-by-export'
	| 'browser-only';

export type ProjectBackupHealthAction = 'connect-folder' | 'export' | null;

export interface ProjectBackupHealthStateInput {
	lastCommittedAt: string | null;
	lastSyncedAt: string | null;
	lastExportedAt: string | null;
	hasEnabledSyncTarget: boolean;
	localFolderSupported: boolean;
}

export interface ProjectBackupHealthState {
	status: ProjectBackupHealthStateStatus;
	showBrowserOnlyPrompt: boolean;
	primaryAction: ProjectBackupHealthAction;
	lastCommittedAt: string | null;
	lastSyncedAt: string | null;
	lastExportedAt: string | null;
}

export interface InstallNudgeInput {
	hasData: boolean;
	installSupported: boolean;
	isInstalled: boolean;
	currentMilestone: string;
	dismissedMilestone: string | null;
}

export function deriveProjectBackupHealthState(
	input: ProjectBackupHealthStateInput
): ProjectBackupHealthState {
	if (!input.lastCommittedAt) return baseState(input, 'fresh', false, null);
	if (input.hasEnabledSyncTarget && input.lastSyncedAt) {
		return baseState(input, 'protected-by-sync', false, null);
	}
	if (input.lastExportedAt) return baseState(input, 'protected-by-export', false, null);
	return baseState(
		input,
		'browser-only',
		true,
		input.localFolderSupported ? 'connect-folder' : 'export'
	);
}

export function shouldShowInstallNudge(input: InstallNudgeInput): boolean {
	if (!input.hasData) return false;
	if (!input.installSupported) return false;
	if (input.isInstalled) return false;
	return input.dismissedMilestone !== input.currentMilestone;
}

function baseState(
	input: ProjectBackupHealthStateInput,
	status: ProjectBackupHealthStateStatus,
	showBrowserOnlyPrompt: boolean,
	primaryAction: ProjectBackupHealthAction
): ProjectBackupHealthState {
	return {
		status,
		showBrowserOnlyPrompt,
		primaryAction,
		lastCommittedAt: input.lastCommittedAt,
		lastSyncedAt: input.lastSyncedAt,
		lastExportedAt: input.lastExportedAt,
	};
}
