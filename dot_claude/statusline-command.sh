#!/bin/sh
input=$(cat)
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
model=$(echo "$input" | jq -r '.model.display_name // ""')
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

# Abbreviate home directory
home="$HOME"
short_cwd="${cwd/#$home/\~}"

parts="$short_cwd"
[ -n "$model" ] && parts="$parts | $model"
[ -n "$used" ] && parts="$parts | ctx: $(printf '%.0f' "$used")%"

printf '%s' "$parts"
