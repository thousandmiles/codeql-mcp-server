/**
 * @name Extract Function Calls (Python)
 * @description Extract call graph: which functions call which functions
 * @kind table
 * @id codeql-mcp/extract-calls-python
 */

import python

from Call call, Function caller, Function callee
where
  caller = call.getScope() and
  callee = call.getFunc().(Name).getVariable().getAStore().getScope() and
  exists(caller.getName()) and
  exists(callee.getName())
select caller.toString() + "@" + caller.getLocation().getFile().getRelativePath() + ":" +
    caller.getLocation().getStartLine().toString() as caller_codeql_id,
  callee.toString() + "@" + callee.getLocation().getFile().getRelativePath() + ":" +
    callee.getLocation().getStartLine().toString() as callee_codeql_id,
  call.getLocation().getFile().getRelativePath() as file, call.getLocation().getStartLine() as line
