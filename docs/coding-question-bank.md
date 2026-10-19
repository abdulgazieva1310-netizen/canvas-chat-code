# Curated coding questions

`backend/app/data/coding_questions.v1.json` contains 45 original algorithm prompts,
15 each for Junior, Middle, and Senior. Each entry explicitly supports Java,
Python, C++, Backend, and Full Stack Developers. Algorithm skills transfer across
these roles; language requirements are applied when rendering the candidate prompt.
Named-language roles require that language; Backend and Full Stack use the
candidate's selected language. No solution or reviewer notes are rendered.

Junior covers basic traversal, counting, search, and simple data structures.
Middle adds compound structures, graph traversal, and dynamic programming.
Senior adds performance constraints, advanced graph/sequence algorithms, and
stateful data structures. Examples define ordering, duplicates, and boundary
semantics; private notes explain expected approaches and implementation hazards.
Version 1 entries and IDs are stable; revise the schema version for incompatible
format changes. This content is delivered for #37; runtime interview integration
remains with the bank/lifecycle issues (#14/#15).

The loader rejects malformed entries, duplicate IDs, unsupported versions, and
coding prompts without examples/constraints. The deterministic selector filters
role, level, type, and used IDs, and raises `BankError` on exhaustion. Callers must
persist selected IDs for the session. The coverage validator accepts explicit
session configurations so later content issues can expand the checked matrix.

Run `cd backend && uv run pytest tests/test_question_bank.py` to check all 15
role/level configurations for complete, nonrepeating 15-question sequences,
language rendering, schema validation, filtering, and exhaustion.
