local jjsigns = require("jjsigns")

jjsigns.setup()

vim.keymap.set("n", "]c", function()
	if vim.wo.diff then
		vim.cmd.normal({ "]c", bang = true })
	else
		jjsigns.next_hunk()
	end
end, { desc = "Next jj hunk" })

vim.keymap.set("n", "[c", function()
	if vim.wo.diff then
		vim.cmd.normal({ "[c", bang = true })
	else
		jjsigns.prev_hunk()
	end
end, { desc = "Previous jj hunk" })
