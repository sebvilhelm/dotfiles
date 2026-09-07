import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

type UsageRow = {
	sessionRef: string;
	timestampMs: number;
	localDay: string;
	provider: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	costTotal: number;
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

type ScanResult = {
	rows: UsageRow[];
	filesScanned: number;
	errors: number;
};

type ViewKey = "today" | "5wd" | "30d";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
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

function parseUsageRow(sessionRef: string, entry: unknown): UsageRow | null {
	if (!isRecord(entry) || entry.type !== "message") {
		return null;
	}

	const message = entry.message;
	if (!isRecord(message) || message.role !== "assistant") {
		return null;
	}

	const provider = getString(message, "provider");
	const model = getString(message, "model");
	const usage = message.usage;
	if (!provider || !model || !isRecord(usage)) {
		return null;
	}

	const timestampMs = toNumber(message.timestamp) || Date.parse(getString(entry, "timestamp") || "");
	if (!Number.isFinite(timestampMs)) {
		return null;
	}

	const inputTokens = toNumber(usage.input);
	const outputTokens = toNumber(usage.output);
	const cacheReadTokens = toNumber(usage.cacheRead);
	const cacheWriteTokens = toNumber(usage.cacheWrite);
	const cost = isRecord(usage.cost) ? usage.cost : {};

	return {
		sessionRef,
		timestampMs,
		localDay: formatLocalDay(timestampMs),
		provider,
		model,
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheWriteTokens,
		totalTokens: toNumber(usage.totalTokens) || inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
		costTotal: toNumber(cost.total),
	};
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

async function readUsageRows(sessionFile: string): Promise<UsageRow[]> {
	const text = await readFile(sessionFile, "utf8");
	const rows: UsageRow[] = [];

	for (const line of text.split("\n")) {
		if (!line.trim()) {
			continue;
		}
		try {
			const row = parseUsageRow(sessionFile, JSON.parse(line) as unknown);
			if (row) {
				rows.push(row);
			}
		} catch {
			// A partially written or malformed session entry cannot contribute usage.
		}
	}

	return rows;
}

function getSessionScanRoot(ctx: ExtensionContext): string {
	const sessionDir = ctx.sessionManager.getSessionDir();
	return basename(sessionDir).startsWith("--") ? dirname(sessionDir) : sessionDir;
}

async function scanUsage(ctx: ExtensionContext): Promise<ScanResult> {
	const files = await collectSessionFiles(getSessionScanRoot(ctx));
	const rows: UsageRow[] = [];
	let errors = 0;

	for (const sessionFile of files) {
		try {
			rows.push(...(await readUsageRows(sessionFile)));
		} catch {
			errors += 1;
		}
	}

	if (!ctx.sessionManager.getSessionFile()) {
		const sessionRef = `ephemeral:${ctx.sessionManager.getSessionId()}`;
		for (const entry of ctx.sessionManager.getEntries()) {
			const row = parseUsageRow(sessionRef, entry);
			if (row) {
				rows.push(row);
			}
		}
	}

	return { rows, filesScanned: files.length, errors };
}

function filterRowsByDate(rows: UsageRow[], startMs: number, endMs: number): UsageRow[] {
	return rows.filter((row) => row.timestampMs >= startMs && row.timestampMs < endMs);
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
	aggregate.sessions.add(row.sessionRef);
	aggregate.messages += 1;
	aggregate.inputTokens += row.inputTokens;
	aggregate.outputTokens += row.outputTokens;
	aggregate.cacheReadTokens += row.cacheReadTokens;
	aggregate.cacheWriteTokens += row.cacheWriteTokens;
	aggregate.totalTokens += row.totalTokens;
	aggregate.costTotal += row.costTotal;
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
		const aggregate = groups.get(row.localDay);
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
	return align === "right" ? value.padStart(width, " ") : value.padEnd(width, " ");
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
		columns.map((column, index) => padCell(row[index] || "", widths[index] || 0, column.align)).join("  "),
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

function buildReportLines(view: ViewKey, allRows: UsageRow[]): string[] {
	const now = new Date();
	const todayStart = startOfLocalDay(now);
	const tomorrowStart = startOfLocalDay(now);
	tomorrowStart.setDate(tomorrowStart.getDate() + 1);

	if (view === "today") {
		const rows = filterRowsByDate(allRows, todayStart.getTime(), tomorrowStart.getTime());
		return [
			"Today",
			"",
			"Overview",
			...buildOverviewTable(aggregateRows(rows)),
			"",
			"By model",
			...buildModelLines(aggregateByModel(rows)),
		];
	}

	const dayKeys = view === "5wd" ? getRecentWorkingDayKeys(5) : getRecentDayKeys(30);
	const start = startOfLocalDay(dayKeys[0] || formatLocalDay(todayStart.getTime()));
	const end = nextLocalDay(dayKeys[dayKeys.length - 1] || formatLocalDay(todayStart.getTime()));
	const rows = filterRowsByDate(allRows, start.getTime(), end.getTime());
	const title = view === "5wd" ? "Past 5 working days" : "Last 30 days";

	return [
		title,
		`${formatDayLabel(dayKeys[0] || formatLocalDay(todayStart.getTime()))} → ${formatDayLabel(dayKeys[dayKeys.length - 1] || formatLocalDay(todayStart.getTime()))}`,
		"",
		"Overview",
		...buildOverviewTable(aggregateRows(rows)),
		"",
		"By day",
		...buildDayLines(aggregateByDay(rows, dayKeys)),
		"",
		"By model",
		...buildModelLines(aggregateByModel(rows)),
	];
}

function parseCommandArgs(args: string): ViewKey {
	const tokens = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
	let view: ViewKey = "today";
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
		}
	}
	return view;
}

function scanStatus(result: ScanResult): string {
	const status = `read ${pluralize(result.filesScanned, "session file")}`;
	return result.errors === 0 ? status : `${status}; skipped ${pluralize(result.errors, "unreadable file")}`;
}

async function showDashboard(ctx: ExtensionCommandContext, initialView: ViewKey, initialScan: ScanResult): Promise<void> {
	if (ctx.mode !== "tui") {
		console.log(buildReportLines(initialView, initialScan.rows).join("\n"));
		if (ctx.hasUI) {
			ctx.ui.notify(`Usage report written to stdout for ${initialView}`, "info");
		}
		return;
	}

	await ctx.ui.custom((tui, theme, _kb, done) => {
		let activeView: ViewKey = initialView;
		let scan = initialScan;
		let scrollOffset = 0;
		let refreshing = false;
		let notice = scanStatus(scan);
		const cache = new Map<ViewKey, string[]>();

		const getLines = (view: ViewKey): string[] => {
			const existing = cache.get(view);
			if (existing) {
				return existing;
			}
			const lines = buildReportLines(view, scan.rows);
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
			notice = "reading session files…";
			tui.requestRender();
			try {
				scan = await scanUsage(ctx);
				cache.clear();
				notice = scanStatus(scan);
			} catch (error) {
				notice = error instanceof Error ? error.message : "could not read session files";
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
				const body = getLines(activeView);
				const lines = [
					theme.fg("accent", theme.bold("Usage tracker")),
					tabs,
					theme.fg("dim", "1/2/3 switch view  ↑↓ scroll  r re-read  esc close"),
					theme.fg(refreshing ? "warning" : "dim", notice),
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
					selectView(activeView === "30d" ? "5wd" : "today");
					tui.requestRender();
					return;
				}
				if (matchesKey(data, "right") || data === "l") {
					selectView(activeView === "today" ? "5wd" : "30d");
					tui.requestRender();
					return;
				}
				if (matchesKey(data, "up") || data === "k") {
					scrollOffset = Math.max(0, scrollOffset - 1);
					tui.requestRender();
					return;
				}
				if (matchesKey(data, "down") || data === "j") {
					scrollOffset = Math.min(Math.max(0, getLines(activeView).length - 1), scrollOffset + 1);
					tui.requestRender();
				}
			},
		};
	});
}

export default function usageTrackerExtension(pi: ExtensionAPI) {
	pi.registerCommand("usage", {
		description: "Read Pi session files and show spend and token usage by model for today, 5 working days, or 30 days",
		getArgumentCompletions(prefix) {
			const values = ["today", "5wd", "30d"];
			const items = values
				.filter((value) => value.startsWith(prefix.toLowerCase()))
				.map((value) => ({ value, label: value }));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			if (ctx.hasUI) {
				ctx.ui.notify("Reading usage from Pi session files…", "info");
			}
			const scan = await scanUsage(ctx);
			await showDashboard(ctx, parseCommandArgs(args || ""), scan);
		},
	});
}
