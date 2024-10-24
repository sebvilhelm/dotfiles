return {
	"nvim-lua/plenary.nvim",

	{
		"nvim-lualine/lualine.nvim",
		dependencies = { "nvim-tree/nvim-web-devicons" },
		opts = {
			options = {
				icons_enabled = true,
				theme = "auto",
				component_separators = "|",
				section_separators = "",
				globalstatus = true,
			},
			sections = {
				lualine_a = { "mode" },
				lualine_b = { "branch", "diff" },
				lualine_c = {},
				lualine_x = {
					function()
						return "spaces: " .. vim.api.nvim_buf_get_option(0, "shiftwidth")
					end,
					"encoding",
					"filetype",
				},
				lualine_y = { "location" },
				lualine_z = { "progress" },
			},
		},
	},
}
