/**
 * @name Extract Function Calls
 * @description Extract call graph: which functions call which functions
 * @kind table
 * @id codeql-mcp/extract-calls
 */

import javascript

from InvokeExpr call, Function caller, Function callee
where
  caller = call.getEnclosingFunction() and
  callee = call.getResolvedCallee() and
  exists(caller.getName()) and
  exists(callee.getName())
select caller.toString() + "@" + caller.getFile().getRelativePath() + ":" +
    caller.getLocation().getStartLine().toString() as caller_codeql_id,
  callee.toString() + "@" + callee.getFile().getRelativePath() + ":" +
    callee.getLocation().getStartLine().toString() as callee_codeql_id,
  call.getFile().getRelativePath() as file, call.getLocation().getStartLine() as line
