vim.lsp.enable("lua_ls")
vim.lsp.enable("gopls")
vim.lsp.enable("rust_analyzer")
vim.lsp.enable("jsonls")
vim.lsp.enable("yamlls")
vim.lsp.enable("taplo")
vim.lsp.enable("ts_ls")
-- vim.lsp.enable("sqlls")
vim.lsp.enable("cssls")
vim.lsp.enable("cssmodules_ls")
vim.lsp.enable("html")
vim.lsp.enable("graphql")
vim.lsp.enable("buf_ls")
vim.lsp.enable("marksman")
vim.lsp.enable("tailwindcss")
vim.lsp.enable("tinymist")

local disable_semantic_tokens = {
	lua = true,
}

vim.api.nvim_create_autocmd("LspAttach", {
	callback = function(args)
		local bufnr = args.buf
		local client = assert(vim.lsp.get_client_by_id(args.data.client_id), "must have valid client")

		-- Inlay Hint toggle
		local toggle_inlay_hints = function()
			vim.lsp.inlay_hint.enable(not vim.lsp.inlay_hint.is_enabled())
		end
		vim.keymap.set("n", "<leader>ih", toggle_inlay_hints, { desc = "Toggle inlay hints" })
		vim.api.nvim_create_user_command("InlayHintToggle", toggle_inlay_hints, {})

		local filetype = vim.bo[bufnr].filetype
		if disable_semantic_tokens[filetype] then
			client.server_capabilities.semanticTokensProvider = nil
		end
	end,
})
