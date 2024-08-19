return {
	-- {
	-- 	"CopilotC-Nvim/CopilotChat.nvim",
	-- 	branch = "canary",
	-- 	cmd = {
	-- 		"CopilotChat",
	-- 	},
	-- 	dependencies = {
	-- 		{ "zbirenbaum/copilot.lua" }, -- or github/copilot.vim
	-- 		{ "nvim-lua/plenary.nvim" }, -- for curl, log wrapper
	-- 	},
	-- 	opts = {
	-- 		debug = false, -- Enable debugging
	-- 		-- See Configuration section for rest
	-- 	},
	-- 	-- See Commands section for default commands if you want to lazy load on them
	-- },
	{
		"olimorris/codecompanion.nvim",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-treesitter/nvim-treesitter",
		},
		config = function()
			require("codecompanion").setup {
				adapters = {
					anthropic = function()
						return require("codecompanion.adapters").use("anthropic", {
							env = {
								api_key = "ANTHROPIC_API_KEY",
							},
						})
					end,
					openai = function()
						return require("codecompanion.adapters").use("openai", {
							env = {
								api_key = "OPENAI_API_TOKEN",
							},
						})
					end,
				},
				strategies = {
					chat = {
						adapter = "ollama",
					},
					inline = {
						adapter = "ollama",
					},
					agent = {
						adapter = "anthropic",
					},
				},
			}

			-- recommended setup
			vim.api.nvim_set_keymap("n", "<C-a>", "<cmd>CodeCompanionActions<cr>", { noremap = true, silent = true })
			vim.api.nvim_set_keymap("v", "<C-a>", "<cmd>CodeCompanionActions<cr>", { noremap = true, silent = true })
			vim.api.nvim_set_keymap(
				"n",
				"<LocalLeader>a",
				"<cmd>CodeCompanionToggle<cr>",
				{ noremap = true, silent = true }
			)
			vim.api.nvim_set_keymap(
				"v",
				"<LocalLeader>a",
				"<cmd>CodeCompanionToggle<cr>",
				{ noremap = true, silent = true }
			)
			vim.api.nvim_set_keymap("v", "ga", "<cmd>CodeCompanionAdd<cr>", { noremap = true, silent = true })

			-- Expand 'cc' into 'CodeCompanion' in the command line
			vim.cmd [[cab cc CodeCompanion]]
		end,
	},
}
