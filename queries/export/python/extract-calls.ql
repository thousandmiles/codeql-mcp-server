/**
 * @name Extract Function Calls (Python)
 * @description Extract call graph: which functions call which functions
 * @kind table
 * @id codeql-mcp/extract-calls-python
 */

import python

from Call call, Function caller, string callee_codeql_id
where
  caller = call.getScope() and
  (
    // Call via Name (e.g., func_name())
    exists(string funcName |
      funcName = call.getFunc().(Name).getId() and
      callee_codeql_id =
        "unresolved:" + funcName + "@" + call.getLocation().getFile().getRelativePath() + ":" +
          call.getLocation().getStartLine().toString()
    )
    or
    // Call via Attribute (e.g., obj.method())
    exists(string attrName |
      attrName = call.getFunc().(Attribute).getName() and
      callee_codeql_id =
        "unresolved:" + attrName + "@" + call.getLocation().getFile().getRelativePath() + ":" +
          call.getLocation().getStartLine().toString()
    )
    or
    // Other calls (fallback)
    not exists(call.getFunc().(Name)) and
    not exists(call.getFunc().(Attribute)) and
    callee_codeql_id =
      "unresolved:unknown@" + call.getLocation().getFile().getRelativePath() + ":" +
        call.getLocation().getStartLine().toString()
  )
select caller.getName() + "@" + caller.toString() + "@" +
    caller.getLocation().getFile().getRelativePath() + ":" +
    caller.getLocation().getStartLine().toString() + ":" +
    caller.getLocation().getStartColumn().toString() as caller_codeql_id, callee_codeql_id,
  call.getLocation().getFile().getRelativePath() as file, call.getLocation().getStartLine() as line
