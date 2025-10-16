local dap = require("dap")
local ui = require("dapui")

require("dapui").setup()
require("dap-go").setup({
	tests = {
		verbose = true,
	},
	-- dap_configurations = {
	-- 	{
	-- 		type = "go",
	-- 		name = "Debug integration test",
	-- 		request = "launch",
	-- 		mode = "test",
	-- 		buildFlags = "-tags=integration",
	-- 		program = "${fileDirname}",
	-- 	},
	-- },
})

require("nvim-dap-virtual-text").setup({})

-- Handled by nvim-dap-go
-- dap.adapters.go = {
--   type = "server",
--   port = "${port}",
--   executable = {
--     command = "dlv",
--     args = { "dap", "-l", "127.0.0.1:${port}" },
--   },
-- }

vim.keymap.set("n", "<leader>b", dap.toggle_breakpoint)
vim.keymap.set("n", "<leader>B", function()
	dap.toggle_breakpoint(vim.fn.input("Breakpoint condition: "))
end)

-- Eval var under cursor
vim.keymap.set("n", "<leader>?", function()
	require("dapui").eval(nil, { enter = true })
end)

vim.keymap.set("n", "<F1>", dap.continue)
vim.keymap.set("n", "<F2>", dap.step_into)
vim.keymap.set("n", "<F3>", dap.step_over)
vim.keymap.set("n", "<F4>", dap.step_out)
vim.keymap.set("n", "<F5>", dap.step_back)
vim.keymap.set("n", "<F13>", dap.restart)

dap.listeners.before.attach.dapui_config = function()
	ui.open()
end
dap.listeners.before.launch.dapui_config = function()
	ui.open()
end
dap.listeners.before.event_terminated.dapui_config = function()
	ui.close()
end
dap.listeners.before.event_exited.dapui_config = function()
	ui.close()
end
