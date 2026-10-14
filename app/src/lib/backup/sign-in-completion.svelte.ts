import { ensureLocalDbRuntime } from '$lib/db/runtime';
import type { ProjectLocation, StorageAccount } from '$lib/storage/project-locations';
import { takePendingDriveAccess } from './google-team-locations';
import { completeAccountSignIn } from './location-connections';

interface CompletedSignIn {
	accountId: string;
	provider: StorageAccount['provider'];
	location: ProjectLocation;
	driveAccess: boolean;
}

class SignInCompletion {
	error = $state<string | null>(null);
	completing = $state(false);
	lastCompleted = $state.raw<CompletedSignIn | null>(null);

	async completeFromRedirect(): Promise<void> {
		const params = new URLSearchParams(window.location.hash.slice(1));
		const accountId = params.get('account');
		const provider = params.get('provider');
		const authError = params.get('auth-error');
		if (!accountId && !authError) return;
		const driveAccessAccountId = takePendingDriveAccess();
		history.replaceState(history.state, '', window.location.pathname + window.location.search);
		if (authError) {
			this.error =
				authError === 'access_denied'
					? 'Sign-in was cancelled.'
					: 'Sign-in did not complete. Try again.';
			return;
		}
		if ((provider !== 'dropbox' && provider !== 'google') || !accountId) return;
		this.completing = true;
		this.error = null;
		try {
			await ensureLocalDbRuntime();
			const location = await completeAccountSignIn(accountId, provider);
			this.lastCompleted = {
				accountId,
				provider,
				location,
				driveAccess: driveAccessAccountId === accountId,
			};
		} catch (cause) {
			this.error = cause instanceof Error ? cause.message : 'Sign-in did not complete.';
		} finally {
			this.completing = false;
		}
	}

	dismissError(): void {
		this.error = null;
	}
}

export const signInCompletion = new SignInCompletion();
