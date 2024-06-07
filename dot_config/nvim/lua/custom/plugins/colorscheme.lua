return {
	{
		"RRethy/nvim-base16",
		enabled = false,
		lazy = false,
		priority = 1000,
		config = function()
			vim.cmd.colorscheme("base16-gruvbox-dark-hard")
		end,
	},

	{
		"tjdevries/colorbuddy.nvim",
	},
	{
		"ellisonleao/gruvbox.nvim",
		lazy = false,
		priority = 1000,
		config = function()
			vim.cmd.colorscheme("gruvbox")
		end,
	},
}
