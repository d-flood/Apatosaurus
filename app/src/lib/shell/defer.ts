export function waitForBrowserIdle(timeoutMs = 1_500): Promise<void> {
	if (typeof window === 'undefined') return Promise.resolve();

	return new Promise(resolve => {
		const idleWindow = window as Window & {
			requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
		};
		if (typeof idleWindow.requestIdleCallback === 'function') {
			idleWindow.requestIdleCallback(() => resolve(), { timeout: timeoutMs });
			return;
		}
		window.setTimeout(resolve, 0);
	});
}
