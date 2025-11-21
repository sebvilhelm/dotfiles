local function get_changed_files()
	local handle = io.popen("jj diff --name-only --color=never --no-pager")
	if not handle then
		vim.notify("Failed to run jj diff", vim.log.levels.ERROR)
		return nil
	end

	local result = handle:read("*a")
	handle:close()

	if not result or result == "" then
		vim.notify("No changes found", vim.log.levels.INFO)
		return nil
	end

	return vim.split(result, "\n", { trimempty = true })
end

local function jj_diff_to_qflist()
	local files = get_changed_files()
	if not files then
		return
	end

	local items = {}
	for _, file in ipairs(files) do
		table.insert(items, {
			filename = file,
			text = "Modified",
		})
	end

	vim.fn.setqflist(items, "r")
	vim.cmd("copen")
end

local function jj_diff_to_telescope(opts)
	local files = get_changed_files()
	if not files then
		return
	end

	opts = opts or {}

	local pickers = require("telescope.pickers")
	local finders = require("telescope.finders")
	local conf = require("telescope.config").values
	local actions = require("telescope.actions")
	local action_state = require("telescope.actions.state")

	pickers
		.new(opts, {
			prompt_title = "JJ Changed Files",
			finder = finders.new_table({
				results = files,
			}),
			sorter = conf.generic_sorter(opts),
			previewer = conf.file_previewer(opts),
			attach_mappings = function(prompt_bufnr, _)
				actions.select_default:replace(function()
					actions.close(prompt_bufnr)
					local selection = action_state.get_selected_entry()
					if selection then
						vim.cmd("edit " .. selection.value)
					end
				end)
				return true
			end,
		})
		:find()
end

vim.api.nvim_create_user_command("JJDiff", jj_diff_to_qflist, {})
vim.api.nvim_create_user_command("JJDiffTelescope", jj_diff_to_telescope, {})

vim.keymap.set("n", "gD", jj_diff_to_qflist, { desc = "JJ Changed Files (QF)" })
vim.keymap.set("n", "<leader>fd", jj_diff_to_telescope, { desc = "JJ Changed Files" })