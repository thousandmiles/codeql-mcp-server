/**
 * @name Extract Classes
 * @description Extract all class definitions with inheritance relationships
 * @kind table
 * @id codeql-mcp/extract-classes
 */

import javascript

from ClassDefinition c
where exists(c.getName())
select c.toString() + "@" + c.getFile().getRelativePath() + ":" +
    c.getLocation().getStartLine().toString() as codeql_id, c.getName() as name,
  c.getFile().getRelativePath() as file, c.getLocation().getStartLine() as line,
  "" as parent_codeql_id
