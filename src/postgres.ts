import { Pool, QueryResult, QueryResultRow } from "pg";
import { readFile } from "fs/promises";

const DEFAULT_CONNECTION = "postgresql://codeql:codeql123@localhost/codeql_graph";

let pool: Pool | null = null;

/**
 * Get or create PostgreSQL connection pool
 */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.POSTGRES_CONNECTION || DEFAULT_CONNECTION;
    pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    pool.on("error", (err: Error) => {
      console.error("Unexpected error on idle PostgreSQL client", err);
    });
  }
  return pool;
}

/**
 * Execute a SQL query
 */
export async function executeQuery<T extends QueryResultRow = any>(
  query: string,
  params: any[] = []
): Promise<QueryResult<T>> {
  const pool = getPool();
  try {
    return await pool.query<T>(query, params);
  } catch (error) {
    console.error("PostgreSQL query error:", error);
    throw error;
  }
}

/**
 * Test PostgreSQL connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const result = await executeQuery("SELECT 1 as test");
    return result.rows[0]?.test === 1;
  } catch (error) {
    return false;
  }
}

/**
 * Import CSV file to PostgreSQL table using COPY command
 */
export async function importCSV(
  csvFilePath: string,
  tableName: string,
  columns: string[]
): Promise<number> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // Read CSV file
    const csvContent = await readFile(csvFilePath, "utf-8");
    const lines = csvContent.trim().split("\n");
    
    // Skip header if present
    const dataLines = lines[0].includes(",") && !lines[0].match(/^\d/) ? lines.slice(1) : lines;
    
    if (dataLines.length === 0) {
      return 0;
    }

    // Prepare COPY statement
    const columnList = columns.join(", ");
    const copyQuery = `COPY ${tableName} (${columnList}) FROM STDIN WITH (FORMAT csv)`;

    let rowCount = 0;

    // Start COPY operation
    const stream = client.query(copyQuery as any);
    
    for (const line of dataLines) {
      if (line.trim()) {
        stream.write(line + "\n");
        rowCount++;
      }
    }

    stream.end();
    
    return rowCount;
  } finally {
    client.release();
  }
}

/**
 * Import CSV using INSERT statements (fallback if COPY fails)
 */
export async function importCSVFallback(
  csvFilePath: string,
  tableName: string,
  columns: string[]
): Promise<number> {
  const csvContent = await readFile(csvFilePath, "utf-8");
  const lines = csvContent.trim().split("\n");
  
  // Skip header
  const dataLines = lines[0].includes(",") && !lines[0].match(/^\d/) ? lines.slice(1) : lines;
  
  if (dataLines.length === 0) {
    return 0;
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const insertQuery = `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`;

    let rowCount = 0;
    for (const line of dataLines) {
      if (line.trim()) {
        // Parse CSV line (simple split, doesn't handle quoted commas)
        const values = line.split(",").map(v => {
          v = v.trim().replace(/^"(.*)"$/, "$1"); // Remove quotes
          return v === "" || v === "null" ? null : v;
        });

        if (values.length === columns.length) {
          await client.query(insertQuery, values);
          rowCount++;
        }
      }
    }

    await client.query("COMMIT");
    return rowCount;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Clear all data for a specific database
 */
export async function clearDatabase(databaseName: string): Promise<void> {
  await executeQuery("DELETE FROM class_methods WHERE database_name = $1", [databaseName]);
  await executeQuery("DELETE FROM function_calls WHERE database_name = $1", [databaseName]);
  await executeQuery("DELETE FROM variables WHERE database_name = $1", [databaseName]);
  await executeQuery("DELETE FROM classes WHERE database_name = $1", [databaseName]);
  await executeQuery("DELETE FROM functions WHERE database_name = $1", [databaseName]);
}

/**
 * Update foreign key references after import
 */
export async function updateForeignKeys(databaseName: string): Promise<void> {
  // Update function_calls foreign keys
  await executeQuery(`
    UPDATE function_calls fc
    SET caller_id = f.id
    FROM functions f
    WHERE fc.caller_codeql_id = f.codeql_id
      AND fc.database_name = $1
      AND fc.caller_id IS NULL
  `, [databaseName]);

  await executeQuery(`
    UPDATE function_calls fc
    SET callee_id = f.id
    FROM functions f
    WHERE fc.callee_codeql_id = f.codeql_id
      AND fc.database_name = $1
      AND fc.callee_id IS NULL
  `, [databaseName]);

  // Update classes parent_id
  await executeQuery(`
    UPDATE classes c1
    SET parent_id = c2.id
    FROM classes c2
    WHERE c1.parent_codeql_id = c2.codeql_id
      AND c1.database_name = $1
      AND c1.parent_id IS NULL
  `, [databaseName]);

  // Update class_methods foreign keys
  await executeQuery(`
    UPDATE class_methods cm
    SET class_id = c.id
    FROM classes c
    WHERE cm.class_codeql_id = c.codeql_id
      AND cm.database_name = $1
      AND cm.class_id IS NULL
  `, [databaseName]);

  await executeQuery(`
    UPDATE class_methods cm
    SET method_id = f.id
    FROM functions f
    WHERE cm.method_codeql_id = f.codeql_id
      AND cm.database_name = $1
      AND cm.method_id IS NULL
  `, [databaseName]);
}

/**
 * Get statistics for a database
 */
export async function getDatabaseStats(databaseName: string): Promise<{
  functions: number;
  classes: number;
  calls: number;
  methods: number;
  variables: number;
}> {
  const [funcs, classes, calls, methods, vars] = await Promise.all([
    executeQuery("SELECT COUNT(*) as count FROM functions WHERE database_name = $1", [databaseName]),
    executeQuery("SELECT COUNT(*) as count FROM classes WHERE database_name = $1", [databaseName]),
    executeQuery("SELECT COUNT(*) as count FROM function_calls WHERE database_name = $1", [databaseName]),
    executeQuery("SELECT COUNT(*) as count FROM class_methods WHERE database_name = $1", [databaseName]),
    executeQuery("SELECT COUNT(*) as count FROM variables WHERE database_name = $1", [databaseName]),
  ]);

  return {
    functions: parseInt(funcs.rows[0].count),
    classes: parseInt(classes.rows[0].count),
    calls: parseInt(calls.rows[0].count),
    methods: parseInt(methods.rows[0].count),
    variables: parseInt(vars.rows[0].count),
  };
}

/**
 * Close the connection pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
