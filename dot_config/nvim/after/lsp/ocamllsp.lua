-- https://github.com/tjdevries/config.nvim/blob/f33229d0f06a04c9be4d07b6c1b529295dbe70e2/lua/custom/plugins/lsp.lua#L66-L80
return {
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
}
