return {

	{
		"lewis6991/gitsigns.nvim",
		opts = {
			signs = {
				add = {
					text = "▎",
				},
				change = {
					text = "▎",
				},
				delete = {
					text = "",
				},
				topdelete = {
					text = "",
				},
				changedelete = {
					text = "▎",
				},
			},
		},
	},

	{
		"echasnovski/mini.bufremove",
		version = "*",
		keys = {
			--[[ {
				"<S-q>",
				function()
					require("mini.bufremove").delete(0, true)
				end,
				desc = "Delete Buffer (Force)",
			}, ]]
			{
				"<leader>bd",
				function()
					local bd = require("mini.bufremove").delete
					if vim.bo.modified then
						local choice =
							vim.fn.confirm(("Save changes to %q?"):format(vim.fn.bufname()), "&Yes\n&No\n&Cancel")
						if choice == 1 then -- Yes
							vim.cmd.write()
							bd(0)
						elseif choice == 2 then -- No
							bd(0, true)
						end
					else
						bd(0)
					end
				end,
				desc = "Delete Buffer",
			},
			{
				"<leader>bD",
				function()
					require("mini.bufremove").delete(0, true)
				end,
				desc = "Delete Buffer (Force)",
			},
		},
	},

	{
		"folke/todo-comments.nvim",
		dependencies = { "nvim-lua/plenary.nvim" },
		event = { "VimEnter" },
		opts = {
			signs = false,
		},
	},
}
