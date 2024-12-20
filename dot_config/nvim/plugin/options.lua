local opt = vim.opt
----- Interesting Options -----

-- You have to turn this one on :)
opt.inccommand = "split"

-- Best search settings :)
opt.smartcase = true
opt.ignorecase = true

---- Rest ----
-- tbh, I'm not sure which of these I even need

opt.clipboard = "unnamedplus" -- Use global clipboard

-- Better line numbers
opt.number = true
opt.relativenumber = true

opt.shiftwidth = 2
opt.softtabstop = 2 -- Sets the number of columns for a TAB
opt.tabstop = 2 -- The width of a TAB is set to 4.

opt.signcolumn = "yes" -- always show the signcolumn on LH side

-- Better splitting
opt.splitbelow = true
opt.splitright = true

opt.shada = { "'10", "<0", "s10", "h" }

-- Don't have `o` add a comment
opt.formatoptions:remove "o"

opt.undofile = true

-- Show in winbar
opt.laststatus = 3
opt.winbar = "%f %m"

-- Highlight Yanked Text
vim.api.nvim_create_autocmd("TextYankPost", {
	group = vim.api.nvim_create_augroup("user-highlighy-yank", { clear = true }),
	callback = function()
		vim.highlight.on_yank { higroup = "Visual", timeout = 200 }
	end,
})

---- Purgatory ----

-- opt.scrolloff = 3 -- start scrolling 3 lines before edge of viewport
-- opt.guifont = "JetBrainsMono Nerd Font:h13"
-- opt.termguicolors = true
-- vim.language = "en_US" -- Set language to english
-- opt.fileencoding = "utf-8"
-- opt.belloff = "all"
-- opt.mouse = "a" -- Enable mouse in all modes
-- opt.backup = false -- don't make backups before writing
-- opt.backupcopy = "yes" -- overwrite files to update, instead of renaming + rewriting
-- opt.swapfile = false -- creates a swapfile
-- opt.conceallevel = 0 -- so that `` is visible in markdown files

-- opt.cursorline = true -- highlight current line
-- opt.showtabline = 0
-- opt.smartindent = true -- make indenting smarter again
-- opt.expandtab = true -- Expand TABs to spaces
