local dap = require "dap"
local ui = require "dapui"

require("dapui").setup()
require("dap-go").setup()

require("nvim-dap-virtual-text").setup {}

-- Handled by nvim-dap-go
-- dap.adapters.go = {
--   type = "server",
--   port = "${port}",
--   executable = {
--     command = "dlv",
--     args = { "dap", "-l", "127.0.0.1:${port}" },
--   },
-- }

vim.keymap.set("n", "<leader>db", dap.toggle_breakpoint)
vim.keymap.set("n", "<leader>dB", function()
	dap.toggle_breakpoint(vim.fn.input "Breakpoint condition: ")
end)

-- Eval var under cursor
vim.keymap.set("n", "<space>?", function()
	require("dapui").eval(nil, { enter = true })
end)

vim.keymap.set("n", "<leader>dc", dap.continue)
vim.keymap.set("n", "<leader>dC", dap.run_to_cursor)
vim.keymap.set("n", "<leader>di", dap.step_into)
vim.keymap.set("n", "<leader>do", dap.step_over)
vim.keymap.set("n", "<leader>dO", dap.step_out)
-- vim.keymap.set("n", "<leader>db", dap.step_back)
vim.keymap.set("n", "<leader>dr", dap.restart)
vim.keymap.set("n", "<leader>dT", dap.terminate)

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
