/**
 * @name Extract Classes (Python)
 * @description Extract all class definitions with inheritance relationships
 * @kind table
 * @id codeql-mcp/extract-classes-python
 */

import python

from Class c
where exists(c.getName())
select c.toString() + "@" + c.getLocation().getFile().getRelativePath() + ":" +
    c.getLocation().getStartLine().toString() as codeql_id, c.getName() as name,
  c.getLocation().getFile().getRelativePath() as file, c.getLocation().getStartLine() as line,
  "" as parent_codeql_id
