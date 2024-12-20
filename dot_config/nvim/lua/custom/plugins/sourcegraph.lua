return {
	{
		"sourcegraph/sg.nvim",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-telescope/telescope.nvim",
		},
		enabled = false,
		config = function()
			require("sg").setup {}

			vim.keymap.set("n", "<leader>ss", function()
				require("sg.extensions.telescope").fuzzy_search_results()
			end)
		end,
	},
}
