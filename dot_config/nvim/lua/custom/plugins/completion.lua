return {

	{
		"saghen/blink.cmp",
		enabled = true,
		dependencies = { "L3MON4D3/LuaSnip", version = "2.x" },

		version = "*",

		config = function()
			local blink = require "blink.cmp"

			blink.setup {
				keymap = {
					preset = "default",
					["<Tab>"] = {},
					["<S-Tab>"] = {},
					["<C-k>"] = {},
				},

				appearance = {
					use_nvim_cmp_as_default = true,
					nerd_font_variant = "mono",
				},

				completion = {
					menu = {
						draw = {
							columns = { { "label", "label_description", gap = 1 }, { "kind_icon", "kind" } },
						},
					},
					-- documentation = {
					-- 	auto_show = true,
					-- 	auto_show_delay_ms = 500,
					-- },
				},

				signature = { enabled = true },

				snippets = {
					preset = "luasnip",
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

				cmdline = {
					enabled = false,
				},

				sources = {
					default = { "lsp", "path", "snippets", "buffer", "dadbod" },
					per_filetype = {
						codecompanion = { "codecompanion" },
					},
					providers = {
						dadbod = { name = "Dadbod", module = "vim_dadbod_completion.blink" },
					},
				},
			}
		end,
	},
}
