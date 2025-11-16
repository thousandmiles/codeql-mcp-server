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
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

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
          description: "Find function definitions in the codebase with fuzzy name matching. Searches across all files and returns function locations, signatures, and containing files.",
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

      // Run the query and output BQRS
      const bqrsFile = join(queryDir, `results-${Date.now()}.bqrs`);
      await this.runCodeQL([
        "query",
        "run",
        queryFile,
        "--database",
        db.path,
        "--output",
        bqrsFile,
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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("CodeQL MCP server running on stdio");
  }
}

const server = new CodeQLMCPServer();
server.run().catch(console.error);
