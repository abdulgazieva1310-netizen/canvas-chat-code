"""Recovery delivery adapters. The local mailbox is never exposed through HTTP."""
import os
import smtplib
import ssl
from email.message import EmailMessage


class LocalMailbox:
    def __init__(self):
        self.messages = []

    def send_reset(self, email, link):
        self.messages.append({'to': email, 'link': link})


class SMTPDelivery:
    def send_reset(self, email, link):
        message = EmailMessage()
        message['From'] = os.environ['SMTP_FROM']
        message['To'] = email
        message['Subject'] = 'Reset your Interview Mirror password'
        message.set_content(f'Use this link within 30 minutes to reset your password:\n{link}\n'
                            'If you did not request this, you can ignore this message.')
        with smtplib.SMTP(os.environ['SMTP_HOST'], int(os.getenv('SMTP_PORT', '587')), timeout=10) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            if os.getenv('SMTP_USERNAME'):
                smtp.login(os.environ['SMTP_USERNAME'], os.environ['SMTP_PASSWORD'])
            smtp.send_message(message)


def email_delivery():
    adapter = os.getenv('EMAIL_ADAPTER', 'local')
    if adapter == 'local':
        return LocalMailbox()
    if adapter == 'smtp':
        return SMTPDelivery()
    raise ValueError('EMAIL_ADAPTER must be local or smtp')
