return {
	settings = {
		yaml = {
			schemaStore = {
				-- You must disable built-in schemaStore support if you want to use
				-- this plugin and its advanced options like `ignore`.
				enable = false,
				url = "",
			},
			schemas = require("schemastore").yaml.schemas {
				extra = {
					description = "Shuttle go plan",
					fileMatch = "shuttle.yaml",
					name = "shuttle.yaml",
					url = "file:///Users/svn/code/lunar/lw-shuttle-go-plan/.schemastore/schema.json",
				},
			},
		},
	},
}
