return {
	{
		"folke/snacks.nvim",
		lazy = false,
		priority = 1000,
		---@type snacks.Config
		opts = {
			image = {
				enabled = true,
			},
		},
	},
	{
		"MeanderingProgrammer/render-markdown.nvim",
		dependencies = { "nvim-treesitter/nvim-treesitter", "nvim-mini/mini.icons" }, -- if you use standalone mini plugins
		---@module 'render-markdown'
		---@type render.md.UserConfig
		opts = {},
	},
}
