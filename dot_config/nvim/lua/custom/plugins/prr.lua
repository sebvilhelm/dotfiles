return {
	{
		"danobi/prr",
		lazy = false,
		init = function(plugin)
			local rtp = plugin.dir .. "/vim"
			if vim.fn.isdirectory(rtp) == 0 then
				return
			end

			vim.opt.rtp:append(rtp)

			-- Register prr's filetype detection from the repo subdirectory.
			local ftdetect = rtp .. "/ftdetect/prr.vim"
			if vim.fn.filereadable(ftdetect) == 1 then
				vim.cmd.source(ftdetect)
			end
		end,
	},
}
