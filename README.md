# CodeQL MCP Server

MCP server for CodeQL code analysis. Enables LLMs to analyze codebases for security vulnerabilities and code quality issues.

## Features

- Create CodeQL databases for code analysis
- Run security scans with built-in query suites
- Support for JavaScript/TypeScript, Python, Java, C/C++, C#, Go, Ruby, Swift
- Database caching for fast repeated queries

## Setup

```bash
./install.sh
```

Verify:

```bash
./check-env.sh
```

## Configuration

Add to Claude Desktop config:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "codeql": {
      "command": "node",
      "args": ["/absolute/path/to/codeql_mcp/build/index.js"],
      "env": {
        "CODEQL_PATH": "/home/forrest/codeql/codeql",
        "CODEQL_HOME": "/home/forrest/codeql-home"
      }
    }
  }
}
```

Replace paths with your actual installation paths.

## Testing

**Option 1: CLI Test (Recommended for WSL)**

```bash
./test-cli.mjs
```

Commands: `init`, `tools`, `list`, `create`, `query`, `help`, `exit`

**Option 2: MCP Inspector**

```bash
npx @modelcontextprotocol/inspector $(which node) build/index.js
```

## Tools

### create_database

- `source_path`: Path to source code
- `language`: javascript, python, java, cpp, csharp, go, ruby, swift
- `database_name`: Optional custom name
- `command`: Build command (for compiled languages)

### run_query

- `database_name`: Database to query
- `suite`: Query suite (security-extended, code-scanning, security-and-quality)
- `output_format`: sarif, csv, or json

### list_databases

List all available databases.

### analyze_security

- `database_name`: Database to analyze
- `severity`: Minimum severity (error, warning, recommendation, note)

### find_patterns

- `database_name`: Database to search
- `pattern_type`: unused-code, duplicate-code, complex-functions, long-methods, dead-code

### get_metrics

- `database_name`: Database to analyze

## Usage

```
Create a CodeQL database for /home/user/myapp using JavaScript
Run security-extended suite on database 'myapp'
```

## Database Storage

`~/.codeql-mcp/databases/`

## License

MIT
