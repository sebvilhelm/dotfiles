return {
	{
		"neovim/nvim-lspconfig",
		dependencies = {
			{ "folke/neodev.nvim", opts = {} },
			{ "mason-org/mason.nvim", opts = {} },
			"b0o/SchemaStore.nvim",
			{ "j-hui/fidget.nvim", opts = {} },
		},
		config = function()
			require "custom.lsp"
		end,
	},

	{
		"mfussenegger/nvim-lint",
		config = function(_, opts)
			local lint = require "lint"

			lint.linters_by_ft = {
				javascript = { "eslint_d" },
				javascriptreact = { "eslint_d" },
				typescript = { "eslint_d" },
				typescriptreact = { "eslint_d" },
			}

			vim.api.nvim_create_autocmd({ "BufWritePost", "BufReadPost", "InsertLeave" }, {
				callback = function()
					require("lint").try_lint()
				end,
			})
		end,
	},
}
