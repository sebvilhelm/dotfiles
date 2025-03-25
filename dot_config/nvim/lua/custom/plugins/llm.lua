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
			require("codecompanion").setup {
				strategies = {
					chat = {
						slash_commands = {
							buffer = {
								callback = "strategies.chat.slash_commands.buffer",
								description = "Select a buffer using Telescope",
								opts = {
									provider = "telescope",
									contains_code = true,
								},
							},
							file = {
								callback = "strategies.chat.slash_commands.file",
								description = "Select a file using Telescope",
								opts = {
									provider = "telescope",
									contains_code = true,
								},
							},
						},
					},
				},
				adapters = {
					deepseek = function()
						return require("codecompanion.adapters").extend("ollama", {
							name = "deepseek-r1",
							schema = {
								model = {
									default = "deepseek-r1:7b",
								},
							},
						})
					end,
				},
			}
		end,
	},
}
