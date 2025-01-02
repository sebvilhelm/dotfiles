return {
	{
		"hrsh7th/nvim-cmp",
		enabled = true,
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

	{
		"saghen/blink.cmp",
		enabled = false,
		dependencies = { "L3MON4D3/LuaSnip", version = "2.x" },

		version = "v0.*",

		opts = {
			keymap = { preset = "default" },

			appearance = {
				use_nvim_cmp_as_default = true,
				nerd_font_variant = "mono",
			},

			signature = { enabled = true },

			snippets = {
				expand = function(snippet)
					require("luasnip").lsp_expand(snippet)
				end,
				active = function(filter)
					if filter and filter.direction then
						return require("luasnip").jumpable(filter.direction)
					end
					return require("luasnip").in_snippet()
				end,
				jump = function(direction)
					require("luasnip").jump(direction)
				end,
			},
			sources = {
				default = { "lsp", "path", "luasnip", "buffer" },
			},
		},
	},
}
