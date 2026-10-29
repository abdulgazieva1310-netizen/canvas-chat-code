# Password-reset email delivery

Set `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`, and `SMTP_PASSWORD`.
With the default `EMAIL_ADAPTER=auto`, a configured host automatically selects
SMTP. `SMTP_FROM` optionally overrides the sender address; otherwise it defaults
to `SMTP_USER`. Use `SMTP_FROM` if the login username is not an email address.
The legacy `SMTP_USERNAME` name is also supported; `SMTP_USER` takes precedence.
An unauthenticated relay can omit both user and password with an explicit sender.
Partial credentials or invalid SMTP configuration fail at startup.
Keep credentials in the deployment environment rather than source control.
SMTP uses certificate-verified STARTTLS on port 587 (and custom non-465 ports),
or implicit TLS on port 465, before authentication, and a 10-second
socket timeout. Delivery failures produce a generic warning without exception
contents, recipient, link, token, or credentials; public responses remain 202
with the same body for known and unknown accounts. Failed delivery does not
persist the newly issued token.

Set `PASSWORD_RESET_URL` to the public frontend page, for example
`https://interviews.example.com/reset-password`. Existing query parameters are
preserved, any old token parameter is replaced, and the random token is URL
encoded. Use the public application origin. Absolute HTTP(S) URLs are accepted;
credentials and fragments are rejected. When unset, the local testing default
is `http://localhost:8080/reset-password`. Restart the backend after changing
environment configuration.

When `SMTP_HOST` is absent, auto mode logs `Local password reset link: ...` to
the backend console for local testing. The link can be opened to finish the
reset flow. `EMAIL_ADAPTER=local` explicitly selects this same console adapter,
even if a host is set; `EMAIL_ADAPTER=smtp` explicitly requires SMTP settings.
The console adapter also preserves the development in-memory outbox at
`app.state.mailer.messages` without exposing it through HTTP. Tests can inject
`LocalMailbox` to capture messages without logging. A configured SMTP delivery
failure does not fall back to logging reset tokens.

The reset endpoint invokes the selected adapter before returning the neutral
202 response. The frontend shows “Reset request received” after acceptance,
with inbox/spam guidance, without disclosing whether the account exists.

Run `cd backend && uv run pytest tests/test_email_delivery.py tests/test_password_reset.py`.
The fake SMTP capture service records the serialized MIME message and verifies
recipient, sender, subject, decoded link, TLS, authentication, and bounded
failure behavior without sending email. Captured tokens are exercised through
the actual confirmation endpoint to check single use; recovery tests check
expiry and session revocation. This is an in-process fake SMTP service rather
than a separately deployed capture server.
