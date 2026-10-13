import type { BrowserContext, Page, Route } from '@playwright/test';
import { FakeGoogleDriveApi } from '../src/lib/backup/providers/google-drive-fake.spec-support';

const ACCOUNT_ID = 'google:e2e-user';
const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'];

export class FakeGoogleSignIn {
	readonly drive = new FakeGoogleDriveApi();
	private readonly profile: { name: string; email: string };
	private cancelNext = false;

	constructor(options: { email?: string; name?: string } = {}) {
		this.profile = {
			name: options.name ?? 'E2E Scholar',
			email: options.email ?? 'scholar@example.com',
		};
	}

	async install(target: Page | BrowserContext): Promise<void> {
		await target.route(
			url => url.pathname === '/auth/google/start',
			route =>
				route.fulfill({
					status: 302,
					headers: {
						Location: this.startRedirect(
							new URL(route.request().url()).searchParams.get('return_to')
						),
					},
				})
		);
		await target.route(
			url => url.pathname === '/auth/google/token',
			async route =>
				route.fulfill({
					json: {
						accessToken: await this.drive.tokens.getAccessToken(),
						expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
						scopes: SCOPES,
					},
				})
		);
		await target.route(
			url => url.pathname === '/auth/signout',
			route => route.fulfill({ status: 200 })
		);
		await target.route('https://openidconnect.googleapis.com/v1/userinfo', route =>
			route.fulfill({ json: this.profile })
		);
		await target.route(/^https:\/\/www\.googleapis\.com\/(upload\/)?drive\/v3\//, route =>
			this.forwardToDrive(route)
		);
	}

	cancelNextSignIn(): void {
		this.cancelNext = true;
	}

	private startRedirect(returnTo: string | null): string {
		const params: Record<string, string> = this.cancelNext
			? { 'auth-error': 'access_denied' }
			: { account: ACCOUNT_ID, provider: 'google' };
		this.cancelNext = false;
		const path =
			returnTo?.startsWith('/') && !returnTo.startsWith('//') && !returnTo.includes('\\')
				? returnTo
				: '/data';
		return `${path}#${new URLSearchParams(params)}`;
	}

	private async forwardToDrive(route: Route): Promise<void> {
		const request = route.request();
		const response = await this.drive.fetch(request.url(), {
			method: request.method(),
			headers: await request.allHeaders(),
			body: request.postData() ?? undefined,
		});
		await route.fulfill({
			status: response.status,
			headers: Object.fromEntries(response.headers),
			body: await response.text(),
		});
	}
}
