export const WELCOME_SKIPPED_STORAGE_KEY = 'welcomeSkipped';

export function shouldShowWelcome(input: {
	accountCount: number;
	projectCount: number;
	skipped: boolean;
}): boolean {
	return input.accountCount === 0 && input.projectCount === 0 && !input.skipped;
}

export function readWelcomeSkipped(): boolean {
	try {
		return globalThis.localStorage?.getItem(WELCOME_SKIPPED_STORAGE_KEY) === 'true';
	} catch {
		return false;
	}
}

export function recordWelcomeSkipped(): void {
	try {
		globalThis.localStorage?.setItem(WELCOME_SKIPPED_STORAGE_KEY, 'true');
	} catch {
		return;
	}
}
