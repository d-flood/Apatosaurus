export interface IgntpCatalogEntry {
	directory: string;
	fileName: string;
	path: string;
	title: string;
	siglum: string;
	duplicateKey: string;
	isSupported: boolean;
	unsupportedReason?: string;
}

export interface IgntpCatalogGroup {
	name: string;
	entries: IgntpCatalogEntry[];
}

export interface IgntpCatalog {
	generatedAt: string;
	groups: IgntpCatalogGroup[];
}
