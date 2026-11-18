-- Match the Ctrl+A bindings in ~/.config/herdr/config.toml.
local function prefix(key, action, args)
	rex.bind("ctrl+a>" .. key, action, args)
end

-- Rex has no detach action; hide the app without closing anything.
prefix("d", "client.visibility.toggle")
prefix("w", "session.switch")
prefix("c", "client.tab.new")
prefix(",", "client.tab.rename")
prefix("p", "client.tab.previous")
prefix("n", "client.tab.next")
prefix("shift+x", "client.tab.close")
prefix("shift+p", "pane.rename")
prefix("h", "pane.focus.left")
prefix("j", "pane.focus.down")
prefix("k", "pane.focus.up")
prefix("l", "pane.focus.right")
prefix("shift+\\", "pane.split", { direction = "right" })
prefix("-", "pane.split", { direction = "down" })
prefix("x", "pane.close")
prefix("z", "pane.zoom")
-- Send Ctrl+A to the shell (or a nested multiplexer) by pressing it twice.
prefix("ctrl+a", "pane.send_key", { key = "ctrl+a" })

-- Rex has no directory-based session names. Opt in at creation so explicitly
-- named sessions are never taken over by the shell hook.
local pending_directory_label = "New session (following directory)"
rex.action({
	name = "new_directory_session",
	title = "New Session (Follow Directory)",
	run = function()
		local created, err = rex.call("session.create", {
			label = pending_directory_label,
			initial_windows = {
				{ layout = rex.layout.block({ flavor = "com.superlogical.terminal.shell" }) },
			},
		})
		if not created then
			error(err, 0)
		end
		rex.client.queue("session.select", { session_id = created.session_id })
	end,
})
prefix("shift+n", "new_directory_session")
rex.bind("shift+cmd+n", "new_directory_session")

rex.action({
	name = "update_directory_session_label",
	title = "Update Directory Session Label (Shell Hook)",
	args = { label = "string", previous = "string" },
	run = function(ctx, args)
		local view = rex.session.view({})
		if not view then
			return
		end
		local previous = args.previous:match("^%s*(.-)%s*$")
		if previous == "" then
			local window = view.windows and view.windows[1]
			local layer = window and window.layers[1]
			local block = layer and layer.blocks and layer.blocks[1]
			if not block or block.block_id ~= ctx.block_id then
				return
			end
			previous = pending_directory_label
		end
		-- A user rename takes precedence over the last automatic label.
		if view.label == previous and args.label:find("%S") then
			local updated = rex.session.set_label({ label = args.label })
			if updated then
				return 1
			end
		end
	end,
})

rex.action({
	name = "edit_scrollback",
	title = "Edit Scrollback in Neovim",
	run = function(ctx)
		if not ctx.block_id then
			return
		end
		local _, err = rex.session.new_window({
			window_label = "Scrollback",
			layout = rex.layout.block({
				flavor = "com.superlogical.terminal.shell",
				options = {
					command = {
						"sh",
						"-c",
						[[rex capture --block "$1" --unwrap | nvim -n -i NONE --cmd 'set nomodeline' -]],
						"rex-scrollback",
						ctx.block_id,
					},
				},
			}),
		})
		if err then
			error(err, 0)
		end
	end,
})
prefix("e", "edit_scrollback")

-- These are Mac client preferences, not server settings. Run once from the
-- Rex command palette; reloading init.lua should not override client choices.
rex.action({
	name = "apply_ghostty_herdr_preferences",
	title = "Apply Ghostty and Herdr Preferences",
	run = function()
		local function setting(name, value)
			rex.client.queue("client.setting." .. name, { value = value })
		end
		setting("interface.appearance.scheme", "dark")
		setting("terminal.typography.font", "Iosevka Term")
		setting("terminal.advanced_fonts.ligatures", false)
		setting("terminal.cursor.style", "block")
		setting("terminal.cursor.force", false)
		setting("terminal.keyboard.option", "left_sends_alt")
		setting("notifications.activity.sounds", false)
		rex.client.queue("client.sidebar.activity.by_priority")
		rex.client.queue("client.theme.import", {
			path = "/Applications/Ghostty.app/Contents/Resources/ghostty/themes/Gruvbox Dark",
		})
	end,
})
