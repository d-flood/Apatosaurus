class NetworkStatus {
	online = $state(true);

	constructor() {
		if (typeof window !== 'undefined') {
			this.online = navigator.onLine;

			window.addEventListener('online', () => {
				this.online = true;
				console.log('Network: Online');
			});

			window.addEventListener('offline', () => {
				this.online = false;
				console.log('Network: Offline');
			});
		}
	}
}

export const networkStatus = new NetworkStatus();
