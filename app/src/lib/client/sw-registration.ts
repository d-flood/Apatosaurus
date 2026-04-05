import { dev } from '$app/environment';

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
	if (dev) {
		return null;
	}

	if (!('serviceWorker' in navigator)) {
		console.warn('Service Worker not supported');
		return null;
	}

	try {
		const registration = await navigator.serviceWorker.register('/service-worker.js', {
			scope: '/',
		});

		console.log('Service Worker registered:', registration.scope);

		registration.addEventListener('updatefound', () => {
			const newWorker = registration.installing;

			if (newWorker) {
				newWorker.addEventListener('statechange', () => {
					if (newWorker.state === 'activated') {
						console.log('Service Worker activated');
					}
				});
			}
		});

		return registration;
	} catch (error) {
		console.error('Service Worker registration failed:', error);
		return null;
	}
}

export function unregisterServiceWorker(): Promise<boolean> {
	if (!('serviceWorker' in navigator)) {
		return Promise.resolve(false);
	}

	return navigator.serviceWorker.getRegistration().then((registration) => {
		if (registration) {
			return registration.unregister();
		}
		return false;
	});
}
