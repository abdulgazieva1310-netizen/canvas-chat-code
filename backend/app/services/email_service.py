"""SMTP recovery delivery, with console links for local development."""
import os
import smtplib
import ssl
from email.message import EmailMessage
from urllib.parse import urlsplit


class LocalMailbox:
    def __init__(self):
        self.messages = []

    def send_reset(self, email, link):
        self.messages.append({'to': email, 'link': link})


class ConsoleDelivery(LocalMailbox):
    def send_reset(self, email, link):
        super().send_reset(email, link)
        print(f'Local password reset link: {link}', flush=True)


class SMTPDelivery:
    def __init__(self):
        self.host = os.getenv('SMTP_HOST', '').strip()
        self.port = int(os.getenv('SMTP_PORT', '587'))
        self.user = os.getenv('SMTP_USER') or os.getenv('SMTP_USERNAME', '')
        self.password = os.getenv('SMTP_PASSWORD', '')
        self.sender = os.getenv('SMTP_FROM') or self.user
        if not self.host or not self.sender:
            raise ValueError('SMTP_HOST and SMTP_FROM (or SMTP_USER) are required for SMTP delivery')
        if not 1 <= self.port <= 65535:
            raise ValueError('SMTP_PORT must be between 1 and 65535')
        if bool(self.user) != bool(self.password):
            raise ValueError('Configure both SMTP_USER and SMTP_PASSWORD for SMTP authentication')

    def send_reset(self, email, link):
        message = EmailMessage()
        message['From'] = self.sender
        message['To'] = email
        message['Subject'] = 'Reset your Interview Mirror password'
        message.set_content(f'Use this link within 30 minutes to reset your password:\n{link}\n'
                            'If you did not request this, you can ignore this message.')
        context = ssl.create_default_context()
        connection = (smtplib.SMTP_SSL(self.host, self.port, timeout=10, context=context)
                      if self.port == 465 else smtplib.SMTP(self.host, self.port, timeout=10))
        with connection as smtp:
            if self.port != 465:
                smtp.starttls(context=context)
            if self.user:
                smtp.login(self.user, self.password)
            smtp.send_message(message)


def email_delivery():
    adapter = os.getenv('EMAIL_ADAPTER', 'auto').strip().lower()
    if adapter == 'auto':
        return SMTPDelivery() if os.getenv('SMTP_HOST', '').strip() else ConsoleDelivery()
    if adapter == 'local':
        return ConsoleDelivery()
    if adapter == 'smtp':
        return SMTPDelivery()
    raise ValueError('EMAIL_ADAPTER must be auto, local or smtp')


def password_reset_url():
    value = os.getenv('PASSWORD_RESET_URL')
    value = value or 'http://localhost:8080/reset-password'
    parsed = urlsplit(value)
    if parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError('PASSWORD_RESET_URL must be an absolute HTTP(S) URL without credentials or fragment')
    return value
