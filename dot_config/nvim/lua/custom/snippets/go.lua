require("luasnip.session.snippet_collection").clear_snippets "go"

local ls = require "luasnip"
local s = ls.snippet
local sn = ls.snippet_node
-- local isn = ls.indent_snippet_node
local t = ls.text_node
local i = ls.insert_node
-- local f = ls.function_node
local c = ls.choice_node
-- local d = ls.dynamic_node
-- local r = ls.restore_node
-- local events = require "luasnip.util.events"
-- local ai = require "luasnip.nodes.absolute_indexer"
-- local extras = require "luasnip.extras"
-- local l = extras.lambda
-- local rep = extras.rep
-- local p = extras.partial
-- local m = extras.match
-- local n = extras.nonempty
-- local dl = extras.dynamic_lambda
-- local fmt = require("luasnip.extras.fmt").fmt
local fmta = require("luasnip.extras.fmt").fmta
-- local conds = require "luasnip.extras.expand_conditions"
-- local postfix = require("luasnip.extras.postfix").postfix
-- local types = require "luasnip.util.types"
-- local parse = require("luasnip.util.parser").parse_snippet
-- local ms = ls.multi_snippet
-- local k = require("luasnip.nodes.key_indexer").new_key

ls.add_snippets("go", {
	s(
		"fn",
		fmta(
			"func <name>(<args>) <types> {\n<body>\n}\n<finish>",
			{ name = i(1, "name"), args = i(2), types = i(3), body = i(4), finish = i(0) }
		)
	),
	s(
		"meth",
		fmta(
			"func (<parent>) <name>(<args>) <types> {\n<body>\n}\n<finish>",
			{ parent = i(1), name = i(2, "name"), args = i(3), types = i(4), body = i(5), finish = i(0) }
		)
	),
	s("ie", fmta("if err != nil {\n\treturn <err>\n}", { err = i(1, "err") })),
	s(
		"for",
		fmta("for <choice> {\n<body>\n}\n<finish>", {
			choice = c(1, {
				i(nil, ""),
				sn(nil, { i(1, "i"), t ", ", i(2, "v"), t " := range ", i(3, "values") }),
			}),
			body = i(2),
			finish = i(0),
		})
	),
})
