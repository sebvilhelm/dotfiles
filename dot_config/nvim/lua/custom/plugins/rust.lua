return {
	{
		"saecki/crates.nvim",
		ft = { "rust", "toml" },
		tag = "stable",
		dependencies = { "nvim-lua/plenary.nvim" },
		config = function()
			require("crates").setup()
		end,
	},
}
