return {
	{
		"mfussenegger/nvim-lint",
		config = function(_, opts)
			local lint = require("lint")

			lint.linters_by_ft = {}

			local function get_search_roots(ctx)
				return {
					ctx.root,
					ctx.cwd,
					(ctx.dirname and ctx.dirname ~= "" and ctx.dirname) or vim.fs.dirname(ctx.filename),
				}
			end

			local function has_root_config(ctx, names)
				for _, root in ipairs(get_search_roots(ctx)) do
					if root and root ~= "" then
						local found = vim.fs.find(names, { path = root, upward = true })
						if #found > 0 then
							return true
						end
					end
				end

				return false
			end

			local function has_available_binary(ctx, name)
				for _, root in ipairs(get_search_roots(ctx)) do
					if root and root ~= "" then
						local found = vim.fs.find({ "node_modules/.bin/" .. name }, { path = root, upward = true })
						if #found > 0 then
							return true
						end
					end
				end

				return vim.fn.executable(name) == 1
			end

			local function package_json_uses_tool(ctx, name)
				local dependency_sections = {
					"dependencies",
					"devDependencies",
					"peerDependencies",
					"optionalDependencies",
				}

				for _, root in ipairs(get_search_roots(ctx)) do
					if root and root ~= "" then
						local package_files = vim.fs.find({ "package.json" }, { path = root, upward = true })
						for _, package_file in ipairs(package_files) do
							local ok, lines = pcall(vim.fn.readfile, package_file)
							if ok then
								local decoded_ok, package = pcall(vim.json.decode, table.concat(lines, "\n"))
								if decoded_ok and type(package) == "table" then
									for _, section in ipairs(dependency_sections) do
										local deps = package[section]
										if type(deps) == "table" and deps[name] then
											return true
										end
									end

									local scripts = package.scripts
									if type(scripts) == "table" then
										for _, script in pairs(scripts) do
											if
												type(script) == "string" and script:match("%f[%w]" .. name .. "%f[%W]")
											then
												return true
											end
										end
									end
								end
							end
						end
					end
				end

				return false
			end

			local js_linters = {}
			local linter_conditions = {}

			local function register_linter(name, opts)
				opts = opts or {}

				local linter = lint.linters[name]
				if not linter then
					return false
				end

				local condition = opts.condition
				if opts.config_files then
					local config_condition = function(ctx)
						return has_root_config(ctx, opts.config_files)
					end

					if condition then
						local previous_condition = condition
						condition = function(ctx)
							return previous_condition(ctx) and config_condition(ctx)
						end
					else
						condition = config_condition
					end
				end

				linter_conditions[name] = condition
				return true
			end

			local function current_ctx(bufnr)
				local filename = vim.api.nvim_buf_get_name(bufnr)
				return {
					filename = filename,
					dirname = filename ~= "" and vim.fs.dirname(filename) or vim.fn.getcwd(),
					cwd = vim.fn.getcwd(),
				}
			end

			local function enabled_linters(bufnr)
				local ctx = current_ctx(bufnr)
				local names = lint._resolve_linter_by_ft(vim.bo[bufnr].filetype)
				local enabled = {}

				for _, name in ipairs(names) do
					local condition = linter_conditions[name]
					if not condition or condition(ctx) then
						table.insert(enabled, name)
					end
				end

				return enabled
			end

			vim.env.ESLINT_D_PPID = vim.fn.getpid()
			if
				register_linter("eslint_d", {
					config_files = {
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
					},
				})
			then
				table.insert(js_linters, "eslint_d")
			end

			if
				register_linter("golangcilint", {
					config_files = {
						".golangci.yml",
						".golangci.yaml",
						".golangci.toml",
						".golangci.json",
						"go.work",
						"go.mod",
					},
				})
			then
				lint.linters_by_ft.go = { "golangcilint" }
			end

			if
				register_linter("oxlint", {
					condition = function(ctx)
						return (has_root_config(ctx, { ".oxlintrc.json" }) or package_json_uses_tool(ctx, "oxlint"))
							and has_available_binary(ctx, "oxlint")
					end,
				})
			then
				table.insert(js_linters, "oxlint")
			end

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
				callback = function(args)
					local names = enabled_linters(args.buf)
					if #names == 0 then
						return
					end

					vim.api.nvim_buf_call(args.buf, function()
						require("lint").try_lint(names)
					end)
				end,
			})
		end,
	},
}
