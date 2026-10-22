import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export interface Selection {
  include?: string[];
  exclude?: string[];
}
export interface Profile {
  model?: { provider: string; id: string };
  thinkingLevel?: ThinkingLevel;
  tools?: Selection;
  skills?: Selection;
  skillPaths?: string[];
  toolModules?: string[];
  inheritContext?: boolean;
  prompt?: { mode: "append" | "replace"; text?: string; file?: string };
}
export interface LoadedProfile {
  profile: Profile;
  directory: string;
  promptText?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function keys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Error(`Unknown ${label} field: ${key}`);
    }
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a nonempty string`);
  }
  return value;
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item) => string(item, label));
}

function selection(value: unknown, label: string): Selection {
  if (Array.isArray(value)) return { include: strings(value, label) };
  const record = object(value, label);
  keys(record, ["include", "exclude"], label);
  return {
    include: record.include === undefined
      ? undefined
      : strings(record.include, `${label}.include`),
    exclude: record.exclude === undefined
      ? undefined
      : strings(record.exclude, `${label}.exclude`),
  };
}

export function parseProfile(value: unknown): Profile {
  const record = object(value, "Profile");
  keys(record, [
    "model",
    "thinkingLevel",
    "tools",
    "skills",
    "skillPaths",
    "toolModules",
    "inheritContext",
    "prompt",
  ], "profile");
  const profile: Profile = {};
  if (record.model !== undefined) {
    const model = object(record.model, "model");
    keys(model, ["provider", "id"], "model");
    profile.model = {
      provider: string(model.provider, "model.provider"),
      id: string(model.id, "model.id"),
    };
  }
  if (record.thinkingLevel !== undefined) {
    const level = THINKING_LEVELS.find((level) =>
      level === record.thinkingLevel
    );
    if (!level) throw new Error("Invalid thinkingLevel");
    profile.thinkingLevel = level;
  }
  if (record.tools !== undefined) {
    profile.tools = selection(record.tools, "tools");
  }
  if (record.skills !== undefined) {
    profile.skills = selection(record.skills, "skills");
  }
  if (record.skillPaths !== undefined) {
    profile.skillPaths = strings(record.skillPaths, "skillPaths");
  }
  if (record.toolModules !== undefined) {
    profile.toolModules = strings(record.toolModules, "toolModules");
  }
  if (record.inheritContext !== undefined) {
    if (typeof record.inheritContext !== "boolean") {
      throw new Error("inheritContext must be a boolean");
    }
    profile.inheritContext = record.inheritContext;
  }
  if (record.prompt !== undefined) {
    const prompt = object(record.prompt, "prompt");
    keys(prompt, ["mode", "text", "file"], "prompt");
    if (prompt.mode !== "append" && prompt.mode !== "replace") {
      throw new Error("prompt.mode must be append or replace");
    }
    if ((prompt.text === undefined) === (prompt.file === undefined)) {
      throw new Error("prompt must have exactly one of text or file");
    }
    profile.prompt = {
      mode: prompt.mode,
      text: prompt.text === undefined
        ? undefined
        : string(prompt.text, "prompt.text"),
      file: prompt.file === undefined
        ? undefined
        : string(prompt.file, "prompt.file"),
    };
  }
  return profile;
}

export function resolveProfilePath(directory: string, path: string): string {
  if (path === "~") return homedir();
  return path.startsWith(`~${sep}`)
    ? join(homedir(), path.slice(2))
    : resolve(directory, path);
}

export async function loadProfile(
  agentDir: string,
  name: string,
): Promise<LoadedProfile> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
    throw new Error("Profile names may contain only letters, digits, _ and -");
  }
  let path = join(agentDir, "profiles", `${name}.json`);
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
    path = join(agentDir, "profiles", name, "profile.json");
    content = await readFile(path, "utf8");
  }
  const directory = dirname(path);
  const profile = parseProfile(JSON.parse(content));
  const promptText = profile.prompt?.file
    ? await readFile(resolveProfilePath(directory, profile.prompt.file), "utf8")
    : profile.prompt?.text;
  return { profile, directory, promptText };
}

function glob(pattern: string, value: string): boolean {
  const escaped = pattern.split("").map((char) => {
    if (char === "*") return ".*";
    if (char === "?") return ".";
    return char.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }).join("");
  return new RegExp(`^${escaped}$`).test(value);
}

/** Name globs, or absolute/~/relative paths matching a file or containing directory. */
export function matchesSelection(
  selection: Selection | undefined,
  name: string,
  directory: string,
  filePath?: string,
): boolean {
  if (!selection) return true;
  const matches = (pattern: string): boolean => {
    const pathPattern = isAbsolute(pattern) || pattern.startsWith("~/") ||
      pattern.startsWith("./") || pattern.startsWith("../");
    if (!pathPattern) return glob(pattern, name);
    if (!filePath) return false;
    const path = resolveProfilePath(directory, pattern);
    const target = resolve(filePath);
    return glob(path, target) ||
      target.startsWith(path.endsWith(sep) ? path : path + sep);
  };
  return (selection.include === undefined || selection.include.some(matches)) &&
    !(selection.exclude?.some(matches) ?? false);
}

export function hasCliOption(args: string[], ...names: string[]): boolean {
  const end = args.indexOf("--");
  return args.slice(0, end === -1 ? args.length : end).some((arg) =>
    names.some((name) => arg === name || arg.startsWith(`${name}=`))
  );
}

export function hasCliThinkingOverride(args: string[]): boolean {
  if (hasCliOption(args, "--thinking")) return true;
  const end = args.indexOf("--");
  const options = args.slice(0, end === -1 ? args.length : end);
  return options.some((arg, index) => {
    const name = ["--model", "--models"].find((name) =>
      arg === name || arg.startsWith(`${name}=`)
    );
    if (!name) return false;
    const value = arg === name
      ? options[index + 1]
      : arg.slice(name.length + 1);
    return value?.split(",").some((pattern) =>
      THINKING_LEVELS.some((level) => pattern.endsWith(`:${level}`))
    ) ?? false;
  });
}

/** Mutate only structured prompt fields owned by the profile. */
export function applyProfilePrompt<
  S extends { name: string; filePath: string },
  C,
>(
  loaded: LoadedProfile,
  options: {
    skills: S[];
    contextFiles: C[];
    customPrompt?: string;
    appendSystemPrompt: string;
    sections: Record<string, string>;
  },
): void {
  const { profile, directory, promptText } = loaded;
  options.skills = options.skills.filter((skill) =>
    matchesSelection(profile.skills, skill.name, directory, skill.filePath)
  );
  if (profile.inheritContext === false) options.contextFiles = [];
  if (promptText === undefined) return;
  if (profile.prompt?.mode === "replace") {
    options.customPrompt = promptText;
    options.appendSystemPrompt = "";
  } else {
    options.sections.profile = promptText;
  }
}
