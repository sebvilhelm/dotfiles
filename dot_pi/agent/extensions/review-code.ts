import {
	ModelSelectorComponent,
	SettingsManager,
	type ExtensionAPI,
	type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

type ReviewTarget = {
	label: string;
	description: string;
	summaryCommand: string;
	diffCommand: string;
};

type ReviewModel = ReturnType<ExtensionCommandContext["modelRegistry"]["getAvailable"]>[number];

type ReviewScopedModel = {
	model: ReviewModel;
	thinkingLevel?: string;
};

type RepoResolution = { ok: true; root: string } | { ok: false; error: string };

type ParsedArgs = {
	target?: ReviewTarget;
	focus?: string;
	modelSpec?: string;
	error?: string;
};

type ModelSelection =
	| { ok: true; model: ReviewModel | undefined }
	| { ok: false; error: string }
	| { ok: false; cancelled: true };

type DefaultModelSelection = {
	provider?: string;
	modelId?: string;
};

const transientSettingsManager = {
	setDefaultModelAndProvider() {
		// review-code should switch the model for this review without rewriting the user's default model setting
	},
} as unknown as SettingsManager;

const VALID_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

const readDefaultModelSelection = (settingsManager: SettingsManager): DefaultModelSelection => ({
	provider: settingsManager.getDefaultProvider(),
	modelId: settingsManager.getDefaultModel(),
});

const restoreDefaultModelSelection = async (
	settingsManager: SettingsManager,
	selection: DefaultModelSelection,
): Promise<void> => {
	if (selection.provider && selection.modelId) {
		settingsManager.setDefaultModelAndProvider(selection.provider, selection.modelId);
		await settingsManager.flush();
		return;
	}

	const internalSettingsManager = settingsManager as unknown as {
		globalSettings: { defaultProvider?: string; defaultModel?: string };
		markModified: (field: "defaultProvider" | "defaultModel") => void;
		save: () => void;
		flush: () => Promise<void>;
	};

	internalSettingsManager.globalSettings.defaultProvider = selection.provider;
	internalSettingsManager.globalSettings.defaultModel = selection.modelId;
	internalSettingsManager.markModified("defaultProvider");
	internalSettingsManager.markModified("defaultModel");
	internalSettingsManager.save();
	await internalSettingsManager.flush();
};

const REVIEW_TRUNK_LABEL = "Diff from trunk() to @";
const REVIEW_WORKING_COPY_LABEL = "Current working copy (@)";
const REVIEW_CUSTOM_REVSET_LABEL = "Custom revset";

const notify = (ctx: ExtensionCommandContext, message: string, level: "info" | "warning" | "error") => {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
		return;
	}

	const writer = level === "error" ? console.error : console.log;
	writer(message);
};

const shellQuote = (value: string): string => `'${value.replace(/'/g, `"'"'`)}'`;

const formatModel = (model: Pick<ReviewModel, "provider" | "id">): string => `${model.provider}/${model.id}`;

const formatModelChoice = (model: ReviewModel): string => {
	const identifier = formatModel(model);
	if (typeof model.name === "string" && model.name.trim() && model.name !== model.id) {
		return `${identifier} — ${model.name}`;
	}
	return identifier;
};

const sameModel = (left: Pick<ReviewModel, "provider" | "id">, right: Pick<ReviewModel, "provider" | "id">): boolean =>
	left.provider === right.provider && left.id === right.id;

const uniqueModels = (models: ReviewModel[]): ReviewModel[] => {
	const seen = new Set<string>();
	const unique: ReviewModel[] = [];

	for (const model of models) {
		const key = formatModel(model);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		unique.push(model);
	}

	return unique;
};

const sortModels = (models: ReviewModel[]): ReviewModel[] =>
	[...models].sort((left, right) => formatModel(left).localeCompare(formatModel(right)));

const hasGlobPattern = (pattern: string): boolean => /[*?[\]]/.test(pattern);

const escapeRegex = (value: string): string => value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");

const globToRegExp = (pattern: string): RegExp => {
	let regex = "^";
	for (const char of pattern) {
		if (char === "*") {
			regex += ".*";
			continue;
		}
		if (char === "?") {
			regex += ".";
			continue;
		}
		regex += escapeRegex(char);
	}
	regex += "$";
	return new RegExp(regex, "i");
};

const splitThinkingLevel = (pattern: string): { modelPattern: string; thinkingLevel?: string } => {
	const trimmed = pattern.trim();
	const colonIdx = trimmed.lastIndexOf(":");
	if (colonIdx === -1) {
		return { modelPattern: trimmed };
	}

	const suffix = trimmed.slice(colonIdx + 1).toLowerCase();
	if (!VALID_THINKING_LEVELS.has(suffix)) {
		return { modelPattern: trimmed };
	}

	return {
		modelPattern: trimmed.slice(0, colonIdx),
		thinkingLevel: suffix,
	};
};

const resolveScopedModels = (
	models: ReviewModel[],
	patterns: string[] | undefined,
): ReviewScopedModel[] => {
	if (!patterns || patterns.length === 0) {
		return [];
	}

	const resolved: ReviewScopedModel[] = [];
	const seen = new Set<string>();

	for (const rawPattern of patterns) {
		const { modelPattern, thinkingLevel } = splitThinkingLevel(rawPattern);
		if (!modelPattern) {
			continue;
		}

		let matches: ReviewModel[] = [];
		if (hasGlobPattern(modelPattern)) {
			const matcher = globToRegExp(modelPattern);
			matches = models.filter((model) => matcher.test(formatModel(model)) || matcher.test(model.id));
		} else if (modelPattern.includes("/")) {
			const normalizedPattern = modelPattern.toLowerCase();
			matches = models.filter((model) => formatModel(model).toLowerCase() === normalizedPattern);
		} else {
			const normalizedPattern = modelPattern.toLowerCase();
			matches = models.filter((model) => {
				if (model.id.toLowerCase() === normalizedPattern) {
					return true;
				}
				return typeof model.name === "string" && model.name.trim().toLowerCase() === normalizedPattern;
			});
		}

		for (const model of matches) {
			const key = formatModel(model);
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			resolved.push({ model, thinkingLevel });
		}
	}

	return resolved;
};

const extractModelSpec = (rawArgs: string): { remainingArgs: string; modelSpec?: string; error?: string } => {
	let modelSpec: string | undefined;
	let duplicateModelSpec = false;

	const remainingArgs = rawArgs
		.replace(/(^|\s)(?:--model(?:=|\s+)|model:)(\S+)/g, (_match, leadingWhitespace: string, value: string) => {
			if (modelSpec !== undefined) {
				duplicateModelSpec = true;
				return leadingWhitespace;
			}

			modelSpec = value.trim();
			return leadingWhitespace;
		})
		.trim();

	if (duplicateModelSpec) {
		return {
			remainingArgs,
			error: "Usage: /review-code [trunk|wc|revset <jj-revset>] [--model <provider/model>]",
		};
	}

	if (/(^|\s)(?:--model(?:\s+|=)?|model:)\s*$/.test(remainingArgs)) {
		return {
			remainingArgs,
			error: "Usage: /review-code [trunk|wc|revset <jj-revset>] [--model <provider/model>]",
		};
	}

	return { remainingArgs, modelSpec };
};

const buildTrunkTarget = (): ReviewTarget => ({
	label: REVIEW_TRUNK_LABEL,
	description: "Review everything in the working copy compared to trunk().",
	summaryCommand: `jj --no-pager diff --from ${shellQuote("trunk()")}` + ` --to @ --summary`,
	diffCommand: `jj --no-pager diff --from ${shellQuote("trunk()")}` + ` --to @ --git`,
});

const buildWorkingCopyTarget = (): ReviewTarget => ({
	label: REVIEW_WORKING_COPY_LABEL,
	description: "Review only the current working-copy change (@ relative to its parent).",
	summaryCommand: `jj --no-pager diff -r ${shellQuote("@")} --summary`,
	diffCommand: `jj --no-pager diff -r ${shellQuote("@")} --git`,
});

const buildRevsetTarget = (revset: string): ReviewTarget => ({
	label: `Revset: ${revset}`,
	description: `Review the diff represented by the revset ${revset}.`,
	summaryCommand: `jj --no-pager diff -r ${shellQuote(revset)} --summary`,
	diffCommand: `jj --no-pager diff -r ${shellQuote(revset)} --git`,
});

const parseArgs = (rawArgs: string, hasUI: boolean): ParsedArgs => {
	const extractedModel = extractModelSpec(rawArgs);
	if (extractedModel.error) {
		return { error: extractedModel.error };
	}

	const trimmed = extractedModel.remainingArgs.trim();
	if (!trimmed) {
		return { modelSpec: extractedModel.modelSpec };
	}

	if (trimmed === "trunk") {
		return { target: buildTrunkTarget(), modelSpec: extractedModel.modelSpec };
	}

	if (["working-copy", "workingcopy", "wc", "working-copy@", "@"].includes(trimmed)) {
		return { target: buildWorkingCopyTarget(), modelSpec: extractedModel.modelSpec };
	}

	if (trimmed.startsWith("revset:")) {
		const revset = trimmed.slice("revset:".length).trim();
		if (!revset) {
			return { error: "Usage: /review-code revset:<jj-revset>" };
		}
		return { target: buildRevsetTarget(revset), modelSpec: extractedModel.modelSpec };
	}

	if (trimmed.startsWith("revset ")) {
		const revset = trimmed.slice("revset ".length).trim();
		if (!revset) {
			return { error: "Usage: /review-code revset <jj-revset>" };
		}
		return { target: buildRevsetTarget(revset), modelSpec: extractedModel.modelSpec };
	}

	if (hasUI) {
		return { focus: trimmed, modelSpec: extractedModel.modelSpec };
	}

	return { target: buildRevsetTarget(trimmed), modelSpec: extractedModel.modelSpec };
};

const resolveJjRepo = async (pi: ExtensionAPI, cwd: string): Promise<RepoResolution> => {
	const result = await pi.exec("jj", ["root"], { cwd, timeout: 5_000 });
	if (result.code !== 0) {
		return { ok: false, error: "review-code: current directory is not inside a jj repository" };
	}

	const root = result.stdout.trim();
	if (!root) {
		return { ok: false, error: "review-code: failed to resolve jj repository root" };
	}

	return { ok: true, root };
};

const promptForTarget = async (ctx: ExtensionCommandContext): Promise<ReviewTarget | undefined> => {
	const choice = await ctx.ui.select("Review what?", [
		REVIEW_TRUNK_LABEL,
		REVIEW_WORKING_COPY_LABEL,
		REVIEW_CUSTOM_REVSET_LABEL,
	]);

	if (!choice) {
		return undefined;
	}

	if (choice === REVIEW_TRUNK_LABEL) {
		return buildTrunkTarget();
	}

	if (choice === REVIEW_WORKING_COPY_LABEL) {
		return buildWorkingCopyTarget();
	}

	const revset = await ctx.ui.input("jj revset to review", "e.g. trunk()..@, @-, bookmark(name)");
	if (revset === undefined) {
		return undefined;
	}

	const trimmed = revset.trim();
	if (!trimmed) {
		notify(ctx, "Revset cannot be empty", "warning");
		return undefined;
	}

	return buildRevsetTarget(trimmed);
};

const promptForFocus = async (
	ctx: ExtensionCommandContext,
	existingFocus?: string,
): Promise<string | undefined> => {
	if (existingFocus !== undefined) {
		return existingFocus.trim();
	}

	if (!ctx.hasUI) {
		return undefined;
	}

	const focus = await ctx.ui.input(
		"Optional review focus",
		"Leave blank for a general review, or name a focus like tests, edge cases, or API changes",
	);
	if (focus === undefined) {
		return undefined;
	}

	return focus.trim();
};

const resolveModelSpec = (models: ReviewModel[], modelSpec: string): ModelSelection => {
	const normalizedSpec = modelSpec.trim().toLowerCase();
	if (!normalizedSpec) {
		return { ok: false, error: "review-code: model cannot be empty" };
	}

	const exactIdentifierMatch = models.find((model) => formatModel(model).toLowerCase() === normalizedSpec);
	if (exactIdentifierMatch) {
		return { ok: true, model: exactIdentifierMatch };
	}

	const byId = models.filter((model) => model.id.toLowerCase() === normalizedSpec);
	const byName = models.filter(
		(model) => typeof model.name === "string" && model.name.trim().toLowerCase() === normalizedSpec,
	);
	const matches = uniqueModels([...byId, ...byName]);

	if (matches.length === 1) {
		return { ok: true, model: matches[0] };
	}

	if (matches.length > 1) {
		return {
			ok: false,
			error: `review-code: model \"${modelSpec}\" is ambiguous. Use one of: ${matches.map((model) => formatModel(model)).join(", ")}`,
		};
	}

	return {
		ok: false,
		error: `review-code: model \"${modelSpec}\" was not found among configured models`,
	};
};

const promptForModelWithSelect = async (
	ctx: ExtensionCommandContext,
	currentModel: ReviewModel | undefined,
	models: ReviewModel[],
): Promise<ModelSelection> => {
	if (!ctx.hasUI) {
		return { ok: true, model: currentModel };
	}

	const modelByChoice = new Map<string, ReviewModel>();
	const choices: string[] = [];

	for (const model of models) {
		const label = currentModel && sameModel(model, currentModel) ? `Current: ${formatModelChoice(model)}` : formatModelChoice(model);
		choices.push(label);
		modelByChoice.set(label, model);
	}

	if (choices.length === 0) {
		return { ok: false, error: "review-code: no configured models are available" };
	}

	const choice = await ctx.ui.select("Review with which model?", choices);
	if (!choice) {
		return { ok: false, cancelled: true };
	}

	const model = modelByChoice.get(choice);
	if (!model) {
		return { ok: false, error: "review-code: failed to resolve the selected model" };
	}

	return { ok: true, model };
};

const promptForModelWithBuiltInSelector = async (
	ctx: ExtensionCommandContext,
	scopedModels: ReviewScopedModel[],
	initialSearchInput?: string,
): Promise<ModelSelection> => {
	const model = await ctx.ui.custom<ReviewModel | null>((tui, _theme, _keybindings, done) =>
		new ModelSelectorComponent(
			tui,
			ctx.model,
			transientSettingsManager,
			ctx.modelRegistry,
			scopedModels,
			(selectedModel) => done(selectedModel as ReviewModel),
			() => done(null),
			initialSearchInput,
		),
	);

	if (model === null) {
		return { ok: false, cancelled: true };
	}
	if (model === undefined) {
		return { ok: false, error: "review-code: failed to open the model selector" };
	}

	return { ok: true, model };
};

const promptForModel = async (
	ctx: ExtensionCommandContext,
	currentModel: ReviewModel | undefined,
	models: ReviewModel[],
	scopedModels: ReviewScopedModel[],
	initialSearchInput?: string,
): Promise<ModelSelection> => {
	if (ctx.mode === "tui") {
		return promptForModelWithBuiltInSelector(ctx, scopedModels, initialSearchInput);
	}

	const defaultModels = scopedModels.length > 0 ? sortModels(uniqueModels(scopedModels.map((scoped) => scoped.model))) : models;
	return promptForModelWithSelect(ctx, currentModel, defaultModels);
};

const selectReviewModel = async (
	ctx: ExtensionCommandContext,
	modelSpec?: string,
): Promise<ModelSelection> => {
	ctx.modelRegistry.refresh();

	const currentModel = ctx.model;
	const settingsManager = SettingsManager.create(ctx.cwd);
	const selectableModels = sortModels(uniqueModels(ctx.modelRegistry.getAvailable()));
	const scopedModels = resolveScopedModels(selectableModels, settingsManager.getEnabledModels());

	if (modelSpec) {
		const resolved = resolveModelSpec(selectableModels, modelSpec);
		if (resolved.ok || ctx.mode !== "tui") {
			return resolved;
		}

		return promptForModel(ctx, currentModel, selectableModels, scopedModels, modelSpec);
	}

	return promptForModel(ctx, currentModel, selectableModels, scopedModels);
};

const buildReviewPrompt = (repoRoot: string, target: ReviewTarget, focus?: string): string => {
	const lines = [
		"Review the current code changes in this jj repository.",
		"",
		`Repository root: ${repoRoot}`,
		`Review target: ${target.label}`,
		`Scope: ${target.description}`,
		"Use Jujutsu commands, not git.",
	];

	if (focus) {
		lines.push(`Extra focus: ${focus}`);
	}

	lines.push(
		"",
		"Start with these commands:",
		`- ${target.summaryCommand}`,
		`- ${target.diffCommand}`,
		"",
		"Then read the relevant changed files and do a proper code review.",
		"Report concrete findings only, ordered by severity.",
		"Prioritize correctness bugs, regressions, missing tests, surprising behavior, and maintainability issues.",
		"Include file paths and line numbers when you can.",
		"If the diff is empty, say so. If you find no issues, say so briefly and mention any residual risk or test gaps.",
	);

	return lines.join("\n");
};

export default function reviewCodeExtension(pi: ExtensionAPI) {
	pi.registerCommand("review-code", {
		description: "Prompt for a jj review target and model, then ask pi to review it",
		handler: async (rawArgs, ctx) => {
			if (!ctx.isIdle()) {
				notify(ctx, "Waiting for the agent to become idle before starting the review prompt", "info");
			}
			await ctx.waitForIdle();

			const repo = await resolveJjRepo(pi, ctx.cwd);
			if (!repo.ok) {
				notify(ctx, repo.error, "error");
				return;
			}

			const parsed = parseArgs(rawArgs, ctx.hasUI);
			if (parsed.error) {
				notify(ctx, parsed.error, "warning");
				return;
			}

			let target = parsed.target;
			if (!target) {
				if (!ctx.hasUI) {
					notify(
						ctx,
						"review-code: interactive UI is unavailable. Pass one of: trunk, wc, revset <expr>, or a raw revset.",
						"error",
					);
					return;
				}

				target = await promptForTarget(ctx);
				if (!target) {
					return;
				}
			}

			const focus = await promptForFocus(ctx, parsed.focus);
			if (focus === undefined && ctx.hasUI && parsed.focus === undefined) {
				return;
			}

			const modelSelection = await selectReviewModel(ctx, parsed.modelSpec);
			if (!modelSelection.ok) {
				if ("error" in modelSelection) {
					notify(ctx, modelSelection.error, "error");
				}
				return;
			}

			const selectedModel = modelSelection.model;
			if (selectedModel && (!ctx.model || !sameModel(selectedModel, ctx.model))) {
				const settingsManager = SettingsManager.create(ctx.cwd);
				const previousDefaultModelSelection = readDefaultModelSelection(settingsManager);

				const success = await pi.setModel(selectedModel);
				if (!success) {
					notify(ctx, `review-code: failed to switch to ${formatModel(selectedModel)}`, "error");
					return;
				}

				try {
					await restoreDefaultModelSelection(settingsManager, previousDefaultModelSelection);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					notify(
						ctx,
						`review-code: switched to ${formatModel(selectedModel)} for this session, but failed to restore the default model setting: ${message}`,
						"warning",
					);
				}
			}

			pi.sendUserMessage(buildReviewPrompt(repo.root, target, focus || undefined));
		},
	});
}
