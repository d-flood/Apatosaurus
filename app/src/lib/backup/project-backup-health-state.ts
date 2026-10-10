type ProjectBackupHealthAction = 'connect-folder' | 'export' | null;

export interface ProjectBackupHealthStateInput {
	hasContent: boolean;
	hasLocation: boolean;
	localFolderSupported: boolean;
}

export interface ProjectBackupHealthState {
	showBrowserOnlyPrompt: boolean;
	primaryAction: ProjectBackupHealthAction;
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
	if (input.hasLocation || !input.hasContent) {
		return { showBrowserOnlyPrompt: false, primaryAction: null };
	}
	return {
		showBrowserOnlyPrompt: true,
		primaryAction: input.localFolderSupported ? 'connect-folder' : 'export',
	};
}

export function shouldShowInstallNudge(input: InstallNudgeInput): boolean {
	if (!input.hasData) return false;
	if (!input.installSupported) return false;
	if (input.isInstalled) return false;
	return input.dismissedMilestone !== input.currentMilestone;
}
