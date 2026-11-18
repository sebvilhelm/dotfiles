-- Match the Ctrl+A bindings in ~/.config/herdr/config.toml.
local function prefix(key, action, args)
	rex.bind("ctrl+a>" .. key, action, args)
end

-- Rex has no detach action; hide the app without closing anything.
prefix("d", "client.visibility.toggle")
prefix("w", "session.switch")
prefix("shift+n", "session.new")
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
