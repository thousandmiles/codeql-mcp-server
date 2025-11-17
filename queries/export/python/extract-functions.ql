/**
 * @name Extract Functions (Python)
 * @description Extract all function definitions with metadata for graph database
 * @kind table
 * @id codeql-mcp/extract-functions-python
 */

import python

from Function f
where exists(f.getName())
select f.toString() + "@" + f.getLocation().getFile().getRelativePath() + ":" +
    f.getLocation().getStartLine().toString() as codeql_id, f.getName() as name,
  f.getLocation().getFile().getRelativePath() as file, f.getLocation().getStartLine() as line,
  f.getPositionalParameterCount() as num_params, f.toString() as signature
