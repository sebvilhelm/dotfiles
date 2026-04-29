local eslint_config_files = {
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
}

local function has_root_config(ctx, names)
	local search_roots = {
		ctx.dirname,
		vim.fn.getcwd(),
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

local function first_formatter(bufnr, ...)
	local conform = require("conform")

	for i = 1, select("#", ...) do
		local formatter = select(i, ...)
		if conform.get_formatter_info(formatter, bufnr).available then
			return formatter
		end
	end

	return select(1, ...)
end

local function js_formatters(bufnr)
	return {
		"eslint_d",
		first_formatter(bufnr, "oxfmt", "prettierd", "prettier"),
	}
end

return {
	{
		"stevearc/conform.nvim",
		opts = {
			formatters = {
				eslint_d = {
					condition = function(_, ctx)
						return has_root_config(ctx, eslint_config_files)
					end,
				},
				oxfmt = {
					require_cwd = true,
				},
				prettierd = {
					require_cwd = true,
				},
				prettier = {
					require_cwd = true,
				},
			},
			formatters_by_ft = {
				lua = { "stylua" },
				-- proto = { "buf" },
				javascript = js_formatters,
				javascriptreact = js_formatters,
				typescript = js_formatters,
				typescriptreact = js_formatters,
				rust = { "rustfmt" },
				-- sql = { "sleek" },
				-- markdown = { "prettierd", "prettier" },
				-- ["markdown.mdx"] = { "prettierd", "prettier" },
				-- css = { "prettierd", "prettier" },
				-- scss = { "prettierd", "prettier" },
				-- html = { "prettierd", "prettier" },
				-- toml = { "taplo" },
			},
			format_on_save = function(bufnr)
				-- Disable with a global or buffer-local variable
				if vim.g.disable_autoformat or vim.b[bufnr].disable_autoformat then
					return
				end
				return { timeout_ms = 500, lsp_fallback = true }
			end,
		},
		config = function(_, opts)
			require("conform").setup(opts)

			-- Format on save
			vim.api.nvim_create_user_command("FormatDisable", function(args)
				if args.bang then
					-- FormatDisable! will disable formatting just for this buffer
					vim.b.disable_autoformat = true
				else
					vim.g.disable_autoformat = true
				end
			end, {
				desc = "Disable autoformat-on-save",
				bang = true,
			})

			vim.api.nvim_create_user_command("FormatEnable", function()
				vim.b.disable_autoformat = false
				vim.g.disable_autoformat = false
			end, {
				desc = "Re-enable autoformat-on-save",
			})
		end,
	},
}
