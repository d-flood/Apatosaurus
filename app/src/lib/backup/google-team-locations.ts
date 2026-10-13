import type { StorageAccount } from '$lib/storage/project-locations';
import { beginSignIn } from './storage-account-auth';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const PENDING_DRIVE_ACCESS_KEY = 'apatosaurus.pending-drive-access';

let pickerLoad: Promise<any> | null = null;

export function googleTeamLocationsEnabled(): boolean {
	return import.meta.env.PUBLIC_GOOGLE_TEAM_LOCATIONS === 'true';
}

export function teamLocationAccounts(
	accounts: StorageAccount[],
	googleEnabled = googleTeamLocationsEnabled()
): StorageAccount[] {
	return accounts.filter(
		account => account.signedIn && (account.provider === 'dropbox' || googleEnabled)
	);
}

export function hasDriveScope(account: StorageAccount): boolean {
	return account.grantedScopes.includes(DRIVE_SCOPE);
}

export function requestDriveAccess(account: StorageAccount): void {
	try {
		sessionStorage.setItem(PENDING_DRIVE_ACCESS_KEY, account.id);
	} catch {
		// Without the reminder the scholar reopens Add team location after the redirect.
	}
	beginSignIn('google', { scopes: 'drive', loginHint: account.email, returnTo: '/data' });
}

export function takePendingDriveAccess(): string | null {
	try {
		const accountId = sessionStorage.getItem(PENDING_DRIVE_ACCESS_KEY);
		sessionStorage.removeItem(PENDING_DRIVE_ACCESS_KEY);
		return accountId;
	} catch {
		return null;
	}
}

export async function pickGoogleFolder(accessToken: string): Promise<string | null> {
	const picker = await loadPicker();
	return new Promise(resolve => {
		const view = new picker.DocsView(picker.ViewId.FOLDERS)
			.setIncludeFolders(true)
			.setSelectFolderEnabled(true)
			.setMimeTypes(FOLDER_MIME_TYPE)
			.setEnableDrives(true);
		new picker.PickerBuilder()
			.addView(view)
			.setOAuthToken(accessToken)
			.setDeveloperKey(import.meta.env.PUBLIC_GOOGLE_PICKER_API_KEY ?? '')
			.setAppId(import.meta.env.PUBLIC_GOOGLE_APP_ID ?? '')
			.setTitle("Choose your team's shared folder")
			.setCallback((data: { action: string; docs?: Array<{ id: string }> }) => {
				if (data.action === picker.Action.PICKED) resolve(data.docs?.[0]?.id ?? null);
				if (data.action === picker.Action.CANCEL) resolve(null);
			})
			.build()
			.setVisible(true);
	});
}

function loadPicker(): Promise<any> {
	pickerLoad ??= new Promise((resolve, reject) => {
		const script = document.createElement('script');
		script.src = 'https://apis.google.com/js/api.js';
		script.onload = () =>
			(window as any).gapi.load('picker', {
				callback: () => resolve((window as any).google.picker),
				onerror: () => reject(new Error('Google Picker could not be loaded.')),
			});
		script.onerror = () => reject(new Error('Google Picker could not be loaded.'));
		document.head.append(script);
	});
	pickerLoad.catch(() => (pickerLoad = null));
	return pickerLoad;
}
