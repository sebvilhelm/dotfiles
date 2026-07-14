local diff = require("jjsigns.diff")

local M = {}

local sign_namespace = vim.api.nvim_create_namespace("jjsigns_signs")
local word_namespace = vim.api.nvim_create_namespace("jjsigns_word_diff")
local blame_namespace = vim.api.nvim_create_namespace("jjsigns_blame")
local states = {}
local configured = false

local config = {
	base = "@-",
	debounce = 100,
	word_diff = false,
	signs = {
		add = { text = "┃", hl = "JjSignsAdd" },
		change = { text = "┃", hl = "JjSignsChange" },
		delete = { text = "▁", hl = "JjSignsDelete" },
		topdelete = { text = "▔", hl = "JjSignsDelete" },
		changedelete = { text = "~", hl = "JjSignsChange" },
	},
}

local function notify(message, level)
	vim.notify(message, level or vim.log.levels.INFO, { title = "jjsigns" })
end

local function current_state()
	local state = states[vim.api.nvim_get_current_buf()]
	if not state then
		notify("Buffer is not in a jj workspace", vim.log.levels.WARN)
	end
	return state
end

local function valid_buffer(bufnr)
	if not vim.api.nvim_buf_is_valid(bufnr) or vim.bo[bufnr].buftype ~= "" then
		return false
	end

	local path = vim.api.nvim_buf_get_name(bufnr)
	return path ~= "" and not path:match("^%a[%w+.-]*://")
end

local function run(root, args, callback, opts)
	local command = { "jj", "--repository", root, "--no-pager", "--color=never" }
	if not opts or not opts.snapshot then
		table.insert(command, "--ignore-working-copy")
	end
	vim.list_extend(command, args)

	vim.system(command, { cwd = root, text = true }, function(result)
		vim.schedule(function()
			callback(result)
		end)
	end)
end

local function relative_path(root, path)
	root = vim.fs.normalize(root)
	path = vim.fs.normalize(path)
	if path == root then
		return "."
	end
	if path:sub(1, #root + 1) ~= root .. "/" then
		return nil
	end
	return path:sub(#root + 2)
end

local function buffer_text(bufnr)
	local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
	local empty_file = #lines == 1
		and lines[1] == ""
		and vim.api.nvim_buf_call(bufnr, function()
			return vim.fn.line2byte(2) == -1
		end)
	if empty_file then
		return "", lines
	end

	local text = table.concat(lines, "\n")
	if vim.bo[bufnr].endofline then
		text = text .. "\n"
	end
	return text, lines
end

local function sign_for_line(hunk, line)
	if hunk.type == "delete" then
		return hunk.new_start == 0 and config.signs.topdelete or config.signs.delete
	end
	if hunk.type ~= "change" then
		return config.signs[hunk.type]
	end

	local changed_lines = math.min(hunk.old_count, hunk.new_count)
	local change_end = hunk.new_start + changed_lines - 1
	if line > change_end then
		return config.signs.add
	end
	if hunk.old_count > hunk.new_count and line == change_end then
		return config.signs.changedelete
	end
	return config.signs.change
end

local function render_word_diff(state, current_lines)
	vim.api.nvim_buf_clear_namespace(state.bufnr, word_namespace, 0, -1)
	if not config.word_diff then
		return
	end

	local old_lines = diff.lines(state.base_text)
	for _, hunk in ipairs(state.hunks) do
		if hunk.type ~= "delete" then
			for offset = 0, hunk.new_count - 1 do
				local line_number = hunk.new_start + offset
				local new_line = current_lines[line_number] or ""
				local start_col, end_col = 0, #new_line
				local highlight = "JjSignsAddInline"
				if offset < hunk.old_count then
					local old_line = old_lines[hunk.old_start + offset] or ""
					start_col, end_col = diff.changed_range(old_line, new_line)
					highlight = "JjSignsChangeInline"
				end
				if start_col < end_col then
					vim.api.nvim_buf_set_extmark(state.bufnr, word_namespace, line_number - 1, start_col, {
						end_col = end_col,
						hl_group = highlight,
						priority = 6,
					})
				end
			end
		end
	end
end

local function render(state)
	if not valid_buffer(state.bufnr) then
		return
	end

	vim.api.nvim_buf_clear_namespace(state.bufnr, sign_namespace, 0, -1)
	local line_count = vim.api.nvim_buf_line_count(state.bufnr)
	for _, hunk in ipairs(state.hunks) do
		local first = math.min(math.max(hunk.start, 1), line_count)
		local last = hunk.type == "delete" and first or math.min(hunk.finish, line_count)
		for line = first, last do
			local sign = sign_for_line(hunk, line)
			vim.api.nvim_buf_set_extmark(state.bufnr, sign_namespace, line - 1, 0, {
				sign_text = sign.text,
				sign_hl_group = sign.hl,
				priority = 6,
			})
		end
	end

	local _, current_lines = buffer_text(state.bufnr)
	render_word_diff(state, current_lines)
end

local function calculate(state, base_text)
	if not valid_buffer(state.bufnr) then
		return
	end

	local current_text = buffer_text(state.bufnr)
	state.base_text = base_text
	state.base_loaded = true
	state.hunks = diff.hunks(base_text, current_text)
	state.blame = nil
	render(state)
end

local function load_base(state, request)
	run(state.root, { "file", "show", "--revision", state.base, "--", state.path }, function(result)
		if request ~= state.request or not valid_buffer(state.bufnr) then
			return
		end
		if result.code == 0 then
			calculate(state, result.stdout)
			return
		end

		-- A tracked file absent from @- is newly added. Ignored and untracked files
		-- are left unattached rather than presenting every line as an addition.
		run(state.root, { "file", "list", "--revision", "@", "--", state.path }, function(list_result)
			if request ~= state.request or not valid_buffer(state.bufnr) then
				return
			end
			if list_result.code == 0 and list_result.stdout ~= "" then
				calculate(state, "")
			else
				state.hunks = {}
				vim.api.nvim_buf_clear_namespace(state.bufnr, sign_namespace, 0, -1)
				vim.api.nvim_buf_clear_namespace(state.bufnr, word_namespace, 0, -1)
			end
		end)
	end)
end

function M.refresh(bufnr)
	bufnr = bufnr or vim.api.nvim_get_current_buf()
	local state = states[bufnr]
	if not state then
		M.attach(bufnr)
		return
	end
	state.request = state.request + 1
	load_base(state, state.request)
end

local function schedule_refresh(bufnr)
	local state = states[bufnr]
	if not state then
		return
	end
	state.debounce_id = state.debounce_id + 1
	local debounce_id = state.debounce_id
	vim.defer_fn(function()
		if states[bufnr] ~= state or state.debounce_id ~= debounce_id then
			return
		end
		if state.base_loaded then
			calculate(state, state.base_text)
		else
			M.refresh(bufnr)
		end
	end, config.debounce)
end

function M.attach(bufnr)
	bufnr = bufnr or vim.api.nvim_get_current_buf()
	if states[bufnr] or not valid_buffer(bufnr) then
		return
	end

	local path = vim.api.nvim_buf_get_name(bufnr)
	vim.system({ "jj", "--no-pager", "--color=never", "--ignore-working-copy", "root" }, {
		cwd = vim.fs.dirname(path),
		text = true,
	}, function(result)
		vim.schedule(function()
			if result.code ~= 0 or not valid_buffer(bufnr) or states[bufnr] then
				return
			end
			local root = vim.trim(result.stdout)
			local relpath = relative_path(root, path)
			if not relpath then
				return
			end
			states[bufnr] = {
				bufnr = bufnr,
				root = root,
				path = relpath,
				hunks = {},
				base = config.base,
				base_text = "",
				base_loaded = false,
				request = 0,
				debounce_id = 0,
			}
			M.refresh(bufnr)
		end)
	end)
end

local function hunk_target(direction, hunks, row, count, wrap)
	local first_index, last_index, step, is_target
	if direction == "next" then
		first_index, last_index, step = 1, #hunks, 1
		is_target = function(hunk)
			return hunk.start > row
		end
	else
		first_index, last_index, step = #hunks, 1, -1
		is_target = function(hunk)
			return hunk.start < row
		end
	end

	local index
	for i = first_index, last_index, step do
		if is_target(hunks[i]) then
			index = i
			break
		end
	end
	if not index then
		if not wrap then
			return nil
		end
		index = first_index
	end

	for _ = 2, count do
		index = index + step
		if index < 1 or index > #hunks then
			if not wrap then
				return nil
			end
			index = first_index
		end
	end
	return hunks[index]
end

function M.nav_hunk(direction, opts)
	opts = opts or {}
	local state = states[vim.api.nvim_get_current_buf()]
	if not state or #state.hunks == 0 then
		notify("No hunks")
		return
	end

	local row = vim.api.nvim_win_get_cursor(0)[1]
	local hunk =
		hunk_target(direction, state.hunks, row, opts.count or vim.v.count1, opts.wrap ~= false and vim.o.wrapscan)
	if not hunk then
		notify("No more hunks")
		return
	end
	vim.api.nvim_win_set_cursor(0, { hunk.start, 0 })
	vim.cmd.normal({ "zv", bang = true })
end

function M.next_hunk(opts)
	M.nav_hunk("next", opts)
end

function M.prev_hunk(opts)
	M.nav_hunk("prev", opts)
end

local function set_base(state, revision)
	state.base = revision
	state.base_loaded = false
	M.refresh(state.bufnr)
end

function M.change_base(revset)
	local state = current_state()
	if not state then
		return
	end

	revset = revset and vim.trim(revset) or ""
	if revset == "" then
		notify("Usage: JjSigns change_base <revset>", vim.log.levels.ERROR)
		return
	end
	local template = 'commit_id ++ "\\n"'
	run(
		state.root,
		{ "log", "--no-graph", "--limit", "2", "--revisions", revset, "--template", template },
		function(result)
			if states[state.bufnr] ~= state then
				return
			end
			local revisions = vim.split(vim.trim(result.stdout), "\n", { trimempty = true })
			if result.code ~= 0 or #revisions ~= 1 then
				local message = result.code ~= 0 and vim.trim(result.stderr)
					or ("Revset must resolve to one revision: %s"):format(revset)
				notify(message, vim.log.levels.ERROR)
				return
			end

			set_base(state, revset)
		end
	)
end

function M.reset_base()
	local state = current_state()
	if state then
		set_base(state, config.base)
	end
end

local function load_blame(state, callback)
	if state.blame then
		callback(state.blame)
		return
	end

	local template = 'json(commit) ++ "\\n"'
	run(state.root, { "file", "annotate", "--revision", "@", "--template", template, state.path }, function(result)
		if result.code ~= 0 then
			notify(vim.trim(result.stderr), vim.log.levels.ERROR)
			return
		end

		local blame = {}
		for line in result.stdout:gmatch("[^\n]+") do
			local ok, value = pcall(vim.json.decode, line)
			if ok then
				table.insert(blame, value)
			end
		end
		state.blame = blame
		callback(blame)
	end, { snapshot = true })
end

local function commit_summary(commit)
	return vim.trim(commit.description or ""):match("[^\n]*") or ""
end

local function author_name(commit)
	return (commit.author or {}).name or ""
end

local function render_chunks(chunks)
	local text = {}
	local highlights = {}
	local col = 0
	for _, chunk in ipairs(chunks) do
		local value, highlight = chunk[1], chunk[2]
		table.insert(text, value)
		if highlight and value ~= "" then
			table.insert(highlights, { start_col = col, end_col = col + #value, highlight = highlight })
		end
		col = col + #value
	end
	return table.concat(text), highlights
end

local function apply_highlights(bufnr, highlights)
	vim.api.nvim_buf_clear_namespace(bufnr, blame_namespace, 0, -1)
	for row, line_highlights in ipairs(highlights) do
		for _, highlight in ipairs(line_highlights) do
			vim.api.nvim_buf_set_extmark(bufnr, blame_namespace, row - 1, highlight.start_col, {
				end_col = highlight.end_col,
				hl_group = highlight.highlight,
			})
		end
	end
end

local function configure_scratch_buffer(bufnr, filetype)
	vim.bo[bufnr].bufhidden = "wipe"
	vim.bo[bufnr].buftype = "nofile"
	if filetype then
		vim.bo[bufnr].filetype = filetype
	end
	vim.bo[bufnr].modifiable = false
	vim.bo[bufnr].swapfile = false
end

local blame_colors = {}
local function blame_color(commit_id)
	local r, g, b = commit_id:match("(%x)%x(%x)%x(%x)")
	if not r then
		return "Directory"
	end
	local function component(value)
		local number = tonumber(value, 16)
		return math.min(0xDF, 0x20 + math.floor((number * 0x10 + (15 - number)) * 0.75))
	end
	local color = component(r) * 0x10000 + component(g) * 0x100 + component(b)
	local name = blame_colors[color]
	if not name then
		name = ("JjSignsBlameColor.%s%s%s"):format(r, g, b)
		vim.api.nvim_set_hl(0, name, { fg = color })
		blame_colors[color] = name
	end
	return name
end

local function blame_timestamp(commit)
	return ((commit.author or {}).timestamp or ""):sub(1, 16):gsub("T", " ")
end

function M.blame_line()
	local state = current_state()
	if not state then
		return
	end
	local line = vim.api.nvim_win_get_cursor(0)[1]
	load_blame(state, function(blame)
		local commit = blame[line]
		if not commit then
			notify("No blame information for this line")
			return
		end
		local title, title_highlights = render_chunks({
			{ (commit.change_id or ""):sub(1, 8), "Directory" },
			{ " ", "NormalFloat" },
			{ author_name(commit) .. " ", "MoreMsg" },
			{ "(" .. blame_timestamp(commit) .. ")", "Label" },
			{ ":", "NormalFloat" },
		})
		local lines = { title, commit_summary(commit) }
		local popup_buf = vim.lsp.util.open_floating_preview(lines, "text", {
			border = "rounded",
			focus_id = "jjsigns_blame_line",
		})
		apply_highlights(popup_buf, { title_highlights, {} })
	end)
end

local function commit_id_at(blame, index)
	local commit = blame[index]
	return commit and commit.commit_id or nil
end

local function blame_graph(first, last)
	if first and last then
		return "╺"
	elseif first then
		return "┍"
	elseif last then
		return "┕"
	end
	return "│"
end

function M.blame()
	local source_win = vim.api.nvim_get_current_win()
	local state = current_state()
	if not state then
		return
	end

	load_blame(state, function(blame)
		if not vim.api.nvim_win_is_valid(source_win) then
			return
		end
		local max_author_width = 0
		for _, commit in ipairs(blame) do
			max_author_width = math.max(max_author_width, vim.fn.strdisplaywidth(author_name(commit)))
		end

		local lines = {}
		local highlights = {}
		local max_width = 0
		for i, commit in ipairs(blame) do
			local commit_id = commit.commit_id or ""
			local first = commit_id ~= commit_id_at(blame, i - 1)
			local last = commit_id ~= commit_id_at(blame, i + 1)
			local color = blame_color(commit_id)
			local chunks = { { blame_graph(first, last), color } }
			if first then
				local author = author_name(commit)
				vim.list_extend(chunks, {
					{ " " },
					{ (commit.change_id or ""):sub(1, 8), color },
					{ " " },
					{ author .. string.rep(" ", max_author_width - vim.fn.strdisplaywidth(author)) },
					{ " " .. blame_timestamp(commit) },
				})
			end

			local show_summary = first and last
			if not first then
				show_summary = commit_id ~= commit_id_at(blame, i - 2)
			end
			local description = commit_summary(commit)
			if show_summary and description ~= "" then
				table.insert(chunks, { " " .. description, "Comment" })
			end

			local text, line_highlights = render_chunks(chunks)
			table.insert(lines, text)
			table.insert(highlights, line_highlights)
			max_width = math.max(max_width, vim.fn.strdisplaywidth(text))
		end

		local blame_buf = vim.api.nvim_create_buf(false, true)
		vim.api.nvim_buf_set_lines(blame_buf, 0, -1, false, lines)
		apply_highlights(blame_buf, highlights)
		configure_scratch_buffer(blame_buf)
		vim.api.nvim_set_current_win(source_win)
		vim.cmd("leftabove vsplit")
		local blame_win = vim.api.nvim_get_current_win()
		vim.api.nvim_win_set_buf(blame_win, blame_buf)
		vim.api.nvim_win_set_width(blame_win, math.min(max_width + 1, math.max(30, math.floor(vim.o.columns * 0.45))))
		vim.wo[blame_win].number = false
		vim.wo[blame_win].relativenumber = false
		vim.wo[blame_win].signcolumn = "no"
		vim.wo[blame_win].wrap = false

		local previous_scrollbind = vim.wo[source_win].scrollbind
		vim.wo[source_win].scrollbind = true
		vim.wo[blame_win].scrollbind = true
		vim.api.nvim_create_autocmd("WinClosed", {
			pattern = tostring(blame_win),
			once = true,
			callback = function()
				if vim.api.nvim_win_is_valid(source_win) then
					vim.wo[source_win].scrollbind = previous_scrollbind
				end
			end,
		})
		vim.api.nvim_win_set_cursor(blame_win, { vim.api.nvim_win_get_cursor(source_win)[1], 0 })
	end)
end

local function add_list_items(items, state)
	for _, hunk in ipairs(state.hunks) do
		table.insert(items, {
			bufnr = state.bufnr,
			lnum = hunk.start,
			end_lnum = hunk.finish,
			text = ("jj %s hunk"):format(hunk.type),
		})
	end
end

local function list_items(target)
	local items = {}
	if target == "attached" or target == "all" then
		for _, state in pairs(states) do
			add_list_items(items, state)
		end
		return items
	end

	local bufnr = target
	if type(bufnr) ~= "number" or bufnr == 0 then
		bufnr = vim.api.nvim_get_current_buf()
	end
	if states[bufnr] then
		add_list_items(items, states[bufnr])
	end
	return items
end

function M.setqflist(target, opts)
	opts = opts or {}
	vim.fn.setqflist({}, " ", {
		title = "jj hunks",
		items = list_items(target),
	})
	if opts.open ~= false then
		vim.cmd.copen()
	end
end

function M.setloclist(nr, target, opts)
	nr = nr or 0
	opts = opts or {}
	vim.fn.setloclist(nr, {}, " ", {
		title = "jj hunks",
		items = list_items(target),
	})
	if opts.open ~= false then
		vim.cmd.lopen()
	end
end

local function revision_content(state, revision, callback)
	if revision == state.base and state.base_loaded then
		callback(state.base_text)
		return
	end

	run(state.root, { "file", "show", "--revision", revision, "--", state.path }, function(result)
		if result.code ~= 0 then
			notify(vim.trim(result.stderr), vim.log.levels.ERROR)
			return
		end
		callback(result.stdout)
	end)
end

function M.diffthis(revision)
	local source_win = vim.api.nvim_get_current_win()
	local source_buf = vim.api.nvim_get_current_buf()
	local state = current_state()
	if not state then
		return
	end
	revision = revision or state.base

	revision_content(state, revision, function(content)
		if not vim.api.nvim_win_is_valid(source_win) then
			return
		end
		local base_buf = vim.api.nvim_create_buf(false, true)
		vim.api.nvim_buf_set_lines(base_buf, 0, -1, false, diff.lines(content))
		configure_scratch_buffer(base_buf, vim.bo[source_buf].filetype)

		vim.api.nvim_set_current_win(source_win)
		vim.cmd.diffthis()
		vim.cmd.vsplit()
		local base_win = vim.api.nvim_get_current_win()
		vim.api.nvim_win_set_buf(base_win, base_buf)
		vim.cmd.diffthis()
		vim.api.nvim_win_set_cursor(
			base_win,
			{ math.min(vim.api.nvim_win_get_cursor(source_win)[1], vim.api.nvim_buf_line_count(base_buf)), 0 }
		)
	end)
end

function M.toggle_word_diff(value)
	if value == nil then
		config.word_diff = not config.word_diff
	else
		config.word_diff = value
	end
	for _, state in pairs(states) do
		render(state)
	end
	return config.word_diff
end

function M.get_hunks(bufnr)
	local state = states[bufnr or vim.api.nvim_get_current_buf()]
	return state and vim.deepcopy(state.hunks) or nil
end

local actions = {
	blame = M.blame,
	blame_line = M.blame_line,
	change_base = M.change_base,
	diffthis = M.diffthis,
	next_hunk = M.next_hunk,
	prev_hunk = M.prev_hunk,
	refresh = M.refresh,
	reset_base = M.reset_base,
	setloclist = M.setloclist,
	setqflist = M.setqflist,
	toggle_word_diff = M.toggle_word_diff,
}

local function create_command()
	vim.api.nvim_create_user_command("JjSigns", function(command)
		local action_name = command.fargs[1]
		local action = actions[action_name]
		if not action then
			notify("Unknown action: " .. (action_name or ""), vim.log.levels.ERROR)
			return
		end
		if action_name == "change_base" or action_name == "diffthis" then
			local revision
			if #command.fargs > 1 then
				revision = table.concat(command.fargs, " ", 2)
			end
			action(revision)
		elseif action_name == "setqflist" then
			action(command.fargs[2])
		elseif action_name == "setloclist" then
			action(0, command.fargs[2])
		else
			action()
		end
	end, {
		nargs = "+",
		complete = function(arg_lead, command_line)
			local words = vim.split(command_line, "%s+")
			if #words > 2 then
				return {}
			end
			local matches = vim.tbl_filter(function(action)
				return vim.startswith(action, arg_lead)
			end, vim.tbl_keys(actions))
			table.sort(matches)
			return matches
		end,
	})
end

function M.setup(opts)
	if configured then
		return
	end
	configured = true
	config = vim.tbl_deep_extend("force", config, opts or {})

	vim.api.nvim_set_hl(0, "JjSignsAdd", { default = true, link = "GitSignsAdd" })
	vim.api.nvim_set_hl(0, "JjSignsChange", { default = true, link = "GitSignsChange" })
	vim.api.nvim_set_hl(0, "JjSignsDelete", { default = true, link = "GitSignsDelete" })
	vim.api.nvim_set_hl(0, "JjSignsAddInline", { default = true, link = "DiffAdd" })
	vim.api.nvim_set_hl(0, "JjSignsChangeInline", { default = true, link = "DiffChange" })

	local group = vim.api.nvim_create_augroup("jjsigns", { clear = true })
	vim.api.nvim_create_autocmd({ "BufReadPost", "BufNewFile" }, {
		group = group,
		callback = function(event)
			M.attach(event.buf)
		end,
	})
	vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI" }, {
		group = group,
		callback = function(event)
			schedule_refresh(event.buf)
		end,
	})
	vim.api.nvim_create_autocmd({ "BufWritePost", "BufEnter", "FocusGained" }, {
		group = group,
		callback = function(event)
			if states[event.buf] then
				M.refresh(event.buf)
			else
				M.attach(event.buf)
			end
		end,
	})
	vim.api.nvim_create_autocmd("BufWipeout", {
		group = group,
		callback = function(event)
			states[event.buf] = nil
		end,
	})

	create_command()
	for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
		if vim.api.nvim_buf_is_loaded(bufnr) then
			M.attach(bufnr)
		end
	end
end

return M
