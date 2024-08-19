return {
	{
		"vim-test/vim-test",
		dependencies = {
			"preservim/vimux",
		},
		config = function()
			vim.cmd "let test#strategy = 'vimux'"

			vim.keymap.set("n", "<leader>tn", "<cmd>TestNearest<CR>")
			vim.keymap.set("n", "<leader>tf", "<cmd>TestFile<CR>")
			vim.keymap.set("n", "<leader>tl", "<cmd>TestLast<CR>")
			vim.keymap.set("n", "<leader>ts", "<cmd>TestSuite<CR>")
		end,
	},
}
