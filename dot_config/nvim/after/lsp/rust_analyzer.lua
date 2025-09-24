return {
	settings = {
		["rust-analyzer"] = {
			check = {
				command = "clippy",
				extraArgs = { "--all", "--", "-W", "clippy::all" },
			},
		},
	},
}
