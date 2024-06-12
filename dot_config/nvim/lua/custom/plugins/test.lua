return {
	{
		"nvim-neotest/neotest",
		enabled = false,
		dependencies = {
			"nvim-neotest/nvim-nio",
			"nvim-lua/plenary.nvim",
			"nvim-treesitter/nvim-treesitter",
			"nvim-neotest/neotest-go",
		},
		config = function()
			local neotest = require("neotest")

			local neotest_ns = vim.api.nvim_create_namespace("neotest")
			vim.diagnostic.config({
				virtual_text = {
					format = function(diagnostic)
						local message =
							diagnostic.message:gsub("\n", " "):gsub("\t", " "):gsub("%s+", " "):gsub("^%s+", "")
						return message
					end,
				},
			}, neotest_ns)

			vim.api.nvim_create_user_command("TestRun", function()
				neotest.run.run()
			end, {})

			vim.api.nvim_create_user_command("TestRunDebug", function()
				neotest.run.run({ strategy = "dap" })
			end, {})

			vim.api.nvim_create_user_command("TestRunFile", function()
				neotest.run.run(vim.fn.expand("%"))
			end, {})

			vim.api.nvim_create_user_command("TestRunAll", function()
				neotest.run.run(vim.fn.getcwd())
			end, {})

			vim.api.nvim_create_user_command("TestRunAttach", function()
				neotest.run.attach()
			end, {})

			vim.api.nvim_create_user_command("TestSummary", function()
				neotest.summary.toggle()
			end, {})

			neotest.setup({
				summary = {
					enabled = true,
					follow = true,
					expand_errors = true,
				},
				diagnostic = {
					enabled = true,
					severity = 1,
				},
				-- quickfix = {
				-- 	enabled = true,
				-- 	open = true,
				-- },
				adapters = {
					require("neotest-go")({
						experimental = {
							test_table = true,
						},
						args = { "-race" },
					}),
				},
			})
		end,
	},

	{
		"vim-test/vim-test",
	},
}
