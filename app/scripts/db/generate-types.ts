import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyCurrentSchema } from './apply-current-schema';

const db = new Database(':memory:');
applyCurrentSchema(db);

const tables = db
	.prepare(
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
	)
	.all() as Array<{ name: string }>;

const lines = ['export interface Database {'];
for (const table of tables) lines.push(`\t${table.name}: ${toTypeName(table.name)};`);
lines.push('}', '');

for (const table of tables) {
	const columns = db.prepare(`PRAGMA table_info(${quoteIdent(table.name)})`).all() as Array<{
		name: string;
		type: string;
		notnull: number;
	}>;
	lines.push(`export interface ${toTypeName(table.name)} {`);
	for (const column of columns) {
		const tsType = sqliteTypeToTs(column.type);
		lines.push(`\t${column.name}: ${column.notnull ? tsType : `${tsType} | null`};`);
	}
	lines.push('}', '');
}

writeFileSync(join(process.cwd(), 'src/lib/client/db/types.generated.ts'), `${lines.join('\n')}\n`);
db.close();

function sqliteTypeToTs(type: string): string {
	const normalized = type.toUpperCase();
	if (normalized.includes('INT') || normalized.includes('REAL') || normalized.includes('NUM'))
		return 'number';
	return 'string';
}

function toTypeName(table: string): string {
	return table
		.split('_')
		.map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join('');
}

function quoteIdent(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}
