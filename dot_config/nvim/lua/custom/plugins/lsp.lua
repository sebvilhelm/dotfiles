return {
	{
		"folke/lazydev.nvim",
		ft = "lua", -- only load on lua files
		opts = {
			library = {
				-- See the configuration section for more details
				-- Load luvit types when the `vim.uv` word is found
				{ path = "${3rd}/luv/library", words = { "vim%.uv" } },
			},
		},
	},
	{
		"neovim/nvim-lspconfig",
		dependencies = {
			{ "mason-org/mason.nvim", opts = {} },
			"b0o/SchemaStore.nvim",
			{ "j-hui/fidget.nvim", opts = {} },
		},
		config = function()
			require("custom.lsp")
		end,
	},

	{
		"mfussenegger/nvim-lint",
		config = function(_, opts)
			local lint = require("lint")

			lint.linters_by_ft = {}

			local function has_root_config(ctx, names)
				local search_roots = {
					ctx.root,
					ctx.cwd,
					(ctx.dirname and ctx.dirname ~= "" and ctx.dirname) or vim.fs.dirname(ctx.filename),
				}

				for _, root in ipairs(search_roots) do
					if root and root ~= "" then
						local found = vim.fs.find(names, { path = root, upward = true })
						if #found > 0 then
							return true
						end
					end
				end

				return false
			end

			local js_linters = {}

			local function register_linter(name, config_files)
				local linter = lint.linters[name]
				if not linter then
					return
				end

				lint.linters[name] = vim.tbl_deep_extend("force", linter, {
					condition = function(ctx)
						return has_root_config(ctx, config_files)
					end,
				})

				table.insert(js_linters, name)
			end

			register_linter("eslint_d", {
				"eslint.config.js",
				"eslint.config.cjs",
				"eslint.config.mjs",
				"eslint.config.ts",
				".eslintrc",
				".eslintrc.js",
				".eslintrc.cjs",
				".eslintrc.mjs",
				".eslintrc.ts",
				".eslintrc.json",
				".eslintrc.yaml",
				".eslintrc.yml",
			})

			-- register_linter("oxlint", {
			-- 	"oxlint.json",
			-- 	"oxlint.yaml",
			-- 	"oxlint.yml",
			-- 	"oxlint.toml",
			-- })

			local js_filetypes = {
				"javascript",
				"javascriptreact",
				"typescript",
				"typescriptreact",
			}

			for _, ft in ipairs(js_filetypes) do
				lint.linters_by_ft[ft] = vim.deepcopy(js_linters)
			end

			vim.api.nvim_create_autocmd({ "BufWritePost", "BufReadPost", "InsertLeave" }, {
				callback = function()
					require("lint").try_lint()
				end,
			})
		end,
	},
}
