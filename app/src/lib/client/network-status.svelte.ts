class NetworkStatus {
	online = $state(true);

	constructor() {
		if (typeof window !== 'undefined') {
			this.online = navigator.onLine;

			window.addEventListener('online', () => {
				this.online = true;
			});

			window.addEventListener('offline', () => {
				this.online = false;
			});
		}
	}
}

export const networkStatus = new NetworkStatus();
