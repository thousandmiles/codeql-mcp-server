-- Migration script to add callee_name column to existing function_calls table
-- Run this if you have an existing database and don't want to recreate it

-- Add callee_name column
ALTER TABLE function_calls ADD COLUMN IF NOT EXISTS callee_name TEXT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_calls_callee_name ON function_calls(callee_name);

-- Extract callee_name from existing callee_codeql_id values
UPDATE function_calls
SET callee_name = (
  CASE
    -- Extract from "unresolved:functionName@file:line" format
    WHEN callee_codeql_id LIKE 'unresolved:%' THEN
      substring(callee_codeql_id from 'unresolved:([^@]+)@')
    -- Extract from "FunctionName@file:line" format
    ELSE
      substring(callee_codeql_id from '^([^@]+)@')
  END
)
WHERE callee_name IS NULL;

COMMENT ON COLUMN function_calls.callee_name IS 'Function name extracted from callee_codeql_id for faster unresolved call lookups';
