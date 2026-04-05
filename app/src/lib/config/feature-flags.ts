const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export function parseBooleanFlag(value: string | undefined): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}

	const normalized = value.trim().toLowerCase();
	if (TRUE_VALUES.has(normalized)) {
		return true;
	}
	if (FALSE_VALUES.has(normalized)) {
		return false;
	}
	return undefined;
}

export function resolveCollationEnabled(rawValue: string | undefined, isDev: boolean): boolean {
	const parsed = parseBooleanFlag(rawValue);
	return parsed ?? isDev;
}

export const isCollationEnabled = resolveCollationEnabled(
	import.meta.env.PUBLIC_ENABLE_COLLATION,
	import.meta.env.DEV,
);
