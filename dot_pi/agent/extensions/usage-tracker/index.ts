import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";

const EXTENSION_NAME = "usage-tracker";
const DB_FILENAME = "usage-tracker.sqlite";
const DB_PARENT_DIR = "pi";
const AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000;

type UsageShape = {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	cost?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		total?: number;
	};
};

type AssistantMessageShape = {
	role?: string;
	api?: string;
	provider?: string;
	model?: string;
	timestamp?: number;
	usage?: UsageShape;
};

type SessionHeaderShape = {
	type?: string;
	cwd?: string;
};

type SessionEntryShape = {
	type?: string;
	id?: string;
	timestamp?: string;
	message?: AssistantMessageShape;
};

type UsageRow = {
	session_ref: string;
	message_id: string;
	timestamp_ms: number;
	local_day: string;
	cwd: string | null;
	provider: string;
	model: string;
	api: string | null;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cache_write_tokens: number;
	total_tokens: number;
	cost_input: number;
	cost_output: number;
	cost_cache_read: number;
	cost_cache_write: number;
	cost_total: number;
};

type Aggregate = {
	sessions: Set<string>;
	messages: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	costTotal: number;
};

type AggregateSummary = Omit<Aggregate, "sessions"> & {
	sessionCount: number;
};

type SyncStats = {
	filesScanned: number;
	filesUpdated: number;
	messagesImported: number;
	errors: number;
};

type ViewKey = "today" | "5wd" | "30d";

let db: DatabaseSync | null = null;
let syncPromise: Promise<SyncStats> | null = null;

function getStateHome(): string {
	return process.env.XDG_STATE_HOME || join(os.homedir(), ".local", "state");
}

function getDbPath(): string {
	return join(getStateHome(), DB_PARENT_DIR, DB_FILENAME);
}

function getDb(): DatabaseSync {
	if (db) {
		return db;
	}

	const dbPath = getDbPath();
	mkdirSync(dirname(dbPath), { recursive: true });

	const connection = new DatabaseSync(dbPath);
	connection.exec(`
		PRAGMA journal_mode = WAL;
		CREATE TABLE IF NOT EXISTS usage_messages (
			session_ref TEXT NOT NULL,
			message_id TEXT NOT NULL,
			timestamp_ms INTEGER NOT NULL,
			local_day TEXT NOT NULL,
			cwd TEXT,
			provider TEXT NOT NULL,
			model TEXT NOT NULL,
			api TEXT,
			input_tokens INTEGER NOT NULL,
			output_tokens INTEGER NOT NULL,
			cache_read_tokens INTEGER NOT NULL,
			cache_write_tokens INTEGER NOT NULL,
			total_tokens INTEGER NOT NULL,
			cost_input REAL NOT NULL,
			cost_output REAL NOT NULL,
			cost_cache_read REAL NOT NULL,
			cost_cache_write REAL NOT NULL,
			cost_total REAL NOT NULL,
			PRIMARY KEY (session_ref, message_id)
		);
		CREATE INDEX IF NOT EXISTS usage_messages_timestamp_idx ON usage_messages (timestamp_ms);
		CREATE INDEX IF NOT EXISTS usage_messages_local_day_idx ON usage_messages (local_day);
		CREATE INDEX IF NOT EXISTS usage_messages_model_idx ON usage_messages (provider, model);
		CREATE TABLE IF NOT EXISTS sync_state (
			session_file TEXT PRIMARY KEY,
			size_bytes INTEGER NOT NULL,
			mtime_ms INTEGER NOT NULL,
			synced_at_ms INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS meta (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);
	`);

	db = connection;
	return connection;
}

function closeDb(): void {
	if (!db) {
		return;
	}

	db.close();
	db = null;
}

function getMeta(key: string): string | undefined {
	const row = getDb()
		.prepare("SELECT value FROM meta WHERE key = :key")
		.get({ key }) as { value?: string } | undefined;
	return row?.value;
}

function setMeta(key: string, value: string): void {
	getDb()
		.prepare(`
			INSERT INTO meta (key, value)
			VALUES (:key, :value)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value
		`)
		.run({ key, value });
}

function getStoredMs(key: string): number | null {
	const value = getMeta(key);
	if (!value) {
		return null;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function getLastSyncMs(): number | null {
	return getStoredMs("last-sync-ms");
}

function setLastSyncMs(value: number): void {
	setMeta("last-sync-ms", String(value));
}

function getLastGlobalScanMs(): number | null {
	return getStoredMs("last-global-scan-ms");
}

function setLastGlobalScanMs(value: number): void {
	setMeta("last-global-scan-ms", String(value));
}

function toNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatLocalDay(timestampMs: number): string {
	const date = new Date(timestampMs);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function startOfLocalDay(input: Date | string): Date {
	if (typeof input === "string") {
		const [year, month, day] = input.split("-").map((part) => Number(part));
		return new Date(year, month - 1, day, 0, 0, 0, 0);
	}
	return new Date(input.getFullYear(), input.getMonth(), input.getDate(), 0, 0, 0, 0);
}

function nextLocalDay(dayKey: string): Date {
	const date = startOfLocalDay(dayKey);
	date.setDate(date.getDate() + 1);
	return date;
}

function isWeekday(date: Date): boolean {
	const day = date.getDay();
	return day >= 1 && day <= 5;
}

function getRecentDayKeys(count: number): string[] {
	const keys: string[] = [];
	const cursor = startOfLocalDay(new Date());
	for (let index = 0; index < count; index += 1) {
		keys.unshift(formatLocalDay(cursor.getTime()));
		cursor.setDate(cursor.getDate() - 1);
	}
	return keys;
}

function getRecentWorkingDayKeys(count: number): string[] {
	const keys: string[] = [];
	const cursor = startOfLocalDay(new Date());
	while (keys.length < count) {
		if (isWeekday(cursor)) {
			keys.unshift(formatLocalDay(cursor.getTime()));
		}
		cursor.setDate(cursor.getDate() - 1);
	}
	return keys;
}

function formatCurrency(value: number): string {
	if (value >= 100) {
		return `$${value.toFixed(0)}`;
	}
	if (value >= 10) {
		return `$${value.toFixed(2)}`;
	}
	if (value >= 1) {
		return `$${value.toFixed(3)}`;
	}
	return `$${value.toFixed(4)}`;
}

function formatTokens(value: number): string {
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}m`;
	}
	if (value >= 10_000) {
		return `${Math.round(value / 1_000)}k`;
	}
	if (value >= 1_000) {
		return `${(value / 1_000).toFixed(1)}k`;
	}
	return String(Math.round(value));
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

function formatDayLabel(dayKey: string): string {
	const date = startOfLocalDay(dayKey);
	const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
	return `${dayKey} ${weekday}`;
}

function parseUsageRow(sessionRef: string, cwd: string | undefined, entry: SessionEntryShape): UsageRow | null {
	if (entry.type !== "message") {
		return null;
	}

	const message = entry.message;
	if (!message || message.role !== "assistant" || !entry.id) {
		return null;
	}

	const provider = typeof message.provider === "string" ? message.provider : undefined;
	const model = typeof message.model === "string" ? message.model : undefined;
	const usage = message.usage;
	if (!provider || !model || !usage) {
		return null;
	}

	const messageTimestamp = typeof message.timestamp === "number" ? message.timestamp : Date.parse(entry.timestamp || "");
	if (!Number.isFinite(messageTimestamp)) {
		return null;
	}

	const inputTokens = toNumber(usage.input);
	const outputTokens = toNumber(usage.output);
	const cacheReadTokens = toNumber(usage.cacheRead);
	const cacheWriteTokens = toNumber(usage.cacheWrite);
	const totalTokens =
		toNumber(usage.totalTokens) || inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
	const cost = usage.cost || {};

	return {
		session_ref: sessionRef,
		message_id: entry.id,
		timestamp_ms: messageTimestamp,
		local_day: formatLocalDay(messageTimestamp),
		cwd: cwd || null,
		provider,
		model,
		api: typeof message.api === "string" ? message.api : null,
		input_tokens: inputTokens,
		output_tokens: outputTokens,
		cache_read_tokens: cacheReadTokens,
		cache_write_tokens: cacheWriteTokens,
		total_tokens: totalTokens,
		cost_input: toNumber(cost.input),
		cost_output: toNumber(cost.output),
		cost_cache_read: toNumber(cost.cacheRead),
		cost_cache_write: toNumber(cost.cacheWrite),
		cost_total: toNumber(cost.total),
	};
}

function upsertUsageRows(rows: UsageRow[]): number {
	if (rows.length === 0) {
		return 0;
	}

	const connection = getDb();
	const statement = connection.prepare(`
		INSERT INTO usage_messages (
			session_ref,
			message_id,
			timestamp_ms,
			local_day,
			cwd,
			provider,
			model,
			api,
			input_tokens,
			output_tokens,
			cache_read_tokens,
			cache_write_tokens,
			total_tokens,
			cost_input,
			cost_output,
			cost_cache_read,
			cost_cache_write,
			cost_total
		)
		VALUES (
			:session_ref,
			:message_id,
			:timestamp_ms,
			:local_day,
			:cwd,
			:provider,
			:model,
			:api,
			:input_tokens,
			:output_tokens,
			:cache_read_tokens,
			:cache_write_tokens,
			:total_tokens,
			:cost_input,
			:cost_output,
			:cost_cache_read,
			:cost_cache_write,
			:cost_total
		)
		ON CONFLICT(session_ref, message_id) DO UPDATE SET
			timestamp_ms = excluded.timestamp_ms,
			local_day = excluded.local_day,
			cwd = excluded.cwd,
			provider = excluded.provider,
			model = excluded.model,
			api = excluded.api,
			input_tokens = excluded.input_tokens,
			output_tokens = excluded.output_tokens,
			cache_read_tokens = excluded.cache_read_tokens,
			cache_write_tokens = excluded.cache_write_tokens,
			total_tokens = excluded.total_tokens,
			cost_input = excluded.cost_input,
			cost_output = excluded.cost_output,
			cost_cache_read = excluded.cost_cache_read,
			cost_cache_write = excluded.cost_cache_write,
			cost_total = excluded.cost_total
	`);

	connection.exec("BEGIN");
	try {
		for (const row of rows) {
			statement.run(row);
		}
		connection.exec("COMMIT");
	} catch (error) {
		connection.exec("ROLLBACK");
		throw error;
	}

	return rows.length;
}

function updateSyncState(sessionFile: string, sizeBytes: number, mtimeMs: number): void {
	getDb()
		.prepare(`
			INSERT INTO sync_state (session_file, size_bytes, mtime_ms, synced_at_ms)
			VALUES (:session_file, :size_bytes, :mtime_ms, :synced_at_ms)
			ON CONFLICT(session_file) DO UPDATE SET
				size_bytes = excluded.size_bytes,
				mtime_ms = excluded.mtime_ms,
				synced_at_ms = excluded.synced_at_ms
		`)
		.run({
			session_file: sessionFile,
			size_bytes: sizeBytes,
			mtime_ms: mtimeMs,
			synced_at_ms: Date.now(),
		});
}

function getSyncState(sessionFile: string): { size_bytes: number; mtime_ms: number } | undefined {
	return getDb()
		.prepare("SELECT size_bytes, mtime_ms FROM sync_state WHERE session_file = :session_file")
		.get({ session_file: sessionFile }) as { size_bytes: number; mtime_ms: number } | undefined;
}

async function collectSessionFiles(rootDir: string): Promise<string[]> {
	if (!rootDir || !existsSync(rootDir)) {
		return [];
	}

	const files: string[] = [];

	async function walk(currentDir: string): Promise<void> {
		const entries = await readdir(currentDir, { withFileTypes: true });
		for (const entry of entries) {
			const nextPath = join(currentDir, entry.name);
			if (entry.isDirectory()) {
				await walk(nextPath);
				continue;
			}
			if (entry.isFile() && entry.name.endsWith(".jsonl")) {
				files.push(nextPath);
			}
		}
	}

	await walk(rootDir);
	files.sort();
	return files;
}

async function syncSessionFile(sessionFile: string, force = false): Promise<{ updated: boolean; imported: number }> {
	const fileStats = await stat(sessionFile);
	const existing = getSyncState(sessionFile);
	if (
		!force &&
		existing &&
		existing.size_bytes === fileStats.size &&
		existing.mtime_ms === fileStats.mtimeMs
	) {
		return { updated: false, imported: 0 };
	}

	const text = await readFile(sessionFile, "utf8");
	const lines = text.split("\n").filter((line) => line.trim().length > 0);
	let cwd: string | undefined;
	const rows: UsageRow[] = [];

	for (const line of lines) {
		let parsed: SessionHeaderShape | SessionEntryShape;
		try {
			parsed = JSON.parse(line) as SessionHeaderShape | SessionEntryShape;
		} catch {
			continue;
		}

		if (parsed.type === "session") {
			cwd = typeof parsed.cwd === "string" ? parsed.cwd : cwd;
			continue;
		}

		const row = parseUsageRow(sessionFile, cwd, parsed as SessionEntryShape);
		if (row) {
			rows.push(row);
		}
	}

	const imported = upsertUsageRows(rows);
	updateSyncState(sessionFile, fileStats.size, fileStats.mtimeMs);
	return { updated: true, imported };
}

async function syncCurrentSession(ctx: ExtensionContext): Promise<number> {
	const sessionFile = ctx.sessionManager.getSessionFile();
	const sessionRef = sessionFile || `ephemeral:${ctx.sessionManager.getSessionId()}`;
	const cwd = ctx.sessionManager.getCwd();
	const rows: UsageRow[] = [];

	for (const entry of ctx.sessionManager.getEntries() as SessionEntryShape[]) {
		const row = parseUsageRow(sessionRef, cwd, entry);
		if (row) {
			rows.push(row);
		}
	}

	const imported = upsertUsageRows(rows);
	if (sessionFile) {
		try {
			const fileStats = await stat(sessionFile);
			updateSyncState(sessionFile, fileStats.size, fileStats.mtimeMs);
		} catch {
			// Ignore transient stat failures for the active session.
		}
	}
	setLastSyncMs(Date.now());
	return imported;
}

function getSessionScanRoot(ctx: ExtensionContext): string {
	const sessionDir = ctx.sessionManager.getSessionDir();
	if (basename(sessionDir).startsWith("--")) {
		return dirname(sessionDir);
	}
	return sessionDir;
}

async function syncAllSessions(ctx: ExtensionContext, force = false): Promise<SyncStats> {
	if (syncPromise) {
		return syncPromise;
	}

	syncPromise = (async () => {
		const lastGlobalScanMs = getLastGlobalScanMs();
		if (!force && lastGlobalScanMs && Date.now() - lastGlobalScanMs < AUTO_SYNC_INTERVAL_MS) {
			return { filesScanned: 0, filesUpdated: 0, messagesImported: 0, errors: 0 };
		}

		const sessionRoot = getSessionScanRoot(ctx);
		const files = await collectSessionFiles(sessionRoot);
		const stats: SyncStats = {
			filesScanned: files.length,
			filesUpdated: 0,
			messagesImported: 0,
			errors: 0,
		};

		for (const sessionFile of files) {
			try {
				const result = await syncSessionFile(sessionFile, force);
				if (result.updated) {
					stats.filesUpdated += 1;
					stats.messagesImported += result.imported;
				}
			} catch {
				stats.errors += 1;
			}
		}

		const nowMs = Date.now();
		setLastGlobalScanMs(nowMs);
		setLastSyncMs(nowMs);
		return stats;
	})().finally(() => {
		syncPromise = null;
	});

	return syncPromise;
}

function queryUsageRows(startMs: number, endMs: number): UsageRow[] {
	return getDb()
		.prepare(`
			SELECT
				session_ref,
				message_id,
				timestamp_ms,
				local_day,
				cwd,
				provider,
				model,
				api,
				input_tokens,
				output_tokens,
				cache_read_tokens,
				cache_write_tokens,
				total_tokens,
				cost_input,
				cost_output,
				cost_cache_read,
				cost_cache_write,
				cost_total
			FROM usage_messages
			WHERE timestamp_ms >= :start_ms AND timestamp_ms < :end_ms
			ORDER BY timestamp_ms ASC
		`)
		.all({ start_ms: startMs, end_ms: endMs }) as UsageRow[];
}

function createAggregate(): Aggregate {
	return {
		sessions: new Set<string>(),
		messages: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		costTotal: 0,
	};
}

function addRow(aggregate: Aggregate, row: UsageRow): void {
	aggregate.sessions.add(row.session_ref);
	aggregate.messages += 1;
	aggregate.inputTokens += row.input_tokens;
	aggregate.outputTokens += row.output_tokens;
	aggregate.cacheReadTokens += row.cache_read_tokens;
	aggregate.cacheWriteTokens += row.cache_write_tokens;
	aggregate.totalTokens += row.total_tokens;
	aggregate.costTotal += row.cost_total;
}

function summarizeAggregate(aggregate: Aggregate): AggregateSummary {
	return {
		sessionCount: aggregate.sessions.size,
		messages: aggregate.messages,
		inputTokens: aggregate.inputTokens,
		outputTokens: aggregate.outputTokens,
		cacheReadTokens: aggregate.cacheReadTokens,
		cacheWriteTokens: aggregate.cacheWriteTokens,
		totalTokens: aggregate.totalTokens,
		costTotal: aggregate.costTotal,
	};
}

function aggregateRows(rows: UsageRow[]): AggregateSummary {
	const aggregate = createAggregate();
	for (const row of rows) {
		addRow(aggregate, row);
	}
	return summarizeAggregate(aggregate);
}

function aggregateByModel(rows: UsageRow[]): Array<{ modelKey: string; summary: AggregateSummary }> {
	const groups = new Map<string, Aggregate>();
	for (const row of rows) {
		const key = `${row.provider}/${row.model}`;
		const aggregate = groups.get(key) || createAggregate();
		addRow(aggregate, row);
		groups.set(key, aggregate);
	}

	return Array.from(groups.entries())
		.map(([modelKey, aggregate]) => ({ modelKey, summary: summarizeAggregate(aggregate) }))
		.sort((left, right) => {
			if (right.summary.costTotal !== left.summary.costTotal) {
				return right.summary.costTotal - left.summary.costTotal;
			}
			return right.summary.totalTokens - left.summary.totalTokens;
		});
}

function aggregateByDay(rows: UsageRow[], dayKeys: string[]): Array<{ dayKey: string; summary: AggregateSummary }> {
	const groups = new Map<string, Aggregate>();
	for (const dayKey of dayKeys) {
		groups.set(dayKey, createAggregate());
	}
	for (const row of rows) {
		const aggregate = groups.get(row.local_day);
		if (aggregate) {
			addRow(aggregate, row);
		}
	}

	return dayKeys.map((dayKey) => ({
		dayKey,
		summary: summarizeAggregate(groups.get(dayKey) || createAggregate()),
	}));
}

type TableColumn = {
	header: string;
	align?: "left" | "right";
};

function padCell(value: string, width: number, align: "left" | "right" = "left"): string {
	if (align === "right") {
		return value.padStart(width, " ");
	}
	return value.padEnd(width, " ");
}

function buildTable(columns: TableColumn[], rows: string[][]): string[] {
	const widths = columns.map((column, index) => {
		let width = column.header.length;
		for (const row of rows) {
			width = Math.max(width, (row[index] || "").length);
		}
		return width;
	});

	const header = columns
		.map((column, index) => padCell(column.header, widths[index] || column.header.length, column.align))
		.join("  ");
	const separator = widths.map((width) => "-".repeat(width)).join("  ");
	const body = rows.map((row) =>
		columns
			.map((column, index) => padCell(row[index] || "", widths[index] || 0, column.align))
			.join("  "),
	);

	return [header, separator, ...body];
}

function buildOverviewTable(summary: AggregateSummary): string[] {
	return buildTable(
		[
			{ header: "Cost", align: "right" },
			{ header: "Sessions", align: "right" },
			{ header: "Msgs", align: "right" },
			{ header: "Input", align: "right" },
			{ header: "Output", align: "right" },
			{ header: "Cache R", align: "right" },
			{ header: "Cache W", align: "right" },
		],
		[
			[
				formatCurrency(summary.costTotal),
				String(summary.sessionCount),
				String(summary.messages),
				formatTokens(summary.inputTokens),
				formatTokens(summary.outputTokens),
				formatTokens(summary.cacheReadTokens),
				formatTokens(summary.cacheWriteTokens),
			],
		],
	);
}

function buildDayLines(dayRows: Array<{ dayKey: string; summary: AggregateSummary }>): string[] {
	return buildTable(
		[
			{ header: "Day" },
			{ header: "Cost", align: "right" },
			{ header: "Sessions", align: "right" },
			{ header: "Msgs", align: "right" },
			{ header: "Input", align: "right" },
			{ header: "Output", align: "right" },
		],
		dayRows.map(({ dayKey, summary }) => [
			formatDayLabel(dayKey),
			formatCurrency(summary.costTotal),
			String(summary.sessionCount),
			String(summary.messages),
			formatTokens(summary.inputTokens),
			formatTokens(summary.outputTokens),
		]),
	);
}

function buildModelLines(modelRows: Array<{ modelKey: string; summary: AggregateSummary }>): string[] {
	if (modelRows.length === 0) {
		return ["no usage"];
	}

	return buildTable(
		[
			{ header: "Model" },
			{ header: "Cost", align: "right" },
			{ header: "Sessions", align: "right" },
			{ header: "Msgs", align: "right" },
			{ header: "Input", align: "right" },
			{ header: "Output", align: "right" },
			{ header: "Cache R", align: "right" },
			{ header: "Cache W", align: "right" },
		],
		modelRows.map(({ modelKey, summary }) => [
			modelKey,
			formatCurrency(summary.costTotal),
			String(summary.sessionCount),
			String(summary.messages),
			formatTokens(summary.inputTokens),
			formatTokens(summary.outputTokens),
			formatTokens(summary.cacheReadTokens),
			formatTokens(summary.cacheWriteTokens),
		]),
	);
}

function buildReportLines(view: ViewKey): string[] {
	const now = new Date();
	const todayStart = startOfLocalDay(now);
	const tomorrowStart = startOfLocalDay(now);
	tomorrowStart.setDate(tomorrowStart.getDate() + 1);

	if (view === "today") {
		const rows = queryUsageRows(todayStart.getTime(), tomorrowStart.getTime());
		const summary = aggregateRows(rows);
		const models = aggregateByModel(rows);
		return ["Today", "", "Overview", ...buildOverviewTable(summary), "", "By model", ...buildModelLines(models)];
	}

	if (view === "5wd") {
		const dayKeys = getRecentWorkingDayKeys(5);
		const start = startOfLocalDay(dayKeys[0] || formatLocalDay(todayStart.getTime()));
		const end = nextLocalDay(dayKeys[dayKeys.length - 1] || formatLocalDay(todayStart.getTime()));
		const rows = queryUsageRows(start.getTime(), end.getTime());
		const summary = aggregateRows(rows);
		const models = aggregateByModel(rows);
		const days = aggregateByDay(rows, dayKeys);
		return [
			"Past 5 working days",
			`${formatDayLabel(dayKeys[0] || formatLocalDay(todayStart.getTime()))} → ${formatDayLabel(dayKeys[dayKeys.length - 1] || formatLocalDay(todayStart.getTime()))}`,
			"",
			"Overview",
			...buildOverviewTable(summary),
			"",
			"By day",
			...buildDayLines(days),
			"",
			"By model",
			...buildModelLines(models),
		];
	}

	const dayKeys = getRecentDayKeys(30);
	const start = startOfLocalDay(dayKeys[0] || formatLocalDay(todayStart.getTime()));
	const end = nextLocalDay(dayKeys[dayKeys.length - 1] || formatLocalDay(todayStart.getTime()));
	const rows = queryUsageRows(start.getTime(), end.getTime());
	const summary = aggregateRows(rows);
	const models = aggregateByModel(rows);
	const days = aggregateByDay(rows, dayKeys);
	return [
		"Last 30 days",
		`${formatDayLabel(dayKeys[0] || formatLocalDay(todayStart.getTime()))} → ${formatDayLabel(dayKeys[dayKeys.length - 1] || formatLocalDay(todayStart.getTime()))}`,
		"",
		"Overview",
		...buildOverviewTable(summary),
		"",
		"By day",
		...buildDayLines(days),
		"",
		"By model",
		...buildModelLines(models),
	];
}

function parseCommandArgs(args: string): { view: ViewKey; forceSync: boolean } {
	const tokens = args
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);

	let view: ViewKey = "today";
	let forceSync = false;

	for (const token of tokens) {
		switch (token) {
			case "today":
			case "daily":
			case "day":
				view = "today";
				break;
			case "5d":
			case "5wd":
			case "workdays":
			case "working":
				view = "5wd";
				break;
			case "30d":
			case "month":
			case "monthly":
				view = "30d";
				break;
			case "sync":
			case "resync":
			case "refresh":
				forceSync = true;
				break;
		}
	}

	return { view, forceSync };
}

async function showDashboard(ctx: ExtensionCommandContext, initialView: ViewKey): Promise<void> {
	if (ctx.mode !== "tui") {
		const report = buildReportLines(initialView).join("\n");
		console.log(report);
		if (ctx.hasUI) {
			ctx.ui.notify(`Usage report written to stdout for ${initialView}`, "info");
		}
		return;
	}

	await ctx.ui.custom((tui, theme, _kb, done) => {
		let activeView: ViewKey = initialView;
		let scrollOffset = 0;
		let refreshing = false;
		let notice = "";
		const cache = new Map<ViewKey, string[]>();

		const getLines = (view: ViewKey): string[] => {
			const existing = cache.get(view);
			if (existing) {
				return existing;
			}
			const lines = buildReportLines(view);
			cache.set(view, lines);
			return lines;
		};

		const selectView = (nextView: ViewKey) => {
			if (nextView !== activeView) {
				activeView = nextView;
				scrollOffset = 0;
			}
		};

		const refresh = async () => {
			if (refreshing) {
				return;
			}
			refreshing = true;
			notice = "syncing…";
			tui.requestRender();
			try {
				const syncStats = await syncAllSessions(ctx, true);
				await syncCurrentSession(ctx);
				cache.clear();
				notice = `synced ${pluralize(syncStats.filesUpdated, "file")}, imported ${pluralize(syncStats.messagesImported, "message")}`;
			} catch (error) {
				notice = error instanceof Error ? error.message : "sync failed";
			} finally {
				refreshing = false;
				tui.requestRender();
			}
		};

		return {
			render(width: number): string[] {
				const tabs = [
					activeView === "today" ? theme.fg("accent", theme.bold("[1] Today")) : theme.fg("dim", "[1] Today"),
					activeView === "5wd"
						? theme.fg("accent", theme.bold("[2] 5 working days"))
						: theme.fg("dim", "[2] 5 working days"),
					activeView === "30d" ? theme.fg("accent", theme.bold("[3] 30 days")) : theme.fg("dim", "[3] 30 days"),
				].join("  ");

				const lastSync = getLastSyncMs();
				const statusText = notice || (lastSync ? `last sync ${new Date(lastSync).toLocaleString()}` : "not synced yet");
				const statusColor = refreshing ? "warning" : "dim";
				const body = getLines(activeView);
				const lines = [
					theme.fg("accent", theme.bold("Usage tracker")),
					theme.fg("dim", getDbPath()),
					tabs,
					theme.fg("dim", "1/2/3 switch view  ↑↓ scroll  r resync  esc close"),
					theme.fg(statusColor, statusText),
					"",
					...body.slice(scrollOffset),
				];

				return lines.map((line) => truncateToWidth(line, width));
			},
			invalidate(): void {
				cache.clear();
			},
			handleInput(data: string): void {
				if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q" || data === "Q") {
					done(undefined);
					return;
				}

				if (data === "1") {
					selectView("today");
					tui.requestRender();
					return;
				}
				if (data === "2") {
					selectView("5wd");
					tui.requestRender();
					return;
				}
				if (data === "3") {
					selectView("30d");
					tui.requestRender();
					return;
				}
				if (data === "r" || data === "R") {
					void refresh();
					return;
				}
				if (matchesKey(data, "left") || data === "h") {
					selectView(activeView === "30d" ? "5wd" : activeView === "5wd" ? "today" : "today");
					tui.requestRender();
					return;
				}
				if (matchesKey(data, "right") || data === "l") {
					selectView(activeView === "today" ? "5wd" : activeView === "5wd" ? "30d" : "30d");
					tui.requestRender();
					return;
				}
				if (matchesKey(data, "up") || data === "k") {
					scrollOffset = Math.max(0, scrollOffset - 1);
					tui.requestRender();
					return;
				}
				if (matchesKey(data, "down") || data === "j") {
					const body = getLines(activeView);
					scrollOffset = Math.min(Math.max(0, body.length - 1), scrollOffset + 1);
					tui.requestRender();
				}
			},
		};
	});
}

function startBackgroundSync(ctx: ExtensionContext): void {
	void syncAllSessions(ctx).catch(() => {
		// Ignore background sync failures. /usage can resync explicitly.
	});
}

export default function usageTrackerExtension(pi: ExtensionAPI) {
	pi.registerCommand("usage", {
		description: "Show spend and token usage by model for today, 5 working days, or 30 days",
		getArgumentCompletions(prefix) {
			const values = ["today", "5wd", "30d", "resync"];
			const items = values
				.filter((value) => value.startsWith(prefix.toLowerCase()))
				.map((value) => ({ value, label: value }));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const parsed = parseCommandArgs(args || "");

			if (ctx.hasUI) {
				ctx.ui.notify("Preparing usage report…", "info");
			}

			await syncAllSessions(ctx, parsed.forceSync);
			await syncCurrentSession(ctx);
			await showDashboard(ctx, parsed.view);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		startBackgroundSync(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		await syncCurrentSession(ctx);
	});

	pi.on("session_shutdown", async () => {
		if (syncPromise) {
			await syncPromise.catch(() => undefined);
		}
		closeDb();
	});
}
