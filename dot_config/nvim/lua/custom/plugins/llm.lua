return {
	{
		"olimorris/codecompanion.nvim",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-treesitter/nvim-treesitter",
			"nvim-telescope/telescope.nvim",
			{
				"github/copilot.vim",
				config = function()
					vim.cmd [[
					let g:copilot_enabled = 0
				]]
				end,
			},
		},
		config = function()
			require("codecompanion").setup()
		end,
	},
}
