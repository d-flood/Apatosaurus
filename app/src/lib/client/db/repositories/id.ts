import { nanoid } from 'nanoid';

export function createId(): string {
	return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: nanoid();
}
