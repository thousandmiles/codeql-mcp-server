/**
 * @name Extract Class Methods
 * @description Extract relationships between classes and their methods
 * @kind table
 * @id codeql-mcp/extract-methods
 */

import javascript

from ClassDefinition c, MethodDefinition m
where m = c.getAMethod() and exists(c.getName()) and exists(m.getName())
select c.toString() + "@" + c.getFile().getRelativePath() + ":" +
    c.getLocation().getStartLine().toString() as class_codeql_id,
  m.toString() + "@" + m.getFile().getRelativePath() + ":" +
    m.getLocation().getStartLine().toString() as method_codeql_id, m.getName() as method_name
