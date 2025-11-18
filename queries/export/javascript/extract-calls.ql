/**
 * @name Extract Function Calls
 * @description Extract call graph: which functions call which functions
 * @kind table
 * @id codeql-mcp/extract-calls
 */

import javascript

from InvokeExpr call, Function caller, string callee_codeql_id
where
  caller = call.getEnclosingFunction() and
  (
    // Resolved calls: link to actual function
    exists(Function callee |
      callee = call.getResolvedCallee() and
      callee_codeql_id =
        callee.toString() + "@" + callee.getFile().getRelativePath() + ":" +
          callee.getLocation().getStartLine().toString()
    )
    or
    // Unresolved calls: store call site with function name
    not exists(call.getResolvedCallee()) and
    callee_codeql_id =
      "unresolved:" + call.getCalleeName() + "@" + call.getFile().getRelativePath() + ":" +
        call.getLocation().getStartLine().toString()
  )
select caller.getName() + "@" + caller.toString() + "@" + caller.getFile().getRelativePath() + ":" +
    caller.getLocation().getStartLine().toString() + ":" +
    caller.getLocation().getStartColumn().toString() as caller_codeql_id, callee_codeql_id,
  call.getFile().getRelativePath() as file, call.getLocation().getStartLine() as line
