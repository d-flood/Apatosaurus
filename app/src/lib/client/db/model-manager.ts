import { localDbExecute, localDbQuery, localDbTransaction } from './client';
import type { DbRow, DbValue } from './rpc';

export type ConflictBoundInstance<T> = any;

type ModelClass<T> = {
	_meta: { dbTable: string; fields: Record<string, Field<unknown>> };
	_bindRow?: (row: T) => T;
};

type Predicate = { sql: string; params: DbValue[]; ignored?: boolean };

const TABLE_MAP: Record<string, string> = {
	transcription_transcription: 'transcriptions',
	transcription_transcriptionverseindex: 'transcription_verse_index',
	project_project: 'projects',
	project_projecttranscription: 'project_transcriptions',
	collation_collation: 'collations',
	collation_collationartifact: 'collation_artifacts',
	collation_collationwitness: 'collation_witnesses',
	collation_collationtoken: 'collation_tokens',
	collation_collationvariationunit: 'collation_variation_units',
	collation_collationreading: 'collation_readings',
	collation_collationreadingwitness: 'collation_reading_witnesses',
	iiif_iiifmanifestsource: 'iiif_manifest_sources',
	iiif_transcriptionpagecanvaslink: 'transcription_page_canvas_links',
	iiif_iiifcanvasannotation: 'iiif_canvas_annotations',
};

const IGNORED_FIELDS = new Set(['_djazzkit_deleted', '_djazzkit_rev', '_djazzkit_updated_at']);

export class Model<T> {}

export class Manager<T extends object, Fields extends Record<string, Field<unknown>>> {
	constructor(private readonly modelClass: ModelClass<T>) {}

	all(): QuerySet<T, Fields> {
		return new QuerySet<T, Fields>(this.modelClass, this.fields());
	}

	query(): QuerySet<T, Fields> {
		return this.all();
	}

	filter(callback: (fields: Fields) => Predicate): QuerySet<T, Fields> {
		return this.all().filter(callback);
	}

	async get(callback: (fields: Fields) => Predicate): Promise<T> {
		const row = await this.filter(callback).first();
		if (!row) throw new Error('Object not found');
		return row;
	}

	async create(data: Partial<T>): Promise<T> {
		const row = normalizeWriteRow(data as Record<string, unknown>);
		const entries = Object.entries(row).filter(([, value]) => value !== undefined);
		const columns = entries.map(([key]) => quoteIdent(toDbColumn(key)));
		const params = entries.map(([, value]) => normalizeValue(value));
		const placeholders = entries.map(() => '?').join(', ');
		await localDbExecute(
			`INSERT INTO ${quoteIdent(this.tableName())} (${columns.join(', ')}) VALUES (${placeholders})`,
			params
		);
		return this.getById(String(row.id));
	}

	async createMany(rows: Array<Partial<T>>): Promise<T[]> {
		const normalized = rows.map((row) => normalizeWriteRow(row as Record<string, unknown>));
		if (normalized.length === 0) return [];
		const statements = normalized.map((row) => {
			const entries = Object.entries(row).filter(([, value]) => value !== undefined);
			const columns = entries.map(([key]) => quoteIdent(toDbColumn(key)));
			const params = entries.map(([, value]) => normalizeValue(value));
			return {
				sql: `INSERT INTO ${quoteIdent(this.tableName())} (${columns.join(', ')}) VALUES (${entries.map(() => '?').join(', ')})`,
				params,
			};
		});
		await localDbTransaction(statements);
		return this.filter((fields) => fields._djazzkit_id.inList(normalized.map((row) => String(row.id))) as Predicate).all();
	}

	async update(id: string, updates: Partial<T>): Promise<void> {
		if ((updates as Record<string, unknown>)._djazzkit_deleted === true) {
			await this.delete(id);
			return;
		}
		const row = normalizeWriteRow(updates as Record<string, unknown>, { partial: true });
		const entries = Object.entries(row).filter(
			([key, value]) => key !== 'id' && value !== undefined && !IGNORED_FIELDS.has(key)
		);
		if (entries.length === 0) return;
		const assignments = entries.map(([key]) => `${quoteIdent(toDbColumn(key))} = ?`).join(', ');
		await localDbExecute(`UPDATE ${quoteIdent(this.tableName())} SET ${assignments} WHERE id = ?`, [
			...entries.map(([, value]) => normalizeValue(value)),
			id,
		]);
	}

	async delete(id: string): Promise<void> {
		await localDbExecute(`DELETE FROM ${quoteIdent(this.tableName())} WHERE id = ?`, [id]);
	}

	async getById(id: string): Promise<T> {
		const row = await this.filter((fields) => fields._djazzkit_id.eq(id) as Predicate).first();
		if (!row) throw new Error(`Object not found: ${id}`);
		return row;
	}

	getConflicts(_instanceId?: string): Promise<unknown[]> {
		return Promise.resolve([]);
	}

	async resolveConflict(instanceId: string, resolved: Partial<T>): Promise<T> {
		await this.update(instanceId, resolved);
		return this.getById(instanceId);
	}

	conflictInstance(rowOrId: string | T): T {
		const row = typeof rowOrId === 'string' ? ({ _djazzkit_id: rowOrId } as unknown as T) : rowOrId;
		return row;
	}

	private tableName(): string {
		return TABLE_MAP[this.modelClass._meta.dbTable] ?? this.modelClass._meta.dbTable;
	}

	private fields(): Fields {
		return this.modelClass._meta.fields as Fields;
	}
}

export class QuerySet<T extends object, Fields extends Record<string, Field<unknown>>> {
	private predicates: Predicate[] = [];
	private selectedColumns: string[] | null = null;
	private ordering: { column: string; direction: 'asc' | 'desc' }[] = [];

	constructor(
		private readonly modelClass: ModelClass<T>,
		private readonly fields: Fields
	) {}

	filter(callback: (fields: Fields) => Predicate): QuerySet<T, Fields> {
		const predicate = callback(this.fields);
		if (!predicate.ignored) this.predicates.push(predicate);
		return this;
	}

	exclude(callback: (fields: Fields) => Predicate): QuerySet<T, Fields> {
		const predicate = callback(this.fields);
		if (!predicate.ignored) this.predicates.push({
			sql: `NOT (${predicate.sql})`,
			params: predicate.params,
		});
		return this;
	}

	only(...columns: string[]): QuerySet<T, Fields> {
		this.selectedColumns = columns;
		return this;
	}

	orderBy(selector: (fields: Fields) => Field<unknown>, direction: 'asc' | 'desc' = 'asc'): QuerySet<T, Fields> {
		this.ordering.push({ column: selector(this.fields).dbColumn, direction });
		return this;
	}

	async all(): Promise<T[]> {
		const rows = await localDbQuery(this.toSql(), this.predicates.flatMap((predicate) => predicate.params));
		return rows.map((row) => bindRow(this.modelClass, denormalizeReadRow(row) as T));
	}

	async first(): Promise<T | null> {
		const rows = await localDbQuery(`${this.toSql()} LIMIT 1`, this.predicates.flatMap((predicate) => predicate.params));
		const row = rows[0];
		return row ? bindRow(this.modelClass, denormalizeReadRow(row) as T) : null;
	}

	subscribe(callback: (rows: T[]) => void): () => void {
		let active = true;
		void this.all().then((rows) => {
			if (active) callback(rows);
		});
		return () => {
			active = false;
		};
	}

	private toSql(): string {
		const selected = this.selectedColumns?.length
			? this.selectedColumns.map((column) => `${quoteIdent(toDbColumn(column))} AS ${quoteIdent(column)}`).join(', ')
			: '*';
		const where = this.predicates.length > 0 ? ` WHERE ${this.predicates.map((p) => p.sql).join(' AND ')}` : '';
		const order = this.ordering.length > 0
			? ` ORDER BY ${this.ordering.map((entry) => `${quoteIdent(entry.column)} ${entry.direction.toUpperCase()}`).join(', ')}`
			: '';
		return `SELECT ${selected} FROM ${quoteIdent(TABLE_MAP[this.modelClass._meta.dbTable] ?? this.modelClass._meta.dbTable)}${where}${order}`;
	}
}

export class Field<T> {
	readonly dbColumn: string;

	constructor(readonly name: string) {
		this.dbColumn = toDbColumn(name);
	}

	eq(value: unknown): Predicate {
		if (IGNORED_FIELDS.has(this.name)) return { sql: '1', params: [], ignored: true };
		return { sql: `${quoteIdent(this.dbColumn)} = ?`, params: [normalizeValue(value)] };
	}

	ne(value: unknown): Predicate {
		return { sql: `${quoteIdent(this.dbColumn)} != ?`, params: [normalizeValue(value)] };
	}

	inList(values: unknown[]): Predicate {
		if (values.length === 0) return { sql: '0', params: [] };
		return {
			sql: `${quoteIdent(this.dbColumn)} IN (${values.map(() => '?').join(', ')})`,
			params: values.map(normalizeValue),
		};
	}

	contains(value: string): Predicate {
		return { sql: `${quoteIdent(this.dbColumn)} LIKE ?`, params: [`%${value}%`] };
	}
}

export class BooleanField<T> extends Field<T> {}
export class DateTimeField<T> extends Field<T> {}
export class ForeignKeyField<T> extends Field<T> {
	constructor(name: string, readonly target: string) {
		super(name);
	}
}
export class NumberField<T> extends Field<T> {}
export class StringChoiceField<T, Choice extends string> extends Field<T> {}
export class StringField<T> extends Field<T> {}
export class UUIDField<T> extends Field<T> {}

function normalizeWriteRow(row: Record<string, unknown>, options: { partial?: boolean } = {}): Record<string, unknown> {
	const normalized: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(row)) {
		if (IGNORED_FIELDS.has(key)) continue;
		if (key === '_djazzkit_id') normalized.id = value;
		else if (key === '_djazzkit_deleted') continue;
		else normalized[key] = value;
	}
	if (!options.partial && !normalized.id) normalized.id = crypto.randomUUID();
	return normalized;
}

function denormalizeReadRow(row: DbRow): DbRow {
	const result: DbRow = { ...row };
	if (typeof result.id === 'string') {
		result._djazzkit_id = result.id;
		result._djazzkit_rev = 0;
		result._djazzkit_deleted = false;
		result._djazzkit_updated_at = result.updated_at ?? result.created_at ?? '';
	}
	for (const [key, value] of Object.entries(result)) {
		if (value === 0 || value === 1) {
			if (key.startsWith('is_') || key === '_djazzkit_deleted') result[key] = Boolean(value);
		}
	}
	return result;
}

function bindRow<T>(modelClass: ModelClass<T>, row: T): T {
	return modelClass._bindRow ? modelClass._bindRow(row) : row;
}

function toDbColumn(column: string): string {
	return column === '_djazzkit_id' ? 'id' : column;
}

function normalizeValue(value: unknown): DbValue {
	if (value === undefined) return null;
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (value === null || typeof value === 'string' || typeof value === 'number' || value instanceof Uint8Array) return value;
	return JSON.stringify(value);
}

function quoteIdent(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}

export function suppressNotifications(): void {}
export async function resumeNotifications(): Promise<void> {}
export function getSyncClient(): { setUploadsPaused: (paused: boolean) => void } | null {
	return null;
}
