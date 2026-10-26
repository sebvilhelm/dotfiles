# Session profiles

Start Pi with a named, user-configurable session profile:

```sh
pi --profile research
pi --profile research --model openai/your-model --thinking high
pi --profile tutor
pi --profile tutor-lunar
```

`tutor` is the general programming tutor; `tutor-lunar` also enables the Lunar
and Houston skills. Both expose only `read` and `web_search`—not `bash`,
`write`, or `edit`.

Requires Pi 1.4 or newer (structured `systemPromptOptions`). The existing
`research.ts` / `--research` mode is unchanged; do not combine it with
`--profile`. Without `--profile`, this extension changes nothing. Profile
selection is startup-only: there is no `/profile` switcher and the last profile
is not remembered.

## Configuration

Profiles support either layout under the agent directory (normally
`~/.pi/agent`):

- `profiles/<name>.json`
- `profiles/<name>/profile.json`

`PI_CODING_AGENT_DIR` is respected. If both exist, `<name>.json` takes
precedence; invalid or unreadable files do not fall back to the directory
layout. Names use letters, digits, underscores and hyphens, starting with a
letter or digit. Only user profiles are read; no project configuration can
select executable tool modules. Paths in a profile resolve relative to its JSON
file and support `~/`. Prompts, skills, and tool modules can live anywhere:
their paths remain explicit, with no automatic discovery of sibling prompts or
tools.

Every property is optional:

```json
{
  "model": { "provider": "openai", "id": "your-model" },
  "thinkingLevel": "medium",
  "tools": ["read", "write", "web_search", "search_ebay"],
  "skills": ["shopping"],
  "skillPaths": ["./skills/shopping"],
  "toolModules": ["./tools/ebay.ts"],
  "inheritContext": false,
  "prompt": { "mode": "replace", "file": "./shopping.md" }
}
```

- **`model`**: exact provider and model ID. Omit to use normal Pi selection.
- **`thinkingLevel`**: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or
  `max`. Pi clamps this to the selected model's capabilities.
- **`tools`**: names or globs of registered built-in, extension, or MCP tools.
- **`skills`**: names/globs or paths to existing skill files/directories.
  Filters both user and project skills. It does not install or discover extra
  skills.
- **`skillPaths`**: extra skill files/directories to discover for this profile.
- **`toolModules`**: local TypeScript/JavaScript modules registered only for
  this profile. See below.
- **`inheritContext`**: defaults to true. False removes `AGENTS.md`/`CLAUDE.md`
  context files from the structured prompt, not from the filesystem or history.
- **`prompt`**: exactly one of `file` or inline `text`. `append` adds
  instructions to Pi's normal prompt. `replace` replaces its default preamble
  and removes configured appended system instructions, but keeps selected
  skills, cwd, and context files unless `inheritContext` is false.

Model/reasoning are startup defaults, not locks. Normal selectors remain
available; new turns and `/reload` do not reset your choices. Explicit CLI model
options win against the profile model. `--thinking` and a CLI model's reasoning
suffix win against profile reasoning. A new process with `--profile` applies the
defaults again, even when opening a saved session. In-process resume/fork
preserves model and reasoning. Resources and prompt settings are reapplied to
the current runtime.

Invalid configuration, missing prompt files, and tool-module failures report an
error, request shutdown, and block further inputs/tool calls instead of silently
falling back to an unrestricted session. Missing tool names produce warnings;
tools that register later can still be selected before the next run.

### Resource selection

For `tools` and `skills`:

- Omitted: inherit normal Pi resources.
- `[]`: select nothing.
- `["read", "web_*"]`: include only matches.
- `{ "include": ["*"], "exclude": ["bash"] }`: exclude matches after inclusion.
- `{ "exclude": ["bash"] }`: inherit resources except the exclusions. For tools,
  this narrows the active set rather than activating every registered tool.

Skill paths start with `/`, `~/`, `./`, or `../`. A directory selects all skills
inside it, and paths may contain `*`/`?` globs. Prefer source-directory
exclusions for work-specific skills with generic names:

```json
{
  "skills": {
    "exclude": [
      "~/.agents/skills/lunar-*/SKILL.md",
      "~/.pi/agent/skills/houston-*/SKILL.md"
    ]
  }
}
```

Keep `read` available if selected skills need to load their instructions.
Excluded skills are removed from the advertised skill list; explicit
`/skill:name` input and `read` calls to excluded skill files are blocked. Pi's
command autocomplete still lists discovered skills.

### Profile-only custom tools

Keep tool modules **outside** Pi's automatically discovered `extensions/`
directory, for example `~/.pi/agent/profiles/tools/ebay.ts`. Export a
registration function that receives only `registerTool`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function register(
  pi: Pick<ExtensionAPI, "registerTool">,
): void {
  pi.registerTool({
    name: "search_ebay",
    label: "eBay search",
    description: "Search eBay listings.",
    parameters: Type.Object({ query: Type.String() }),
    async execute(_id, { query }, ctx) {
      // Implement the integration here, using ctx.signal for cancellation.
      throw new Error(
        `Search not implemented: ${query}; aborted=${ctx.signal?.aborted}`,
      );
    },
  });
}
```

Modules load at session startup, before the profile's tool selection is applied.
They can import Pi-provided dependencies such as TypeBox. Async registration is
supported. They are registration modules, not arbitrary extensions: commands and
lifecycle hooks are not exposed through this API. Do not start background
resources in registration code. Existing installed tool extensions need not move
into modules; simply select their tool names in `tools`.

### Boundaries

This is workflow configuration, **not a security sandbox**. Other global/project
extensions still load, can run their own code, and can contribute messages or
instructions. Tool allowlists are checked for direct and nested calls, including
codemode calls, but tools that remain enabled can do anything their
implementation permits. For example, `bash` can read a skill without using
`read`; codemode can run JavaScript and invoke its own model integrations.
Existing conversation history is not erased or isolated by a profile. Tool
modules execute trusted local code with Pi's full OS permissions.

## Included profiles

The included `research.json` uses `openai/gpt-6-luna` with medium reasoning,
selects only `web_search` and `read`, excludes all skills and coding context
files, and uses `research.md` as its replacement prompt. The prompt is adapted
from the unchanged research extension, permitting local reads when the user
requests them.

The checked-in `tutor.json` uses `tutor.md`, exposes only `read` and
`web_search`, and inherits all discovered skills except those under the Lunar
and Houston skill directories. It retains project context files by default.

This machine also has a local-only `tutor-lunar.json` in
`~/.pi/agent/profiles/`. It uses the same prompt and tools, but selects only
skills from `~/.agents/skills/lunar-*/SKILL.md` and
`~/.pi/agent/skills/houston-*/SKILL.md`; it is intentionally not managed by
chezmoi.

## Verification

Run from the chezmoi repository root:

```sh
deno fmt --check dot_pi/agent/extensions/profiles dot_pi/agent/profiles
deno lint dot_pi/agent/extensions/profiles
deno test --allow-read --allow-write --allow-env --allow-sys=homedir dot_pi/agent/extensions/profiles/core_test.ts
PI_PACKAGE_DIR="$(pnpm root -g)/@earendil-works/pi-coding-agent" \
  node --test dot_pi/agent/extensions/profiles/runtime_test.mjs
```

The runtime tests use Pi's installed extension loader, with stubbed session
actions; no model requests or credentials are needed. Type-check `index.ts` and
`core.ts` against your installed Pi declarations using strict TypeScript and
Node types.
