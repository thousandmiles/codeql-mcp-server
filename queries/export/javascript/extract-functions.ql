/**
 * @name Extract Functions
 * @description Extract all function definitions with metadata for graph database
 * @kind table
 * @id codeql-mcp/extract-functions
 */

import javascript

from Function f
select f.getName() + "@" + f.toString() + "@" + f.getFile().getRelativePath() + ":" +
    f.getLocation().getStartLine().toString() + ":" + f.getLocation().getStartColumn().toString() as codeql_id,
  f.getName() as name, f.getFile().getRelativePath() as file,
  f.getLocation().getStartLine() as line, f.getNumParameter() as num_params,
  f.toString() as signature
