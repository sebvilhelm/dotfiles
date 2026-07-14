import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

type ReviewTarget = {
	label: string;
	description: string;
	summaryCommand: string;
	diffCommand: string;
};

type RepoResolution = { ok: true; root: string } | { ok: false; error: string };

type ParsedArgs = {
	target?: ReviewTarget;
	focus?: string;
	error?: string;
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
	const trimmed = rawArgs.trim();
	if (!trimmed) {
		return {};
	}

	if (trimmed === "trunk") {
		return { target: buildTrunkTarget() };
	}

	if (["working-copy", "workingcopy", "wc", "working-copy@", "@"].includes(trimmed)) {
		return { target: buildWorkingCopyTarget() };
	}

	if (trimmed.startsWith("revset:")) {
		const revset = trimmed.slice("revset:".length).trim();
		if (!revset) {
			return { error: "Usage: /review-code revset:<jj-revset>" };
		}
		return { target: buildRevsetTarget(revset) };
	}

	if (trimmed.startsWith("revset ")) {
		const revset = trimmed.slice("revset ".length).trim();
		if (!revset) {
			return { error: "Usage: /review-code revset <jj-revset>" };
		}
		return { target: buildRevsetTarget(revset) };
	}

	if (hasUI) {
		return { focus: trimmed };
	}

	return { target: buildRevsetTarget(trimmed) };
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
		description: "Prompt for a jj review target, then ask pi to review it",
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

			pi.sendUserMessage(buildReviewPrompt(repo.root, target, focus || undefined));
		},
	});
}
