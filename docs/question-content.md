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

Technical content for noncoding roles is delivered separately in issue #38.
Until it is present, the default all-MVP coverage validator correctly reports
those missing combinations; workplace coverage is validated independently.
