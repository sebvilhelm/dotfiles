import { realpath } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  applyProfilePrompt,
  hasCliOption,
  hasCliThinkingOverride,
  type LoadedProfile,
  loadProfile,
  matchesSelection,
  resolveProfilePath,
} from "./core.ts";

export default function profilesExtension(pi: ExtensionAPI): void {
  pi.registerFlag("profile", {
    description:
      "Session profile from profiles/<name>.json or profiles/<name>/profile.json in the agent directory",
    type: "string",
  });

  let loaded: LoadedProfile | undefined;
  let failure: string | undefined;
  let name: string | undefined;
  const args = process.argv.slice(2);

  const fail = (error: unknown, ctx: ExtensionContext): void => {
    failure = `Profile ${name ?? "configuration"}: ${
      error instanceof Error ? error.message : String(error)
    }`;
    pi.setActiveTools([]);
    ctx.ui.notify(failure, "error");
    // Invalid configuration must not silently fall back to an unrestricted session.
    ctx.shutdown();
  };

  const skillAllowed = (skillName: string, filePath: string): boolean =>
    !loaded || matchesSelection(
      loaded.profile.skills,
      skillName,
      loaded.directory,
      filePath,
    );

  const applyTools = (): void => {
    if (!loaded?.profile.tools) return;
    const selection = loaded.profile.tools;
    const directory = loaded.directory;
    const candidates = selection.include === undefined
      ? pi.getActiveTools()
      : pi.getAllTools().filter((tool) => tool.exposure !== "hidden").map((
        tool,
      ) => tool.name);
    pi.setActiveTools(
      candidates.filter((tool) => matchesSelection(selection, tool, directory)),
    );
  };

  pi.on("session_start", async (event, ctx) => {
    const flag = pi.getFlag("profile");
    if (typeof flag !== "string") return;
    name = flag;
    try {
      if (hasCliOption(args, "--research")) {
        throw new Error("Use either --profile or --research, not both");
      }
      loaded = await loadProfile(getAgentDir(), flag);
      // Modules register tools only. They are not arbitrary extensions with their own hooks.
      const toolApi: Pick<ExtensionAPI, "registerTool"> = {
        registerTool: (tool) => pi.registerTool(tool),
      };
      for (const path of loaded.profile.toolModules ?? []) {
        const module: unknown = await import(
          resolveProfilePath(loaded.directory, path)
        );
        if (
          typeof module !== "object" || module === null ||
          !("default" in module) || typeof module.default !== "function"
        ) {
          throw new Error(
            `Tool module ${path} must export a default registration function`,
          );
        }
        await module.default(toolApi);
      }
      const { profile } = loaded;
      // Reload/resume/fork must not undo the user's in-session model/reasoning choices.
      if (event.reason === "startup" || event.reason === "new") {
        if (
          profile.model &&
          !hasCliOption(args, "--model", "--provider", "--models")
        ) {
          const model = ctx.modelRegistry.find(
            profile.model.provider,
            profile.model.id,
          );
          if (!model) {
            throw new Error(
              `Unknown model ${profile.model.provider}/${profile.model.id}`,
            );
          }
          if (!await pi.setModel(model)) {
            throw new Error(
              `No credentials for ${profile.model.provider}/${profile.model.id}`,
            );
          }
        }
        if (
          profile.thinkingLevel && !hasCliThinkingOverride(args)
        ) {
          pi.setThinkingLevel(profile.thinkingLevel);
        }
      }
      const { directory } = loaded;
      const availableTools = pi.getAllTools();
      for (const pattern of profile.tools?.include ?? []) {
        if (
          !availableTools.some((tool) =>
            matchesSelection({ include: [pattern] }, tool.name, directory)
          )
        ) {
          ctx.ui.notify(
            `Profile ${flag}: no registered tool matches ${pattern} (late tools may still load)`,
            "warning",
          );
        }
      }
      applyTools();
      ctx.ui.setStatus("profile", `profile:${flag}`);
    } catch (error) {
      fail(error, ctx);
    }
  });

  pi.on("resources_discover", () => {
    if (!loaded || failure) return;
    const { profile, directory } = loaded;
    return {
      skillPaths: profile.skillPaths?.map((path) =>
        resolveProfilePath(directory, path)
      ),
    };
  });

  pi.on("before_agent_start", (event) => {
    if (failure) {
      pi.setActiveTools([]);
      return {
        systemPrompt:
          `Configuration error. Do not perform any task. ${failure}`,
      };
    }
    if (!loaded) return;
    applyTools();
    applyProfilePrompt(loaded, event.systemPromptOptions);
  });

  pi.on("input", (event, ctx) => {
    if (failure) {
      ctx.ui.notify(failure, "error");
      return { action: "handled" };
    }
    if (!loaded?.profile.skills) return;
    const match = /^\/skill:([^\s]+)/.exec(event.text);
    if (!match) return;
    const skill = pi.getCommands().find((command) =>
      command.source === "skill" && command.name === `skill:${match[1]}`
    );
    if (skill && !skillAllowed(match[1], skill.sourceInfo.path)) {
      ctx.ui.notify(
        `Skill ${match[1]} is not selected by profile ${name}`,
        "warning",
      );
      return { action: "handled" };
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    if (failure) return { block: true, reason: failure };
    if (!loaded) return;
    if (
      !matchesSelection(loaded.profile.tools, event.toolName, loaded.directory)
    ) {
      return {
        block: true,
        reason: `Tool ${event.toolName} is not selected by profile ${name}`,
      };
    }
    // Also covers nested calls through codemode/other orchestrating tools.
    if (
      loaded.profile.skills && event.toolName === "read" &&
      typeof event.input.path === "string"
    ) {
      const path = resolveProfilePath(
        ctx.cwd,
        event.input.path.replace(/^@/, ""),
      );
      const canonical = await realpath(path).catch(() => path);
      for (
        const skill of pi.getCommands().filter((command) =>
          command.source === "skill"
        )
      ) {
        const skillPath = skill.sourceInfo.path;
        if (canonical !== await realpath(skillPath).catch(() => skillPath)) {
          continue;
        }
        if (!skillAllowed(skill.name.slice("skill:".length), skillPath)) {
          return {
            block: true,
            reason: `Skill ${skill.name} is not selected by profile ${name}`,
          };
        }
        return;
      }
      if (
        basename(path) === "SKILL.md" &&
        !skillAllowed(basename(dirname(path)), path)
      ) {
        return {
          block: true,
          reason: `Skill file is not selected by profile ${name}`,
        };
      }
    }
  });
}
