---
name: mermaid-diagrams
description: "Create and edit Mermaid diagrams. Use when generating Mermaid fences, choosing a diagram type, or dealing with compatibility across GitHub, Pi, and Pele (mdopen)."
---

# Mermaid diagrams

Use fenced `mermaid` blocks. Keep diagrams focused and labels concise.

## Diagram suggestions

- **Event modeling** (`eventmodeling`): triggers, commands, events, and read models.
- **Sankey**: quantitative flows that split and combine.
- **Architecture** (`architecture-beta`): infrastructure resources and connections.
- **State** (`stateDiagram-v2`): lifecycles and transitions.
- **Swim lane** (`swimlane-beta`): responsibilities and handoffs.
- **Sequence** (`sequenceDiagram`): messages and calls over time.
- **Flowchart** (`flowchart`): general control flow and decisions.

Choose what fits; these are suggestions, not an exhaustive list. Don't default everything to flowcharts.

## Compatibility

- GitHub, Pi, and Pele may support different Mermaid versions and features. Don't assume support transfers between them.
- Prefer plain-text labels. Pele doesn't support arbitrary HTML labels, JavaScript callbacks, or Mermaid themes/`themeVariables`; it uses its own layout and CSS variables.
- Consult the [Mermaid syntax docs](https://mermaid.ai/open-source/intro/syntax-reference.html) and [Pele compatibility notes](https://pele.run/compatibility) when needed. Don't silently replace a desired diagram type because a renderer lacks support; explain the limitation and offer alternatives.
