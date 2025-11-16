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

## Testing

```bash
npx @modelcontextprotocol/inspector $(which node) build/index.js
```

## License

MIT
