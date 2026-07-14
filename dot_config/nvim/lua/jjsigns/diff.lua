local M = {}

function M.lines(text)
	if text == "" then
		return {}
	end

	local lines = vim.split(text, "\n", { plain = true })
	if text:sub(-1) == "\n" then
		table.remove(lines)
	end
	return lines
end

function M.hunks(base_text, current_text)
	local changes = vim.diff(base_text, current_text, {
		algorithm = "histogram",
		result_type = "indices",
	})
	---@cast changes integer[][]

	local hunks = {}
	for _, indices in ipairs(changes) do
		local old_start, old_count, new_start, new_count = unpack(indices)
		local start = math.max(new_start, 1)
		local finish = math.max(start, new_start + new_count - 1)
		local kind
		if old_count == 0 then
			kind = "add"
		elseif new_count == 0 then
			kind = "delete"
		else
			kind = "change"
		end

		table.insert(hunks, {
			type = kind,
			start = start,
			finish = finish,
			old_start = old_start,
			old_count = old_count,
			new_start = new_start,
			new_count = new_count,
		})
	end
	return hunks
end

function M.changed_range(old_line, new_line)
	local max_prefix = math.min(#old_line, #new_line)
	local prefix = 0
	while prefix < max_prefix and old_line:byte(prefix + 1) == new_line:byte(prefix + 1) do
		prefix = prefix + 1
	end

	-- Extmark columns are byte indices, but neither end of the range may split a
	-- multibyte character when two different codepoints share prefix/suffix bytes.
	while prefix > 0 do
		local byte = new_line:byte(prefix + 1)
		if not byte or byte < 0x80 or byte > 0xBF then
			break
		end
		prefix = prefix - 1
	end

	local max_suffix = math.min(#old_line - prefix, #new_line - prefix)
	local suffix = 0
	while suffix < max_suffix and old_line:byte(#old_line - suffix) == new_line:byte(#new_line - suffix) do
		suffix = suffix + 1
	end
	while suffix > 0 do
		local byte = new_line:byte(#new_line - suffix + 1)
		if not byte or byte < 0x80 or byte > 0xBF then
			break
		end
		suffix = suffix - 1
	end

	return prefix, #new_line - suffix
end

return M
