import catalogJson from './catalog.generated.json';

import type { IgntpCatalog, IgntpCatalogEntry } from './types';

export const igntpCatalog = catalogJson as IgntpCatalog;

export function flattenIgntpCatalogEntries(catalog: IgntpCatalog = igntpCatalog): IgntpCatalogEntry[] {
	return catalog.groups.flatMap(group => group.entries);
}
