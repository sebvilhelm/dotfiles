local uv = vim.uv or vim.loop

local lw_path = vim.env.LW_PATH
local extra = {}

if lw_path and lw_path ~= "" then
	local shuttle_schema_path = lw_path .. "/lw-shuttle-go-plan/.schemastore/schema.json"
	if uv.fs_stat(shuttle_schema_path) then
		extra[#extra + 1] = {
			description = "Shuttle go plan",
			fileMatch = "shuttle.yaml",
			name = "shuttle.yaml",
			url = vim.uri_from_fname(shuttle_schema_path),
		}
	end
end

return {
	settings = {
		yaml = {
			schemaStore = {
				-- You must disable built-in schemaStore support if you want to use
				-- this plugin and its advanced options like `ignore`.
				enable = false,
				url = "",
			},
			schemas = require("schemastore").yaml.schemas({
				extra = extra,
			}),
		},
	},
}
