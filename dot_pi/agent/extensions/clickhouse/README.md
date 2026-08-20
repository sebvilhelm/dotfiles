# ClickHouse MCP

This extension replaces the generic `pi-mcp-adapter` integration for the
deployed ClickHouse MCP server:

`https://clickhouse-mcp.prod.lunar.tech/mcp`

It registers these Pi tools:

- `clickhouse_list_databases`
- `clickhouse_list_tables`
- `clickhouse_run_query`

The extension speaks Streamable HTTP MCP directly and bounds tool output to Pi's
normal 50 KiB / 2,000-line limits. The deployed server executes queries
read-only by default.

## Authentication

Run `/clickhouse-auth` in an interactive Pi session. This opens the service's
OAuth authorization page and stores the resulting access and refresh tokens in
the macOS Keychain under the same credential identity used by `pi-mcp-adapter`,
allowing existing credentials to be reused.

For headless or CI use, set `CLICKHOUSE_MCP_ACCESS_TOKEN`. The environment
variable takes precedence over Keychain credentials.

Run `/clickhouse-logout` to remove the stored credential. If an access token
expires and no refresh token is available, authenticate again.
