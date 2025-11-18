-- PostgreSQL Schema for CodeQL Graph Database
-- Fast queries for functions, calls, classes, and relationships

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- Fuzzy text search

-- Drop existing tables if they exist (for clean reinstall)
DROP TABLE IF EXISTS class_methods CASCADE;
DROP TABLE IF EXISTS function_calls CASCADE;
DROP TABLE IF EXISTS variables CASCADE;
DROP TABLE IF EXISTS classes CASCADE;
DROP TABLE IF EXISTS functions CASCADE;

-- Functions table
CREATE TABLE functions (
    id SERIAL PRIMARY KEY,
    codeql_id TEXT UNIQUE NOT NULL,
    database_name TEXT NOT NULL,
    name TEXT NOT NULL,
    file TEXT NOT NULL,
    line INTEGER NOT NULL,
    num_params INTEGER DEFAULT 0,
    signature TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Classes table
CREATE TABLE classes (
    id SERIAL PRIMARY KEY,
    codeql_id TEXT UNIQUE NOT NULL,
    database_name TEXT NOT NULL,
    name TEXT NOT NULL,
    file TEXT NOT NULL,
    line INTEGER NOT NULL,
    parent_codeql_id TEXT,
    parent_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Function calls (edges in call graph)
CREATE TABLE function_calls (
    id SERIAL PRIMARY KEY,
    database_name TEXT NOT NULL,
    caller_codeql_id TEXT NOT NULL,
    callee_codeql_id TEXT NOT NULL,
    caller_id INTEGER REFERENCES functions(id) ON DELETE CASCADE,
    callee_id INTEGER REFERENCES functions(id) ON DELETE CASCADE,
    callee_name TEXT,  -- Store function name even if unresolved
    file TEXT NOT NULL,
    line INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Class methods (relationship between classes and their methods)
CREATE TABLE class_methods (
    id SERIAL PRIMARY KEY,
    database_name TEXT NOT NULL,
    class_codeql_id TEXT NOT NULL,
    method_codeql_id TEXT NOT NULL,
    method_name TEXT,
    class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    method_id INTEGER REFERENCES functions(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(class_id, method_id)
);

-- Global variables
CREATE TABLE variables (
    id SERIAL PRIMARY KEY,
    database_name TEXT NOT NULL,
    name TEXT NOT NULL,
    file TEXT NOT NULL,
    line INTEGER NOT NULL,
    scope TEXT,  -- 'global', 'module', 'function'
    var_type TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for fast queries
-- Functions
CREATE INDEX idx_functions_name ON functions(name);
CREATE INDEX idx_functions_name_trgm ON functions USING gin(name gin_trgm_ops);  -- Fuzzy search
CREATE INDEX idx_functions_db ON functions(database_name);
CREATE INDEX idx_functions_file ON functions(file);
CREATE INDEX idx_functions_codeql_id ON functions(codeql_id);

-- Classes
CREATE INDEX idx_classes_name ON classes(name);
CREATE INDEX idx_classes_name_trgm ON classes USING gin(name gin_trgm_ops);  -- Fuzzy search
CREATE INDEX idx_classes_db ON classes(database_name);
CREATE INDEX idx_classes_parent ON classes(parent_id);
CREATE INDEX idx_classes_codeql_id ON classes(codeql_id);

-- Function calls (critical for call graph queries)
CREATE INDEX idx_calls_caller ON function_calls(caller_id);  -- Find what a function calls
CREATE INDEX idx_calls_callee ON function_calls(callee_id);  -- Find who calls a function
CREATE INDEX idx_calls_db ON function_calls(database_name);
CREATE INDEX idx_calls_caller_codeql ON function_calls(caller_codeql_id);
CREATE INDEX idx_calls_callee_codeql ON function_calls(callee_codeql_id);
CREATE INDEX idx_calls_callee_name ON function_calls(callee_name);  -- Lookup unresolved calls by name

-- Class methods
CREATE INDEX idx_class_methods_class ON class_methods(class_id);
CREATE INDEX idx_class_methods_method ON class_methods(method_id);
CREATE INDEX idx_class_methods_db ON class_methods(database_name);

-- Variables
CREATE INDEX idx_variables_name ON variables(name);
CREATE INDEX idx_variables_db ON variables(database_name);
CREATE INDEX idx_variables_file ON variables(file);

-- Grant permissions to codeql user
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO codeql;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO codeql;

-- Comments for documentation
COMMENT ON TABLE functions IS 'All functions extracted from CodeQL databases';
COMMENT ON TABLE classes IS 'All classes with inheritance relationships';
COMMENT ON TABLE function_calls IS 'Call graph edges: which functions call which';
COMMENT ON TABLE class_methods IS 'Relationship between classes and their methods';
COMMENT ON TABLE variables IS 'Global and module-level variables';

COMMENT ON COLUMN functions.codeql_id IS 'Unique identifier from CodeQL (e.g., function toString)';
COMMENT ON COLUMN function_calls.caller_id IS 'Foreign key to functions table (the caller)';
COMMENT ON COLUMN function_calls.callee_id IS 'Foreign key to functions table (the callee)';
COMMENT ON COLUMN classes.parent_id IS 'Foreign key to parent class for inheritance';
