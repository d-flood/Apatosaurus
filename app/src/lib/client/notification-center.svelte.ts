export type NotificationTone = 'neutral' | 'warning' | 'error' | 'success';

export interface NotificationAction {
	id: string;
	label: string;
	variant?: 'primary' | 'secondary' | 'neutral' | 'error' | 'ghost';
	onSelect?: () => void | Promise<void>;
}

export interface NotificationItem {
	id: string;
	title: string;
	message: string;
	tone?: NotificationTone;
	persistent?: boolean;
	createdAt: string;
	actions?: NotificationAction[];
}

class NotificationCenter {
	items = $state<NotificationItem[]>([]);

	get count(): number {
		return this.items.length;
	}

	upsert(item: Omit<NotificationItem, 'createdAt'> & { createdAt?: string }): void {
		const existingIndex = this.items.findIndex(existing => existing.id === item.id);
		const next: NotificationItem = {
			...item,
			createdAt: item.createdAt ?? new Date().toISOString()
		};
		if (existingIndex === -1) {
			this.items = [next, ...this.items];
			return;
		}
		const updated = [...this.items];
		updated[existingIndex] = next;
		this.items = updated;
	}

	remove(id: string): void {
		this.items = this.items.filter(item => item.id !== id);
	}

	clearNonPersistent(): void {
		this.items = this.items.filter(item => item.persistent);
	}
}

export const notificationCenter = new NotificationCenter();
