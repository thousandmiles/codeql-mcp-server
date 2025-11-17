/**
 * @name Extract Class Methods (Python)
 * @description Extract relationships between classes and their methods
 * @kind table
 * @id codeql-mcp/extract-methods-python
 */

import python

from Class c, Function m
where m = c.getAMethod() and exists(c.getName()) and exists(m.getName())
select c.toString() + "@" + c.getLocation().getFile().getRelativePath() + ":" +
    c.getLocation().getStartLine().toString() as class_codeql_id,
  m.toString() + "@" + m.getLocation().getFile().getRelativePath() + ":" +
    m.getLocation().getStartLine().toString() as method_codeql_id, m.getName() as method_name
