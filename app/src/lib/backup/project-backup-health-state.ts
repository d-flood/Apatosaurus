export interface InstallNudgeInput {
	hasData: boolean;
	installSupported: boolean;
	isInstalled: boolean;
	currentMilestone: string;
	dismissedMilestone: string | null;
}

export function shouldShowInstallNudge(input: InstallNudgeInput): boolean {
	if (!input.hasData) return false;
	if (!input.installSupported) return false;
	if (input.isInstalled) return false;
	return input.dismissedMilestone !== input.currentMilestone;
}
