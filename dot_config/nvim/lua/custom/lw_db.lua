local M = {}

local state = {
	environment = nil,
	reason = nil,
	running = false,
}

local plugin_path = vim.fs.joinpath(vim.env.HOME, ".zim", "modules", "lw-zsh", "lw-zsh.plugin.zsh")
local required_environment = { "PGDATABASE", "PGHOST", "PGPORT", "PGUSER" }

local script = [=[
export LW_STARTUP_SIDE_EFFECTS=false
export LW_TERMINAL_UI=false
source "$HOME/.zim/modules/lw-zsh/lw-zsh.plugin.zsh" >&2 || exit 1

# lw-db's default output mode writes the token to the clipboard. The token is
# returned to Neovim over stdout instead, so preserve the user's clipboard.
function pbcopy() { : }
function xclip() { : }

# A failed lw-db validation can return success. Do not let an inherited token
# make that look like a successful refresh.
unset PGPASSWORD
lw-db "$@" >&2
exit_code=$?
if (( exit_code != 0 )) || [[ -z "$PGPASSWORD" ]]; then
  print -u2 -- "lw-db did not produce a new database token"
  exit 1
fi

print -rn -- "$PGPASSWORD"
]=]

local function notify(message, level)
	vim.notify(message, level or vim.log.levels.INFO, { title = "lw-db" })
end

local function inferred_environment()
	if state.environment then
		return state.environment
	end

	return (vim.env.AWS_PROFILE or ""):match("^lw%-(.+)$")
end

local function validate_environment()
	local missing = vim.tbl_filter(function(name)
		return not vim.env[name] or vim.env[name] == ""
	end, required_environment)

	if #missing == 0 then
		return true
	end

	notify(
		"Missing environment variables: " .. table.concat(missing, ", ") .. ". Run lw-db before opening Neovim.",
		vim.log.levels.ERROR
	)
	return false
end

local function sanitize_error(stderr)
	local message = (stderr or ""):gsub("\27%[[0-9;]*m", ""):gsub("%s+$", "")
	if message == "" then
		return "Failed to refresh database credentials"
	end
	return message
end

local function run(environment, reason)
	state.environment = environment
	state.reason = reason
	state.running = true

	local command = {
		"zsh",
		"-f",
		"-c",
		script,
		"lw-db",
		"--env",
		environment,
		"--db",
		vim.env.PGDATABASE,
		"--db-host",
		vim.env.PGHOST,
		"--user",
		vim.env.PGUSER,
		"--reason",
		reason,
	}

	local ok, err = pcall(vim.system, command, { cwd = vim.uv.cwd(), text = true }, function(result)
		vim.schedule(function()
			state.running = false
			if result.code ~= 0 or not result.stdout or result.stdout == "" then
				notify(sanitize_error(result.stderr), vim.log.levels.ERROR)
				return
			end

			vim.env.PGPASSWORD = result.stdout
			notify("Database credentials refreshed")
		end)
	end)

	if not ok then
		state.running = false
		notify(tostring(err), vim.log.levels.ERROR)
	end
end

local function prompt_for_reason(environment)
	local options = { prompt = "Database access reason: " }
	if state.reason then
		options.default = state.reason
	end

	vim.ui.input(options, function(reason)
		if reason == nil then
			return
		end

		reason = vim.trim(reason)
		if reason == "" then
			notify("A database access reason is required", vim.log.levels.ERROR)
			return
		end

		run(environment, reason)
	end)
end

function M.refresh(environment)
	if state.running then
		notify("A credential refresh is already running", vim.log.levels.WARN)
		return
	end
	if vim.fn.filereadable(plugin_path) ~= 1 then
		notify("lw-zsh is not installed at " .. plugin_path, vim.log.levels.ERROR)
		return
	end
	if not validate_environment() then
		return
	end

	environment = environment ~= "" and environment or inferred_environment()
	if environment then
		prompt_for_reason(environment)
		return
	end

	vim.ui.input({ prompt = "Database environment: " }, function(input)
		if input == nil then
			return
		end

		input = vim.trim(input)
		if input == "" then
			notify("A database environment is required", vim.log.levels.ERROR)
			return
		end

		prompt_for_reason(input)
	end)
end

function M.setup()
	vim.api.nvim_create_user_command("LwDbRefresh", function(args)
		M.refresh(args.args)
	end, {
		desc = "Refresh lw-db credentials used by Dadbod",
		nargs = "?",
	})
end

return M
