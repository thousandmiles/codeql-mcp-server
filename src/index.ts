#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { mkdir, readFile, writeFile, access, unlink } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import * as postgres from "./postgres.js";

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..");

const execFileAsync = promisify(execFile);

// Find CodeQL path
function findCodeQL(): string {
  // Try environment variable first
  if (process.env.CODEQL_PATH) {
    return process.env.CODEQL_PATH;
  }
  
  // Try common locations
  const locations = [
    join(homedir(), "codeql", "codeql"),
    "/usr/local/bin/codeql",
    "/usr/bin/codeql",
  ];
  
  for (const location of locations) {
    try {
      execSync(`test -x ${location}`, { stdio: 'ignore' });
      return location;
    } catch {
      continue;
    }
  }
  
  // Try which/where
  try {
    return execSync("which codeql", { encoding: "utf-8" }).trim();
  } catch {
    return "codeql"; // Fallback to PATH
  }
}

// Configuration
const CODEQL_DB_DIR = join(homedir(), ".codeql-mcp", "databases");
const CODEQL_PATH = findCodeQL();
const CODEQL_HOME = process.env.CODEQL_HOME || join(homedir(), "codeql-home");

interface CodeQLDatabase {
  name: string;
  language: string;
  path: string;
  created: string;
}

class CodeQLMCPServer {
  private server: Server;
  private databases: Map<string, CodeQLDatabase> = new Map();

  constructor() {
    this.server = new Server(
      {
        name: "codeql-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
    this.loadDatabases();
  }

  private async loadDatabases() {
    try {
      await mkdir(CODEQL_DB_DIR, { recursive: true });
      const dbIndexPath = join(CODEQL_DB_DIR, "index.json");
      
      try {
        await access(dbIndexPath);
        const content = await readFile(dbIndexPath, "utf-8");
        const dbs = JSON.parse(content) as CodeQLDatabase[];
        dbs.forEach(db => this.databases.set(db.name, db));
      } catch {
        // No existing index, start fresh
      }
    } catch (error) {
      console.error("Error loading databases:", error);
    }
  }

  private async saveDatabases() {
    const dbIndexPath = join(CODEQL_DB_DIR, "index.json");
    const dbs = Array.from(this.databases.values());
    await writeFile(dbIndexPath, JSON.stringify(dbs, null, 2));
  }

  private async checkCodeQLInstalled(): Promise<boolean> {
    try {
      await execFileAsync(CODEQL_PATH, ["version"]);
      return true;
    } catch {
      return false;
    }
  }

  private async runCodeQL(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      console.error(`\n🔧 Executing: ${CODEQL_PATH} ${args.join(' ')}\n`);
      
      const proc = spawn(CODEQL_PATH, args, {
        env: { ...process.env, CODEQL_HOME }
      });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        console.error(output);
      });

      proc.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        console.error(output);
      });

      proc.on('close', (code) => {
        console.error(`\n✅ Command completed with code ${code}\n`);
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Command failed with exit code ${code}`));
        }
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Tool[] = [
        {
          name: "create_database",
          description: "Create a CodeQL database from a source code repository. Supports multiple languages including JavaScript/TypeScript, Python, Java, C/C++, C#, Go, Ruby, and Swift.",
          inputSchema: {
            type: "object",
            properties: {
              source_path: {
                type: "string",
                description: "Absolute path to the source code directory",
              },
              language: {
                type: "string",
                description: "Programming language of the codebase",
                enum: ["javascript", "typescript", "python", "java", "cpp", "csharp", "go", "ruby", "swift"],
              },
              database_name: {
                type: "string",
                description: "Name for the CodeQL database (optional, will use directory name if not provided)",
              },
              command: {
                type: "string",
                description: "Build command for compiled languages (optional, required for C/C++, Java, C#)",
              },
            },
            required: ["source_path", "language"],
          },
        },
        {
          name: "run_query",
          description: "Run a CodeQL query against a database. Returns analysis results including security vulnerabilities, code quality issues, or custom query results.",
          inputSchema: {
            type: "object",
            properties: {
              database_name: {
                type: "string",
                description: "Name of the CodeQL database to query",
              },
              query: {
                type: "string",
                description: "CodeQL query to run (either a .ql file path or inline query)",
              },
              query_suite: {
                type: "string",
                description: "Predefined query suite to run (e.g., 'security-extended', 'code-scanning', 'security-and-quality')",
              },
              format: {
                type: "string",
                description: "Output format for results",
                enum: ["sarif-latest", "csv", "sarifv2.1.0"],
                default: "sarif-latest",
              },
            },
            required: ["database_name"],
          },
        },
        {
          name: "list_databases",
          description: "List all available CodeQL databases created by this server",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "analyze_security",
          description: "Run comprehensive security analysis on a database using CodeQL's security query suite. Detects common vulnerabilities like SQL injection, XSS, path traversal, etc.",
          inputSchema: {
            type: "object",
            properties: {
              database_name: {
                type: "string",
                description: "Name of the CodeQL database to analyze",
              },
              severity: {
                type: "string",
                description: "Minimum severity level to report",
                enum: ["error", "warning", "recommendation", "note"],
                default: "warning",
              },
            },
            required: ["database_name"],
          },
        },
        {
          name: "find_patterns",
          description: "Search for specific code patterns or anti-patterns in the codebase using CodeQL",
          inputSchema: {
            type: "object",
            properties: {
              database_name: {
                type: "string",
                description: "Name of the CodeQL database to search",
              },
              pattern_type: {
                type: "string",
                description: "Type of pattern to find",
                enum: ["unused-code", "duplicate-code", "complex-functions", "long-methods", "dead-code"],
              },
            },
            required: ["database_name", "pattern_type"],
          },
        },
        {
          name: "get_metrics",
          description: "Get code metrics and statistics from the database (LOC, complexity, dependencies, etc.)",
          inputSchema: {
            type: "object",
            properties: {
              database_name: {
                type: "string",
                description: "Name of the CodeQL database to analyze",
              },
            },
            required: ["database_name"],
          },
        },
        {
          name: "delete_database",
          description: "Delete a CodeQL database and remove it from the index",
          inputSchema: {
            type: "object",
            properties: {
              database_name: {
                type: "string",
                description: "Name of the database to delete",
              },
            },
            required: ["database_name"],
          },
        },
        {
          name: "upgrade_database",
          description: "Upgrade a CodeQL database to the latest schema version",
          inputSchema: {
            type: "object",
            properties: {
              database_name: {
                type: "string",
                description: "Name of the database to upgrade",
              },
            },
            required: ["database_name"],
          },
        },
        {
          name: "get_database_info",
          description: "Get detailed information about a specific database including language, size, and creation date",
          inputSchema: {
            type: "object",
            properties: {
              database_name: {
                type: "string",
                description: "Name of the database to inspect",
              },
            },
            required: ["database_name"],
          },
        },
        {
          name: "export_results",
          description: "Export query results to a file in various formats",
          inputSchema: {
            type: "object",
            properties: {
              database_name: {
                type: "string",
                description: "Name of the database",
              },
              result_file: {
                type: "string",
                description: "Path to the SARIF result file to export",
              },
              output_format: {
                type: "string",
                description: "Export format",
                enum: ["csv", "json", "markdown"],
              },
              output_path: {
                type: "string",
                description: "Path where to save the exported file",
              },
            },
            required: ["result_file", "output_format", "output_path"],
          },
        },
        {
          name: "find_function",
          description: "Find function definitions in the codebase with fuzzy name matching. Searches across all files and returns function locations, signatures, and containing files. NOTE: Slow. Use find_function_graph if graph index is built.",
          inputSchema: {
            type: "object",
            properties: {
              database_name: {
                type: "string",
                description: "Name of the CodeQL database to search",
              },
              function_name: {
                type: "string",
                description: "Function name to search for (supports partial/fuzzy matching)",
              },
              limit: {
                type: "number",
                description: "Maximum number of results to return (default: 50)",
              },
            },
            required: ["database_name", "function_name"],
          },
        },
        {
          name: "build_graph_index",
          description: "Build PostgreSQL graph index for fast queries. Extracts functions, calls, classes from CodeQL database. One-time operation, then queries are significantly faster.",
          inputSchema: {
            type: "object",
            properties: {
              database_name: {
                type: "string",
                description: "Name of the CodeQL database to index",
              },
            },
            required: ["database_name"],
          },
        },
        {
          name: "find_function_graph",
          description: "Fast function search using graph index. Requires build_graph_index first.",
          inputSchema: {
            type: "object",
            properties: {
              database_name: {
                type: "string",
                description: "Name of the database",
              },
              function_name: {
                type: "string",
                description: "Function name to search (fuzzy matching)",
              },
              limit: {
                type: "number",
                description: "Maximum results (default: 50)",
              },
            },
            required: ["database_name", "function_name"],
          },
        },
        {
          name: "find_callers_graph",
          description: "Find all functions that call a specific function using graph index.",
          inputSchema: {
            type: "object",
            properties: {
              database_name: {
                type: "string",
                description: "Name of the database",
              },
              function_name: {
                type: "string",
                description: "Function to find callers of",
              },
            },
            required: ["database_name", "function_name"],
          },
        },
        {
          name: "find_call_chain_graph",
          description: "Find call chain path between two functions using graph index.",
          inputSchema: {
            type: "object",
            properties: {
              database_name: {
                type: "string",
                description: "Name of the database",
              },
              from_function: {
                type: "string",
                description: "Starting function",
              },
              to_function: {
                type: "string",
                description: "Target function",
              },
              max_depth: {
                type: "number",
                description: "Maximum search depth (default: 5)",
              },
            },
            required: ["database_name", "from_function", "to_function"],
          },
        },
        {
          name: "get_class_hierarchy_graph",
          description: "Get class inheritance hierarchy with methods using graph index.",
          inputSchema: {
            type: "object",
            properties: {
              database_name: {
                type: "string",
                description: "Name of the database",
              },
              class_name: {
                type: "string",
                description: "Class to get hierarchy for",
              },
            },
            required: ["database_name", "class_name"],
          },
        },
        {
          name: "get_graph_stats",
          description: "Get database statistics and hot spots using graph index.",
          inputSchema: {
            type: "object",
            properties: {
              database_name: {
                type: "string",
                description: "Name of the database",
              },
            },
            required: ["database_name"],
          },
        },
      ];

      return { tools };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Check if CodeQL is installed
      const isInstalled = await this.checkCodeQLInstalled();
      if (!isInstalled) {
        return {
          content: [
            {
              type: "text",
              text: "Error: CodeQL CLI is not installed or not in PATH. Please install CodeQL from https://github.com/github/codeql-cli-binaries/releases",
            },
          ],
        };
      }

      try {
        switch (name) {
          case "create_database":
            return await this.handleCreateDatabase(args);
          case "run_query":
            return await this.handleRunQuery(args);
          case "list_databases":
            return await this.handleListDatabases();
          case "analyze_security":
            return await this.handleAnalyzeSecurity(args);
          case "find_patterns":
            return await this.handleFindPatterns(args);
          case "get_metrics":
            return await this.handleGetMetrics(args);
          case "delete_database":
            return await this.handleDeleteDatabase(args);
          case "upgrade_database":
            return await this.handleUpgradeDatabase(args);
          case "get_database_info":
            return await this.handleGetDatabaseInfo(args);
          case "export_results":
            return await this.handleExportResults(args);
          case "find_function":
            return await this.handleFindFunction(args);
          case "build_graph_index":
            return await this.handleBuildGraphIndex(args);
          case "find_function_graph":
            return await this.handleFindFunctionFast(args);
          case "find_callers_graph":
            return await this.handleFindCallers(args);
          case "find_call_chain_graph":
            return await this.handleFindCallChain(args);
          case "get_class_hierarchy_graph":
            return await this.handleGetClassHierarchy(args);
          case "get_graph_stats":
            return await this.handleQueryGraphStats(args);
          default:
            return {
              content: [
                {
                  type: "text",
                  text: `Unknown tool: ${name}`,
                },
              ],
            };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    });
  }

  private async handleCreateDatabase(args: any) {
    const { source_path, language, database_name, command } = args;
    const dbName = database_name || source_path.split("/").pop();
    const dbPath = join(CODEQL_DB_DIR, dbName);

    // Check if database already exists
    const existingDb = this.databases.get(dbName);
    if (existingDb) {
      try {
        // Verify database still exists on disk
        await access(join(existingDb.path, "codeql-database.yml"));
        return {
          content: [
            {
              type: "text",
              text: `Database '${dbName}' already exists (created: ${existingDb.created}). Using cached database at ${existingDb.path}.\n\nTo recreate, delete it first using delete_database tool.`,
            },
          ],
        };
      } catch {
        // Database file missing, remove from index and recreate
        this.databases.delete(dbName);
        await this.saveDatabases();
      }
    }

    try {
      await mkdir(dbPath, { recursive: true });

      const createArgs = [
        "database",
        "create",
        dbPath,
        `--language=${language}`,
        `--source-root=${source_path}`,
        "--overwrite",
      ];

      if (command) {
        createArgs.push(`--command=${command}`);
      }

      const { stdout, stderr } = await this.runCodeQL(createArgs);

      // Save database info
      const dbInfo: CodeQLDatabase = {
        name: dbName,
        language,
        path: dbPath,
        created: new Date().toISOString(),
      };
      this.databases.set(dbName, dbInfo);
      await this.saveDatabases();

      return {
        content: [
          {
            type: "text",
            text: `Successfully created CodeQL database '${dbName}' for ${language} code at ${source_path}\n\nDatabase cached at: ${dbPath}\n\nOutput: ${stdout}\n${stderr ? `Warnings: ${stderr}` : ""}`,
          },
        ],
      };
    } catch (error: any) {
      throw new Error(
        `Failed to create database: ${error.message}\n${error.stderr || ""}`
      );
    }
  }

  private async handleRunQuery(args: any) {
    const { database_name, query, query_suite, format = "sarif-latest" } = args;

    const db = this.databases.get(database_name);
    if (!db) {
      throw new Error(`Database '${database_name}' not found. Use list_databases to see available databases.`);
    }

    try {
      // Map format to valid CodeQL formats
      const validFormat = format === "json" ? "sarif-latest" : format;
      const outputFile = join(CODEQL_DB_DIR, `${database_name}_results.sarif`);
      const queryArgs = ["database", "analyze", db.path, `--format=${validFormat}`, `--output=${outputFile}`];

      if (query_suite) {
        queryArgs.push(`--sarif-category=${query_suite}`);
        queryArgs.push(query_suite);
      } else if (query) {
        queryArgs.push(query);
      } else {
        queryArgs.push(`${db.language}-code-scanning.qls`);
      }

      const { stdout, stderr } = await this.runCodeQL(queryArgs);

      // Read results
      const results = await readFile(outputFile, "utf-8");

      return {
        content: [
          {
            type: "text",
            text: `Query executed successfully on database '${database_name}'\n\n${stdout}\n\nResults:\n${results}`,
          },
        ],
      };
    } catch (error: any) {
      throw new Error(
        `Failed to run query: ${error.message}\n${error.stderr || ""}`
      );
    }
  }

  private async handleListDatabases() {
    const dbList = Array.from(this.databases.values());
    
    if (dbList.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No CodeQL databases found. Create one using the create_database tool.",
          },
        ],
      };
    }

    const dbInfo = dbList.map(db => 
      `- ${db.name} (${db.language}) - Created: ${db.created}\n  Path: ${db.path}`
    ).join("\n\n");

    return {
      content: [
        {
          type: "text",
          text: `Available CodeQL databases (${dbList.length}):\n\n${dbInfo}`,
        },
      ],
    };
  }

  private async handleAnalyzeSecurity(args: any) {
    const { database_name } = args;

    const db = this.databases.get(database_name);
    if (!db) {
      throw new Error(`Database '${database_name}' not found`);
    }

    try {
      const outputFile = join(CODEQL_DB_DIR, `${database_name}_security.sarif`);
      const analyzeArgs = [
        "database",
        "analyze",
        db.path,
        "codeql/javascript-queries:codeql-suites/javascript-security-extended.qls",
        "--format=sarif-latest",
        `--output=${outputFile}`,
      ];

      const { stdout, stderr } = await this.runCodeQL(analyzeArgs);

      const results = await readFile(outputFile, "utf-8");
      const sarif = JSON.parse(results);

      // Parse results
      let findings = [];
      for (const run of sarif.runs || []) {
        for (const result of run.results || []) {
          findings.push({
            rule: result.ruleId,
            message: result.message.text,
            level: result.level || "warning",
            locations: result.locations?.map((loc: any) => ({
              file: loc.physicalLocation?.artifactLocation?.uri,
              line: loc.physicalLocation?.region?.startLine,
            })),
          });
        }
      }

      const summary = `Security Analysis Results for '${database_name}':\n\n` +
        `Total findings: ${findings.length}\n\n` +
        `Findings:\n${JSON.stringify(findings, null, 2)}`;

      return {
        content: [
          {
            type: "text",
            text: summary,
          },
        ],
      };
    } catch (error: any) {
      throw new Error(
        `Security analysis failed: ${error.message}`
      );
    }
  }

  private async handleFindPatterns(args: any) {
    const { database_name, pattern_type } = args;

    const db = this.databases.get(database_name);
    if (!db) {
      throw new Error(`Database '${database_name}' not found`);
    }

    // Map pattern types to CodeQL query packs
    const patternQueries: Record<string, string> = {
      "unused-code": "DeadCode.ql",
      "duplicate-code": "SimilarCode.ql", 
      "complex-functions": "ComplexFunction.ql",
      "long-methods": "LongMethod.ql",
      "dead-code": "UnreachableCode.ql",
    };

    return {
      content: [
        {
          type: "text",
          text: `Pattern finding for '${pattern_type}' is configured but requires custom CodeQL queries. You can run custom queries using the run_query tool with appropriate .ql files.`,
        },
      ],
    };
  }

  private async handleGetMetrics(args: any) {
    const { database_name } = args;

    const db = this.databases.get(database_name);
    if (!db) {
      throw new Error(`Database '${database_name}' not found`);
    }

    try {
      // Get database metadata
      const { stdout: resolveOutput } = await execFileAsync(CODEQL_PATH, [
        "resolve",
        "database",
        db.path,
      ]);
      
      const dbInfo = JSON.parse(resolveOutput);
      
      // Get database size
      const { stdout: sizeOutput } = await execFileAsync("du", [
        "-sh",
        db.path,
      ]);
      const size = sizeOutput.trim().split("\t")[0];

      // Count files in source archive if available
      let fileCount = "N/A";
      if (dbInfo.sourceArchiveZip) {
        try {
          const { stdout: zipList } = await execFileAsync("unzip", [
            "-l",
            dbInfo.sourceArchiveZip,
          ]);
          const lines = zipList.split("\n");
          const fileCountMatch = lines[lines.length - 2]?.match(/(\d+)\s+file/);
          if (fileCountMatch) {
            fileCount = fileCountMatch[1];
          }
        } catch {
          // If unzip fails, skip file count
        }
      }

      const metrics = {
        name: database_name,
        language: dbInfo.languages?.[0] || db.language,
        sourceLocation: dbInfo.sourceLocationPrefix,
        size,
        fileCount,
        created: db.created,
        datasetFolder: dbInfo.datasetFolder,
      };

      return {
        content: [
          {
            type: "text",
            text: `Database Metrics for '${database_name}':\n\n${JSON.stringify(metrics, null, 2)}`,
          },
        ],
      };
    } catch (error: any) {
      throw new Error(
        `Failed to get metrics: ${error.message}\n${error.stderr || ""}`
      );
    }
  }

  private async handleDeleteDatabase(args: any) {
    const { database_name } = args;

    const db = this.databases.get(database_name);
    if (!db) {
      throw new Error(`Database '${database_name}' not found`);
    }

    try {
      // Delete from map
      this.databases.delete(database_name);
      await this.saveDatabases();

      // Delete directory
      const { execSync } = await import("child_process");
      execSync(`rm -rf "${db.path}"`, { stdio: 'inherit' });

      return {
        content: [
          {
            type: "text",
            text: `Successfully deleted database '${database_name}'`,
          },
        ],
      };
    } catch (error: any) {
      throw new Error(`Failed to delete database: ${error.message}`);
    }
  }

  private async handleUpgradeDatabase(args: any) {
    const { database_name } = args;

    const db = this.databases.get(database_name);
    if (!db) {
      throw new Error(`Database '${database_name}' not found`);
    }

    try {
      const { stdout, stderr } = await this.runCodeQL([
        "database",
        "upgrade",
        db.path,
      ]);

      return {
        content: [
          {
            type: "text",
            text: `Database '${database_name}' upgraded successfully\n\n${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      throw new Error(`Failed to upgrade database: ${error.message}`);
    }
  }

  private async handleGetDatabaseInfo(args: any) {
    const { database_name } = args;

    const db = this.databases.get(database_name);
    if (!db) {
      throw new Error(`Database '${database_name}' not found`);
    }

    try {
      // Get database metadata
      const metadataPath = join(db.path, "codeql-database.yml");
      const metadata = await readFile(metadataPath, "utf-8");

      // Get directory size
      const { execSync } = await import("child_process");
      const size = execSync(`du -sh "${db.path}" | cut -f1`, { encoding: "utf-8" }).trim();

      const info = `Database Information: '${database_name}'\n\n` +
        `Name: ${db.name}\n` +
        `Language: ${db.language}\n` +
        `Created: ${db.created}\n` +
        `Path: ${db.path}\n` +
        `Size: ${size}\n\n` +
        `Metadata:\n${metadata}`;

      return {
        content: [
          {
            type: "text",
            text: info,
          },
        ],
      };
    } catch (error: any) {
      throw new Error(`Failed to get database info: ${error.message}`);
    }
  }

  private async handleExportResults(args: any) {
    const { result_file, output_format, output_path } = args;

    try {
      // Read SARIF file
      const sarifContent = await readFile(result_file, "utf-8");
      const sarif = JSON.parse(sarifContent);

      let exportContent = "";

      if (output_format === "csv") {
        // Convert to CSV
        exportContent = "Rule,Message,Level,File,Line\n";
        for (const run of sarif.runs || []) {
          for (const result of run.results || []) {
            const file = result.locations?.[0]?.physicalLocation?.artifactLocation?.uri || "";
            const line = result.locations?.[0]?.physicalLocation?.region?.startLine || "";
            exportContent += `"${result.ruleId}","${result.message.text}","${result.level || 'warning'}","${file}","${line}"\n`;
          }
        }
      } else if (output_format === "json") {
        // Simplified JSON
        const results = [];
        for (const run of sarif.runs || []) {
          for (const result of run.results || []) {
            results.push({
              rule: result.ruleId,
              message: result.message.text,
              level: result.level || "warning",
              file: result.locations?.[0]?.physicalLocation?.artifactLocation?.uri,
              line: result.locations?.[0]?.physicalLocation?.region?.startLine,
            });
          }
        }
        exportContent = JSON.stringify(results, null, 2);
      } else if (output_format === "markdown") {
        // Convert to Markdown
        exportContent = "# CodeQL Analysis Results\n\n";
        for (const run of sarif.runs || []) {
          exportContent += `## ${run.tool?.driver?.name || 'CodeQL'}\n\n`;
          exportContent += "| Rule | Message | Level | Location |\n";
          exportContent += "|------|---------|-------|----------|\n";
          for (const result of run.results || []) {
            const file = result.locations?.[0]?.physicalLocation?.artifactLocation?.uri || "";
            const line = result.locations?.[0]?.physicalLocation?.region?.startLine || "";
            const location = line ? `${file}:${line}` : file;
            exportContent += `| ${result.ruleId} | ${result.message.text} | ${result.level || 'warning'} | ${location} |\n`;
          }
        }
      }

      // Write to output file
      await writeFile(output_path, exportContent);

      return {
        content: [
          {
            type: "text",
            text: `Results exported successfully to ${output_path} in ${output_format} format`,
          },
        ],
      };
    } catch (error: any) {
      throw new Error(`Failed to export results: ${error.message}`);
    }
  }

  private async handleFindFunction(args: any) {
    const { database_name, function_name, limit = 50 } = args;

    const db = this.databases.get(database_name);
    if (!db) {
      throw new Error(`Database '${database_name}' not found`);
    }

    try {
      // Create a temporary CodeQL query to find functions
      const queryDir = join(CODEQL_DB_DIR, ".queries");
      await mkdir(queryDir, { recursive: true });

      // Create language-specific qlpack.yml for this query
      const qlpackPath = join(queryDir, "qlpack.yml");
      let libraryDep = "";
      
      if (db.language === "javascript" || db.language === "typescript") {
        libraryDep = "codeql/javascript-all";
      } else if (db.language === "python") {
        libraryDep = "codeql/python-all";
      } else if (db.language === "java") {
        libraryDep = "codeql/java-all";
      } else if (db.language === "cpp" || db.language === "c") {
        libraryDep = "codeql/cpp-all";
      } else if (db.language === "go") {
        libraryDep = "codeql/go-all";
      } else if (db.language === "csharp") {
        libraryDep = "codeql/csharp-all";
      } else if (db.language === "ruby") {
        libraryDep = "codeql/ruby-all";
      }

      const qlpackContent = `name: codeql-mcp/queries
version: 1.0.0
libraryPathDependencies:
  - ${libraryDep}
`;
      await writeFile(qlpackPath, qlpackContent);

      const queryFile = join(queryDir, `find-function-${Date.now()}.ql`);
      
      // Generate query based on language
      let query = "";
      const searchPattern = function_name.toLowerCase();
      
      if (db.language === "javascript" || db.language === "typescript") {
        query = `
import javascript

from Function f
where f.getName().toLowerCase().matches("%${searchPattern}%")
select f, f.getName() as name, f.getFile().getRelativePath() as file, 
       f.getLocation().getStartLine() as line, f.getNumParameter() as params
`;
      } else if (db.language === "python") {
        query = `
import python

from Function f
where f.getName().toLowerCase().matches("%${searchPattern}%")
select f, f.getName() as name, f.getFile().getRelativePath() as file,
       f.getLocation().getStartLine() as line, f.getNumParameter() as params
`;
      } else if (db.language === "java") {
        query = `
import java

from Method m
where m.getName().toLowerCase().matches("%${searchPattern}%")
select m, m.getName() as name, m.getFile().getRelativePath() as file,
       m.getLocation().getStartLine() as line, m.getNumberOfParameters() as params
`;
      } else if (db.language === "cpp" || db.language === "c") {
        query = `
import cpp

from Function f
where f.getName().toLowerCase().matches("%${searchPattern}%")
select f, f.getName() as name, f.getFile().getRelativePath() as file,
       f.getLocation().getStartLine() as line, f.getNumberOfParameters() as params
`;
      } else if (db.language === "go") {
        query = `
import go

from Function f
where f.getName().toLowerCase().matches("%${searchPattern}%")
select f, f.getName() as name, f.getFile().getRelativePath() as file,
       f.getLocation().getStartLine() as line, f.getNumParameter() as params
`;
      } else if (db.language === "csharp") {
        query = `
import csharp

from Method m
where m.getName().toLowerCase().matches("%${searchPattern}%")
select m, m.getName() as name, m.getFile().getRelativePath() as file,
       m.getLocation().getStartLine() as line, m.getNumberOfParameters() as params
`;
      } else if (db.language === "ruby") {
        query = `
import ruby

from Method m
where m.getName().toLowerCase().matches("%${searchPattern}%")
select m, m.getName() as name, m.getFile().getRelativePath() as file,
       m.getLocation().getStartLine() as line, m.getNumberOfParameters() as params
`;
      } else {
        throw new Error(`Unsupported language: ${db.language}`);
      }

      // Write query to file
      await writeFile(queryFile, query);

      // Run the query and output BQRS with multi-threading
      const bqrsFile = join(queryDir, `results-${Date.now()}.bqrs`);
      await this.runCodeQL([
        "query",
        "run",
        queryFile,
        "--database",
        db.path,
        "--output",
        bqrsFile,
        "--threads=0",  // Use all available CPU cores
        "--ram=2048",   // Allocate more RAM for faster execution
      ]);

      // Decode BQRS to CSV
      const outputFile = join(queryDir, `results-${Date.now()}.csv`);
      const { stdout: csvOutput } = await execFileAsync(CODEQL_PATH, [
        "bqrs",
        "decode",
        bqrsFile,
        "--format=csv",
        "--output",
        outputFile,
      ]);

      // Read and parse results
      let results = "";
      try {
        results = await readFile(outputFile, "utf-8");
      } catch {
        // If no output file, use stdout
        results = csvOutput;
      }

      // Parse CSV and format results
      const lines = results.trim().split("\n");
      if (lines.length <= 1) {
        return {
          content: [
            {
              type: "text",
              text: `No functions found matching '${function_name}'`,
            },
          ],
        };
      }

      // Skip header and limit results
      const matches = lines.slice(1, Math.min(limit + 1, lines.length));
      
      let formattedResults = `Found ${matches.length} function(s) matching '${function_name}':\n\n`;
      
      for (const line of matches) {
        const parts = line.split(",");
        if (parts.length >= 4) {
          const name = parts[1]?.replace(/"/g, "");
          const file = parts[2]?.replace(/"/g, "");
          const lineNum = parts[3]?.replace(/"/g, "");
          const params = parts[4]?.replace(/"/g, "") || "0";
          formattedResults += `📍 ${name}(${params} params) - ${file}:${lineNum}\n`;
        }
      }

      // Cleanup temp files
      try {
        await unlink(queryFile);
        await unlink(bqrsFile);
        await unlink(outputFile);
      } catch {
        // Ignore cleanup errors
      }

      return {
        content: [
          {
            type: "text",
            text: formattedResults,
          },
        ],
      };
    } catch (error: any) {
      throw new Error(
        `Failed to find functions: ${error.message}\n${error.stderr || ""}`
      );
    }
  }

  private async handleBuildGraphIndex(args: any) {
    const { database_name } = args;

    const db = this.databases.get(database_name);
    if (!db) {
      throw new Error(`Database '${database_name}' not found`);
    }

    const startTime = Date.now();

    try {
      // Test PostgreSQL connection
      const pgConnected = await postgres.testConnection();
      if (!pgConnected) {
        throw new Error("PostgreSQL connection failed. Run: ./scripts/setup-postgres.sh");
      }

      // Clear existing data for this database
      console.error(`Clearing existing data for ${database_name}...`);
      await postgres.clearDatabase(database_name);

      const tempDir = join(CODEQL_DB_DIR, ".temp");
      await mkdir(tempDir, { recursive: true });

      // Language-specific query directory selection
      const language = db.language;
      let languageDir = "";
      
      // Map languages to query directories
      if (language === "javascript" || language === "typescript") {
        languageDir = "javascript";
      } else if (language === "python") {
        languageDir = "python";
      } else if (language === "java") {
        languageDir = "java";
      } else if (language === "cpp" || language === "c") {
        languageDir = "cpp";
      } else if (language === "go") {
        languageDir = "go";
      } else if (language === "csharp") {
        languageDir = "csharp";
      } else if (language === "ruby") {
        languageDir = "ruby";
      } else {
        throw new Error(`Unsupported language for graph indexing: ${language}`);
      }

      const queryDir = join(PROJECT_ROOT, "queries", "export", languageDir);

      const extractions = [
        { query: "extract-functions.ql", table: "functions", columns: ["codeql_id", "name", "file", "line", "num_params", "signature"], required: true },
        { query: "extract-calls.ql", table: "function_calls", columns: ["caller_codeql_id", "callee_codeql_id", "file", "line"], required: false, processRow: (parts: (string | null)[]) => {
          // Extract callee_name from callee_codeql_id for better indexing
          // Format: "unresolved:functionName@file:line" or "Function@file:line"
          const calleeId = parts[1];
          let calleeName: string | null = null;
          if (calleeId?.startsWith("unresolved:")) {
            const match = calleeId.match(/^unresolved:([^@]+)@/);
            calleeName = match ? match[1] : null;
          } else if (calleeId) {
            const match = calleeId.match(/^([^@]+)@/);
            calleeName = match ? match[1] : null;
          }
          return [...parts, calleeName];
        }},
        { query: "extract-classes.ql", table: "classes", columns: ["codeql_id", "name", "file", "line", "parent_codeql_id"], required: false },
        { query: "extract-methods.ql", table: "class_methods", columns: ["class_codeql_id", "method_codeql_id", "method_name"], required: false },
      ];

      const stats: any = {};

      for (const { query, table, columns, required, processRow } of extractions) {
        console.error(`\nExtracting ${languageDir}/${query}...`);
        
        const queryFile = join(queryDir, query);
        
        // Check if query file exists, skip if not required
        try {
          await access(queryFile);
        } catch {
          if (required) {
            throw new Error(`Required query file not found: ${queryFile}\n\nGraph indexing for ${language} requires extraction queries in queries/export/${languageDir}/`);
          }
          console.error(`  Skipping ${languageDir}/${query} (not found)`);
          stats[table] = 0;
          continue;
        }
        
        const bqrsFile = join(tempDir, `${query}.bqrs`);
        const csvFile = join(tempDir, `${query}.csv`);

        // Run extraction query
        await this.runCodeQL([
          "query",
          "run",
          queryFile,
          "--database",
          db.path,
          "--output",
          bqrsFile,
          "--threads=0",
        ]);

        // Decode to CSV
        await execFileAsync(CODEQL_PATH, [
          "bqrs",
          "decode",
          bqrsFile,
          "--format=csv",
          "--output",
          csvFile,
        ]);

        // Import to PostgreSQL
        console.error(`Importing to ${table}...`);
        
        // Add database_name column to CSV
        const csvContent = await readFile(csvFile, "utf-8");
        const lines = csvContent.trim().split("\n");
        const dataLines = lines.slice(1); // Skip header
        
        // Build VALUES for batch insert
        // Include callee_name for function_calls if processRow is defined
        const actualColumns = processRow ? ["database_name", ...columns, "callee_name"] : ["database_name", ...columns];
        const values: (string | null)[][] = [];
        
        // Simple CSV parser that handles quoted fields with commas
        function parseCSVLine(line: string): string[] {
          const result: string[] = [];
          let current = "";
          let inQuotes = false;
          
          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];
            
            if (char === '"' && !inQuotes) {
              inQuotes = true;
            } else if (char === '"' && inQuotes && nextChar === '"') {
              current += '"';
              i++; // Skip next quote
            } else if (char === '"' && inQuotes) {
              inQuotes = false;
            } else if (char === ',' && !inQuotes) {
              result.push(current);
              current = "";
            } else {
              current += char;
            }
          }
          result.push(current); // Add last field
          return result;
        }
        
        const seenIds = new Set<string>(); // Track unique IDs
        let skippedDuplicates = 0;
        
        for (const line of dataLines) {
          if (line.trim()) {
            const parts = parseCSVLine(line).map(v => {
              v = v.trim();
              // Convert empty strings to null for optional fields
              return v === "" ? null : v;
            });
            
            // Check for duplicates (first column is the unique ID after database_name)
            const uniqueId = parts[0];
            if (uniqueId && seenIds.has(uniqueId)) {
              skippedDuplicates++;
              continue; // Skip this duplicate
            }
            if (uniqueId) {
              seenIds.add(uniqueId);
            }
            
            // Apply row processor if defined (e.g., to extract callee_name)
            const rowData = processRow ? processRow(parts) : parts;
            const row = [database_name, ...rowData];
            
            values.push(row);
          }
        }

        if (skippedDuplicates > 0) {
          console.error(`⚠ Skipped ${skippedDuplicates} duplicate entries`);
        }

        if (values.length > 0) {
          // Batch insert with limit to avoid PostgreSQL parameter limit (65535)
          // Be conservative: use 8000 params max per batch to be safe
          const maxParams = 8000;
          const batchSize = Math.floor(maxParams / actualColumns.length);
          
          console.error(`Inserting ${values.length} rows (${actualColumns.length} columns each) in batches of ${batchSize}...`);
          
          for (let i = 0; i < values.length; i += batchSize) {
            const batch = values.slice(i, i + batchSize);
            const placeholders = batch.map((_, batchIdx) => 
              `(${actualColumns.map((__, j) => `$${batchIdx * actualColumns.length + j + 1}`).join(", ")})`
            ).join(", ");
            
            const flatValues = batch.flat();
            const expectedParams = batch.length * actualColumns.length;
            
            if (flatValues.length !== expectedParams) {
              console.error(`WARNING: Mismatch! flatValues.length=${flatValues.length}, expected=${expectedParams}`);
            }
            
            await postgres.executeQuery(
              `INSERT INTO ${table} (${actualColumns.join(", ")}) VALUES ${placeholders}`,
              flatValues
            );
            console.error(`  ✓ Batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(values.length/batchSize)}: ${batch.length} rows, ${flatValues.length} params`);
          }
        }

        stats[table] = values.length;

        // Cleanup temp files
        try {
          await unlink(bqrsFile);
          await unlink(csvFile);
        } catch {}
      }

      // Update foreign key references
      console.error("\nUpdating relationships...");
      await postgres.updateForeignKeys(database_name);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      return {
        content: [
          {
            type: "text",
            text: `✓ Graph index built successfully in ${elapsed}s\n\n` +
                  `Statistics:\n` +
                  `  Functions: ${stats.functions || 0}\n` +
                  `  Classes: ${stats.classes || 0}\n` +
                  `  Function calls: ${stats.function_calls || 0}\n` +
                  `  Class methods: ${stats.class_methods || 0}\n\n` +
                  `Fast queries now available:\n` +
                  `  - find_function_graph\n` +
                  `  - find_callers_graph\n` +
                  `  - find_call_chain_graph\n` +
                  `  - get_class_hierarchy_graph\n` +
                  `  - get_graph_stats`,
          },
        ],
      };
    } catch (error: any) {
      throw new Error(`Failed to build graph index: ${error.message}`);
    }
  }

  private async handleFindFunctionFast(args: any) {
    const { database_name, function_name, limit = 50 } = args;

    try {
      const result = await postgres.executeQuery(
        `SELECT name, file, line, num_params, signature
         FROM functions
         WHERE database_name = $1
           AND name % $2
         ORDER BY similarity(name, $2) DESC, name
         LIMIT $3`,
        [database_name, function_name, limit]
      );

      if (result.rows.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No functions found matching '${function_name}'`,
            },
          ],
        };
      }

      let output = `Found ${result.rows.length} function(s) matching '${function_name}':\n\n`;
      
      for (const row of result.rows) {
        output += `📍 ${row.name}(${row.num_params} params) - ${row.file}:${row.line}\n`;
      }

      return {
        content: [{ type: "text", text: output }],
      };
    } catch (error: any) {
      if (error.message.includes("relation") && error.message.includes("does not exist")) {
        throw new Error("Graph index not built. Run: build_graph_index " + database_name);
      }
      throw error;
    }
  }

  private async handleFindCallers(args: any) {
    const { database_name, function_name } = args;

    try {
      // Find callers both through resolved function references AND unresolved call names
      const result = await postgres.executeQuery(
        `SELECT 
           caller.name as caller_name,
           caller.file as caller_file,
           fc.line as call_line,
           CASE WHEN fc.callee_id IS NOT NULL THEN 'resolved' ELSE 'unresolved' END as call_type
         FROM function_calls fc
         JOIN functions caller ON caller.id = fc.caller_id
         LEFT JOIN functions callee ON callee.id = fc.callee_id
         WHERE (callee.name = $1 OR fc.callee_name = $1)
           AND fc.database_name = $2
         ORDER BY caller.file, fc.line
         LIMIT 200`,
        [function_name, database_name]
      );

      if (result.rows.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No callers found for function '${function_name}'`,
            },
          ],
        };
      }

      let output = `Found ${result.rows.length} call site(s) for '${function_name}':\n\n`;
      
      for (const row of result.rows) {
        const indicator = row.call_type === 'resolved' ? '📞' : '🔗';
        output += `${indicator} ${row.caller_name}() calls it at ${row.caller_file}:${row.call_line}\n`;
      }

      return {
        content: [{ type: "text", text: output }],
      };
    } catch (error: any) {
      if (error.message.includes("relation") && error.message.includes("does not exist")) {
        throw new Error("Graph index not built. Run: build_graph_index " + database_name);
      }
      throw error;
    }
  }

  private async handleFindCallChain(args: any) {
    const { database_name, from_function, to_function, max_depth = 5 } = args;

    try {
      const result = await postgres.executeQuery(
        `WITH RECURSIVE call_chain AS (
           SELECT 
             f.id,
             f.name,
             f.file,
             ARRAY[f.name] as path,
             0 as depth
           FROM functions f
           WHERE f.name = $1 AND f.database_name = $3
           
           UNION ALL
           
           SELECT 
             callee.id,
             callee.name,
             callee.file,
             cc.path || callee.name,
             cc.depth + 1
           FROM call_chain cc
           JOIN function_calls fc ON fc.caller_id = cc.id
           LEFT JOIN functions callee ON (
             callee.id = fc.callee_id OR 
             callee.name = fc.callee_name
           )
           WHERE callee.database_name = $3
             AND cc.depth < $4
             AND NOT callee.name = ANY(cc.path)
         )
         SELECT path, depth, file
         FROM call_chain
         WHERE name = $2
         ORDER BY depth
         LIMIT 1`,
        [from_function, to_function, database_name, max_depth]
      );

      if (result.rows.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No call chain found from '${from_function}' to '${to_function}' within depth ${max_depth}`,
            },
          ],
        };
      }

      const row = result.rows[0];
      const path = row.path.join(" → ");

      return {
        content: [
          {
            type: "text",
            text: `Call chain found (depth ${row.depth}):\n\n${path}`,
          },
        ],
      };
    } catch (error: any) {
      if (error.message.includes("relation") && error.message.includes("does not exist")) {
        throw new Error("Graph index not built. Run: build_graph_index " + database_name);
      }
      throw error;
    }
  }

  private async handleGetClassHierarchy(args: any) {
    const { database_name, class_name } = args;

    try {
      // Get class and its ancestors
      const hierarchyResult = await postgres.executeQuery(
        `WITH RECURSIVE class_hierarchy AS (
           SELECT c.id, c.name, c.file, c.line, c.parent_id, 0 as level
           FROM classes c
           WHERE c.name = $1 AND c.database_name = $2
           
           UNION ALL
           
           SELECT c.id, c.name, c.file, c.line, c.parent_id, ch.level + 1
           FROM class_hierarchy ch
           JOIN classes c ON c.id = ch.parent_id
           WHERE ch.level < 10
         )
         SELECT * FROM class_hierarchy ORDER BY level DESC`,
        [class_name, database_name]
      );

      if (hierarchyResult.rows.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `Class '${class_name}' not found`,
            },
          ],
        };
      }

      // Get methods for each class in hierarchy
      const classIds = hierarchyResult.rows.map(r => r.id);
      const methodsResult = await postgres.executeQuery(
        `SELECT c.name as class_name, f.name as method_name, f.line
         FROM class_methods cm
         JOIN classes c ON c.id = cm.class_id
         JOIN functions f ON f.id = cm.method_id
         WHERE c.id = ANY($1)
         ORDER BY c.name, f.name`,
        [classIds]
      );

      const methodsByClass: { [key: string]: string[] } = {};
      for (const row of methodsResult.rows) {
        if (!methodsByClass[row.class_name]) {
          methodsByClass[row.class_name] = [];
        }
        methodsByClass[row.class_name].push(row.method_name);
      }

      let output = `Class hierarchy for '${class_name}':\n\n`;
      
      for (const row of hierarchyResult.rows) {
        const indent = "  ".repeat(hierarchyResult.rows.length - row.level - 1);
        const methods = methodsByClass[row.name] || [];
        const methodList = methods.length > 0 ? ` [${methods.slice(0, 5).join(", ")}${methods.length > 5 ? "..." : ""}]` : "";
        output += `${indent}${row.name} (${row.file}:${row.line})${methodList}\n`;
      }

      return {
        content: [{ type: "text", text: output }],
      };
    } catch (error: any) {
      if (error.message.includes("relation") && error.message.includes("does not exist")) {
        throw new Error("Graph index not built. Run: build_graph_index " + database_name);
      }
      throw error;
    }
  }

  private async handleQueryGraphStats(args: any) {
    const { database_name } = args;

    try {
      const stats = await postgres.getDatabaseStats(database_name);

      // Get top 10 most called functions
      const hotSpotsResult = await postgres.executeQuery(
        `SELECT 
           f.name,
           f.file,
           COUNT(fc.id) as call_count,
           COUNT(DISTINCT fc.caller_id) as unique_callers
         FROM functions f
         JOIN function_calls fc ON fc.callee_id = f.id
         WHERE f.database_name = $1
         GROUP BY f.id, f.name, f.file
         HAVING COUNT(fc.id) > 1
         ORDER BY call_count DESC
         LIMIT 10`,
        [database_name]
      );

      let output = `Graph Database Statistics for '${database_name}':\n\n`;
      output += `Total entities:\n`;
      output += `  Functions: ${stats.functions}\n`;
      output += `  Classes: ${stats.classes}\n`;
      output += `  Function calls: ${stats.calls}\n`;
      output += `  Class methods: ${stats.methods}\n`;
      output += `  Variables: ${stats.variables}\n\n`;

      if (hotSpotsResult.rows.length > 0) {
        output += `Top 10 most-called functions (hot spots):\n`;
        for (const row of hotSpotsResult.rows) {
          output += `  🔥 ${row.name}() - ${row.call_count} calls from ${row.unique_callers} callers\n`;
        }
      }

      return {
        content: [{ type: "text", text: output }],
      };
    } catch (error: any) {
      if (error.message.includes("relation") && error.message.includes("does not exist")) {
        throw new Error("Graph index not built. Run: build_graph_index " + database_name);
      }
      throw error;
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("CodeQL MCP server running on stdio");
  }
}

const server = new CodeQLMCPServer();
server.run().catch(console.error);
