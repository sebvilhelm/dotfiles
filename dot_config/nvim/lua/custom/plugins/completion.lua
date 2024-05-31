return {
	{
		"hrsh7th/nvim-cmp",
		lazy = false,
		priority = 100,
		dependencies = {
			"onsails/lspkind.nvim",
			"hrsh7th/cmp-buffer",
			"hrsh7th/cmp-path",
			"saadparwaiz1/cmp_luasnip",
			{ "L3MON4D3/LuaSnip", build = "make install_jsregexp" },
			"hrsh7th/cmp-nvim-lsp",
		},
		config = function()
			require "custom.completion"
		end,
	},
}
