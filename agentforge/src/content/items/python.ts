// Python exercises. They run in Pyodide (CPython on WebAssembly) inside an isolated worker.
// Each test is a Python expression that must evaluate to True.
import type { Item } from '@/core/types';
import { code } from './helpers';

const py = (id: string, skillId: string, d: 1 | 2 | 3 | 4, prompt: string, spec: { exports: string[]; starter: string; solution: string; tests: [string, string][] }, explanation: string, hints: string[] = []) =>
  code(id, skillId, d, prompt, { ...spec, language: 'python' }, explanation, 'incomplete', hints);

export const PYTHON_ITEMS: Item[] = [
  py('pg-basics-py', 'pg-basics', 1, 'Python: write `count_passing(scores)` returning how many scores are 60 or higher.', {
    exports: ['count_passing'],
    starter: `def count_passing(scores):\n    passed = 0\n    # loop over scores\n    return passed\n`,
    solution: `def count_passing(scores):\n    return sum(1 for s in scores if s >= 60)\n`,
    tests: [['mixed scores', 'count_passing([72, 91, 58]) == 2'], ['exactly 60 counts', 'count_passing([60, 59]) == 1'], ['empty list', 'count_passing([]) == 0']],
  }, 'A loop (or a generator expression) with a condition and a counter.', ['for s in scores:', 'if s >= 60: passed += 1']),
  py('pg-functions-data-py', 'pg-functions-data', 2, 'Python: write `cart_total(items)` summing `price * qty` for items whose `in_stock` is True. Items are dicts.', {
    exports: ['cart_total'],
    starter: `def cart_total(items):\n    return 0\n`,
    solution: `def cart_total(items):\n    return sum(i["price"] * i["qty"] for i in items if i["in_stock"])\n`,
    tests: [
      ['sums in-stock items', 'cart_total([{"price": 10, "qty": 2, "in_stock": True}, {"price": 5, "qty": 1, "in_stock": False}]) == 20'],
      ['empty cart', 'cart_total([]) == 0'],
      ['several items', 'cart_total([{"price": 1.5, "qty": 2, "in_stock": True}, {"price": 2, "qty": 3, "in_stock": True}]) == 9'],
    ],
  }, 'A generator expression with a condition replaces filter + map + reduce.', ['sum(... for i in items if ...)']),
  py('pg-errors-py', 'pg-errors', 2, 'Python: write `parse_age(text)` returning an int, or raising `ValueError("invalid age")` unless the text is a whole number from 0 to 150.', {
    exports: ['parse_age'],
    starter: `def parse_age(text):\n    return int(text)\n`,
    solution: `def parse_age(text):\n    t = str(text).strip()\n    if not t.isdigit():\n        raise ValueError("invalid age")\n    n = int(t)\n    if n > 150:\n        raise ValueError("invalid age")\n    return n\n`,
    tests: [
      ['valid', 'parse_age("42") == 42'],
      ['rejects text', '_raises(parse_age, "abc", exc=ValueError)'],
      ['rejects negative', '_raises(parse_age, "-1", exc=ValueError)'],
      ['rejects decimals', '_raises(parse_age, "3.5", exc=ValueError)'],
      ['rejects too old', '_raises(parse_age, "200", exc=ValueError)'],
    ],
  }, 'Validate first, then convert; raise a clear error for anything else.', ['str.isdigit() rejects "-1" and "3.5".']),
  py('pg-json-http-py', 'pg-json-http', 2, 'Python: write `safe_parse(text)` returning `{"ok": True, "value": ...}` for valid JSON and `{"ok": False, "error": <str>}` otherwise. Use the `json` module.', {
    exports: ['safe_parse'],
    starter: `import json\n\ndef safe_parse(text):\n    return {"ok": True, "value": json.loads(text)}\n`,
    solution: `import json\n\ndef safe_parse(text):\n    try:\n        return {"ok": True, "value": json.loads(text)}\n    except json.JSONDecodeError as e:\n        return {"ok": False, "error": str(e)}\n`,
    tests: [['valid', 'safe_parse(\'{"a": 1}\') == {"ok": True, "value": {"a": 1}}'], ['invalid', 'safe_parse("{a: 1}")["ok"] is False and isinstance(safe_parse("{a: 1}")["error"], str)'], ['array', 'safe_parse("[1, 2]")["value"] == [1, 2]']],
  }, 'Model output can be malformed JSON — parse defensively.', ['try / except json.JSONDecodeError']),
  py('api-structured-py', 'api-structured', 3, 'Python: write `validate_invoice(inv)` returning a list of problems (empty if valid): "number" if number is not a non-empty str; "total" if total is not a number ≥ 0; "lines" if lines is not a list; "sum" if the line amounts do not add up to total within 0.01.', {
    exports: ['validate_invoice'],
    starter: `def validate_invoice(inv):\n    return []\n`,
    solution: `def validate_invoice(inv):\n    errors = []\n    if not isinstance(inv.get("number"), str) or not inv.get("number"):\n        errors.append("number")\n    total = inv.get("total")\n    total_ok = isinstance(total, (int, float)) and not isinstance(total, bool) and total >= 0\n    if not total_ok:\n        errors.append("total")\n    lines = inv.get("lines")\n    if not isinstance(lines, list):\n        errors.append("lines")\n        return errors\n    s = sum(float(l.get("amount", 0)) for l in lines)\n    if total_ok and abs(s - total) > 0.01:\n        errors.append("sum")\n    return errors\n`,
    tests: [
      ['valid', 'validate_invoice({"number": "A1", "total": 30, "lines": [{"amount": 10}, {"amount": 20}]}) == []'],
      ['sum mismatch', '"sum" in validate_invoice({"number": "A1", "total": 31, "lines": [{"amount": 10}, {"amount": 20}]})'],
      ['empty number', '"number" in validate_invoice({"number": "", "total": 0, "lines": []})'],
      ['negative total', '"total" in validate_invoice({"number": "B", "total": -1, "lines": []})'],
      ['lines not a list', '"lines" in validate_invoice({"number": "B", "total": 0, "lines": None})'],
    ],
  }, 'Schema-shaped data can still break business rules — check them in code.'),
  py('ev-metrics-py', 'ev-metrics', 3, 'Python: write `prf(pred, gold)` for two equal-length lists of booleans, returning a dict with "precision", "recall" and "f1" (0 when a denominator is 0).', {
    exports: ['prf'],
    starter: `def prf(pred, gold):\n    return {"precision": 0, "recall": 0, "f1": 0}\n`,
    solution: `def prf(pred, gold):\n    tp = sum(1 for p, g in zip(pred, gold) if p and g)\n    fp = sum(1 for p, g in zip(pred, gold) if p and not g)\n    fn = sum(1 for p, g in zip(pred, gold) if g and not p)\n    precision = tp / (tp + fp) if tp + fp else 0\n    recall = tp / (tp + fn) if tp + fn else 0\n    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0\n    return {"precision": precision, "recall": recall, "f1": f1}\n`,
    tests: [
      ['basic', 'prf([True, True, False, False], [True, False, True, False]) == {"precision": 0.5, "recall": 0.5, "f1": 0.5}'],
      ['perfect', 'prf([True, False], [True, False])["f1"] == 1'],
      ['no predictions', 'prf([False, False], [True, False]) == {"precision": 0, "recall": 0, "f1": 0}'],
    ],
  }, 'Count true positives, false positives and false negatives with zip.'),
];
