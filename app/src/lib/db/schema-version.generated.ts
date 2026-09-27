export const INDEX_SCHEMA_VERSION = 1;
export const INDEX_DATABASE_PREFIX = 'apatosaurus-index-v';
export const INDEX_DATABASE_FILENAME = `${INDEX_DATABASE_PREFIX}${INDEX_SCHEMA_VERSION}.db`;
export const INDEX_DATABASE_DIRECTORY = 'apatosaurus/v1/index';
export const INDEX_DATABASE_PATH = `${INDEX_DATABASE_DIRECTORY}/${INDEX_DATABASE_FILENAME}`;
export const INDEX_VFS_NAME = `${INDEX_DATABASE_PREFIX}${INDEX_SCHEMA_VERSION}-opfs`;

export const LEGACY_INDEX_DATABASE_PREFIXES = ['apatosaurus-local-v1'] as const;
