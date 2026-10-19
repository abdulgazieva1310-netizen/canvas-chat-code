# Password-reset email delivery

Set `EMAIL_ADAPTER=smtp`, `SMTP_HOST`, `SMTP_PORT` (default 587), and `SMTP_FROM`.
Set `SMTP_USERNAME` and `SMTP_PASSWORD` when the server requires authentication.
Keep credentials in the deployment environment rather than source control.
SMTP uses certificate-verified STARTTLS before authentication and a 10-second
socket timeout. Delivery failures produce a generic warning without exception
contents, recipient, link, token, or credentials; public responses remain 202
with the same body for known and unknown accounts. Failed delivery does not
persist the newly issued token.

SMTP requires an explicit `PASSWORD_RESET_URL`, for example
`https://interviews.example.com/reset-password`. Existing query parameters are
preserved, any old token parameter is replaced, and the random token is URL
encoded. Use the public application origin. Absolute HTTP(S) URLs are accepted;
credentials and fragments are rejected. Local development defaults to
`http://localhost:8080/reset-password` only with the local adapter.

`EMAIL_ADAPTER=local` preserves the deterministic in-memory outbox at
`app.state.mailer.messages` without exposing it through HTTP. No SMTP credentials
are needed for this adapter.

Run `cd backend && uv run pytest tests/test_email_delivery.py tests/test_password_reset.py`.
The fake SMTP capture service records the serialized MIME message and verifies
recipient, sender, subject, decoded link, TLS, authentication, and bounded
failure behavior without sending email. Captured tokens are exercised through
the actual confirmation endpoint to check single use; recovery tests check
expiry and session revocation. This is an in-process fake SMTP service rather
than a separately deployed capture server.
