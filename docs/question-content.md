# Curated question content

The default bank merges versioned `backend/app/data/*_questions.v1.json` files,
validates every entry, and rejects duplicate stable IDs across files. Supplying
an explicit file to `load_bank` validates that file alone. Candidate rendering
never includes reviewer notes.

`workplace_questions.v1.json` contains 45 reusable behavioral entries and 225
role-specific entries. Behavioral records explicitly support all nine roles.
Software delivery scenarios are shared by Backend, Full Stack, Java, Python and
C++ developers; Frontend, QA, Data Analyst and DevOps have dedicated scenario sets.
Each role/type/level has 15 distinct topics. Junior scenarios focus on concrete
steps with guidance, Middle on independent ownership, and Senior on cross-team
systems and sustainable outcomes. Behavioral prompts ask for personal actions,
results and learning rather than hypothetical slogans.

Content review checks scenario clarity, role responsibility, difficulty scope,
original wording, expected concepts and absence of answers in candidate text.
Coverage checks select 15 distinct records for all 54 workplace combinations:

```sh
uv run --project backend pytest backend/tests/test_workplace_questions.py backend/tests/test_question_bank.py
```

`noncoding_questions.v1.json` adds 180 technical scenarios: 15 distinct topics
for each of Frontend Developer, QA Engineer, Data Analyst and DevOps Engineer,
with separate Junior, Middle and Senior prompts. Junior asks for fundamentals
and concrete diagnostic steps; Middle adds independent investigation and
verification; Senior adds platform scope, systemic failure modes and ownership.
Each prompt describes an answerable situation and keeps expected concepts in
reviewer notes. These roles do not receive the coding-only constraints rule.

The complete bank contains 495 stable records and covers all 81 MVP
role/type/level combinations with 15 unique questions in each. Run:

```sh
uv run --project backend pytest backend/tests/test_noncoding_questions.py backend/tests/test_workplace_questions.py backend/tests/test_question_bank.py
```
