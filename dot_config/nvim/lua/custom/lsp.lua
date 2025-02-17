require("neodev").setup {}

local capabilities = nil
if pcall(require, "cmp_nvim_lsp") then
	capabilities = require("cmp_nvim_lsp").default_capabilities()
end

local lspconfig = require "lspconfig"

local servers = {
	sqlls = true,
	cssls = true,
	cssmodules_ls = true,
	dockerls = true,
	pyright = true,
	buf_ls = true,
	graphql = true,
	html = true,
	marksman = true,
	lua_ls = true,
	taplo = true,
	gopls = {
		settings = {
			gopls = {
				gofumpt = true,
				codelenses = {
					gc_details = false,
					generate = true,
					regenerate_cgo = true,
					run_govulncheck = true,
					test = true,
					tidy = true,
					upgrade_dependency = true,
					vendor = true,
				},
				hints = {
					assignVariableTypes = true,
					compositeLiteralFields = true,
					compositeLiteralTypes = true,
					constantValues = true,
					functionTypeParameters = true,
					parameterNames = true,
					rangeVariableTypes = true,
				},
				usePlaceholders = true,
				completeUnimported = true,
				staticcheck = true,
				directoryFilters = { "-.git", "-.vscode", "-.idea", "-.vscode-test", "-node_modules" },
				semanticTokens = true,
			},
		},
	},
	jsonls = {
		settings = {
			json = {
				schemas = require("schemastore").json.schemas(),
				validate = { enable = true },
			},
		},
	},
	yamlls = {
		settings = {
			yaml = {
				schemaStore = {
					-- You must disable built-in schemaStore support if you want to use
					-- this plugin and its advanced options like `ignore`.
					enable = false,
					url = "",
				},
				schemas = require("schemastore").yaml.schemas {
					extra = {
						description = "Shuttle go plan",
						fileMatch = "shuttle.yaml",
						name = "shuttle.yaml",
						url = "file:///Users/svn/code/lunar/lw-shuttle-go-plan/.schemastore/schema.json",
					},
				},
			},
		},
	},
	rust_analyzer = {
		settings = {
			["rust-analyzer"] = {
				check = {
					command = "clippy",
					extraArgs = { "--all", "--", "-W", "clippy::all" },
				},
			},
		},
	},
	tailwindcss = true,
	-- tailwindcss = {
	-- 	settings = {
	-- 		tailwindCSS = {
	-- 			experimental = {
	-- 				classRegex = {
	-- 					{ "tv\\((([^()]*|\\([^()]*\\))*)\\)", "[\"'`]([^\"'`]*).*?[\"'`]" },
	-- 				},
	-- 			},
	-- 		},
	-- 	},
	-- },
	ts_ls = {
		root_dir = lspconfig.util.root_pattern "package.json",
		single_file_support = false,
		settings = {
			typescript = {
				inlayHints = {
					-- You can set this to 'all' or 'literals' to enable more hints
					includeInlayParameterNameHints = "all", -- 'none' | 'literals' | 'all'
					includeInlayParameterNameHintsWhenArgumentMatchesName = true,
					includeInlayFunctionParameterTypeHints = true,
					includeInlayVariableTypeHints = true,
					includeInlayVariableTypeHintsWhenTypeMatchesName = true,
					includeInlayPropertyDeclarationTypeHints = true,
					includeInlayFunctionLikeReturnTypeHints = true,
					includeInlayEnumMemberValueHints = true,
				},
			},
			javascript = {
				inlayHints = {
					-- You can set this to 'all' or 'literals' to enable more hints
					includeInlayParameterNameHints = "all", -- 'none' | 'literals' | 'all'
					includeInlayParameterNameHintsWhenArgumentMatchesName = true,
					includeInlayVariableTypeHints = true,
					includeInlayFunctionParameterTypeHints = true,
					includeInlayVariableTypeHintsWhenTypeMatchesName = true,
					includeInlayPropertyDeclarationTypeHints = true,
					includeInlayFunctionLikeReturnTypeHints = true,
					includeInlayEnumMemberValueHints = true,
				},
			},
		},
	},
	denols = {
		root_dir = lspconfig.util.root_pattern("deno.json", "deno.jsonc"),
	},

	-- https://github.com/tjdevries/config.nvim/blob/f33229d0f06a04c9be4d07b6c1b529295dbe70e2/lua/custom/plugins/lsp.lua#L66-L80
	ocamllsp = {
		manual_install = true,
		settings = {
			codelens = { enable = true },
		},

		filetypes = {
			"ocaml",
			"ocaml.interface",
			"ocaml.menhir",
			"ocaml.cram",
		},
	},
}

local servers_to_install = vim.tbl_filter(function(key)
	local t = servers[key]
	if type(t) == "table" then
		return not t.manual_install
	else
		return t
	end
end, vim.tbl_keys(servers))

require("mason").setup()
-- local ensure_installed = {
-- 	"stylua",
-- 	"lua_ls",
-- 	"delve",
-- 	-- "tailwind-language-server",
-- }

-- vim.list_extend(ensure_installed, servers_to_install)
-- require("mason-tool-installer").setup { ensure_installed = ensure_installed }

for name, config in pairs(servers) do
	if config == true then
		config = {}
	end
	if capabilities ~= nil then
		config = vim.tbl_deep_extend("force", {}, {
			capabilities = capabilities,
		}, config)
	end

	lspconfig[name].setup(config)
end

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
