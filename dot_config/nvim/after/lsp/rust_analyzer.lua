return {
	cmd = {
		"lspmux",
		"client",
		"--server-path",
		"rust-analyzer",
	},
	settings = {
		["rust-analyzer"] = {
			check = {
				command = "clippy",
				extraArgs = { "--all", "--", "-W", "clippy::all" },
			},
		},
	},
}
