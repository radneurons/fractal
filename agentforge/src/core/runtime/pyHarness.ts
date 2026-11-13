// Python test harness. Executed by Pyodide in the browser worker and in Node unit tests.
// Input globals: __af_source (str), __af_tests (JSON str: [{name, code}]) where each test `code` is a Python
// expression that must evaluate to True. Tests may use `_raises(fn, *args, exc=ValueError)`. Output: a JSON string matching HarnessResult.
export const PY_HARNESS = String.raw`
import json, io, contextlib, traceback
__af_logs = io.StringIO()
__af_ns = {"__name__": "__learner__"}
def __af_raises(fn, *args, exc=Exception):
    try:
        fn(*args)
    except exc:
        return True
    except BaseException:
        return False
    return False
__af_ns["_raises"] = __af_raises
__af_out = {"results": [], "logs": []}
__af_tests_list = json.loads(__af_tests)
try:
    __af_code = compile(__af_source, "<your code>", "exec")
    with contextlib.redirect_stdout(__af_logs), contextlib.redirect_stderr(__af_logs):
        exec(__af_code, __af_ns)
    __af_compiled = True
except BaseException as e:
    __af_compiled = False
    __af_out["compileError"] = "".join(traceback.format_exception_only(type(e), e)).strip()
for __af_t in __af_tests_list:
    if not __af_compiled:
        __af_out["results"].append({"name": __af_t["name"], "passed": False, "error": "Code did not run"})
        continue
    try:
        with contextlib.redirect_stdout(__af_logs), contextlib.redirect_stderr(__af_logs):
            __af_r = eval(__af_t["code"], __af_ns)
        __af_ok = __af_r is True
        __af_out["results"].append({"name": __af_t["name"], "passed": __af_ok, **({} if __af_ok else {"error": "Expected True, got " + repr(__af_r)[:200]})})
    except BaseException as e:
        __af_out["results"].append({"name": __af_t["name"], "passed": False, "error": (type(e).__name__ + ": " + str(e))[:300]})
__af_out["logs"] = __af_logs.getvalue().splitlines()[:200]
json.dumps(__af_out)
`;
