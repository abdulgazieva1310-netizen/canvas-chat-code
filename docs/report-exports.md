# Saved report downloads

Results offers **Download Markdown report** for ended sessions. The authenticated
`GET /api/interviews/{interviewId}/report/export` operation returns a UTF-8
`text/markdown` attachment generated only from saved public report data. Active
sessions return 409; missing and inaccessible interviews both return 404.

Exports include configuration, timestamps, recorded language, partial/unscored
labels, category and per-answer scores, coaching feedback and the transcript.
Input/code blocks use a fence longer than any backtick sequence in their content.
The document labels scores as approximate coaching rather than hiring predictions.
No new AI evaluation is requested. Raw media, credentials, internal reviewer
notes, private storage metadata and hidden judge tests are excluded.
