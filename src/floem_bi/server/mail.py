"""floembi.app e-posta gönderimi.

SMTP ayarı verilirse (FLOEM_SMTP_HOST …) e-posta gerçekten gönderilir: şirket SMTP'si ya da
geliştirmede Mailpit. Ayar yoksa e-postalar sunucunun giden kutusuna (.eml) yazılır ve web'deki
"Gelen e-postalar (geliştirme)" sayfasından okunur; sahte @floembi.test adresleriyle test böyle yapılır.
SMTP şifresi yalnızca ortam değişkeninden okunur, hiçbir yere yazılmaz.
"""

from __future__ import annotations

import os
import smtplib
import ssl
import uuid
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from html import escape
from pathlib import Path


@dataclass
class SmtpSettings:
    host: str
    port: int = 587
    user: str | None = None
    password: str | None = None
    security: str = "starttls"            # starttls | ssl | none
    timeout: float = 15.0


@dataclass
class MailSettings:
    sender: str = "floembi.app <no-reply@floembi.app>"
    smtp: SmtpSettings | None = None      # None: giden kutusu (geliştirme)

    @property
    def mode(self) -> str:
        return "smtp" if self.smtp else "outbox"


def load_mail_settings() -> MailSettings:
    host = os.environ.get("FLOEM_SMTP_HOST", "").strip()
    sender = os.environ.get("FLOEM_SMTP_FROM", "").strip() or "floembi.app <no-reply@floembi.app>"
    if not host:
        return MailSettings(sender=sender)
    security = os.environ.get("FLOEM_SMTP_SECURITY", "starttls").strip().lower()
    port = int(os.environ.get("FLOEM_SMTP_PORT", "465" if security == "ssl" else "587"))
    return MailSettings(sender=sender, smtp=SmtpSettings(
        host=host, port=port, security=security,
        user=os.environ.get("FLOEM_SMTP_USER") or None, password=os.environ.get("FLOEM_SMTP_PASSWORD") or None,
    ))


class MailError(Exception):
    def __init__(self, message: str, detail: str = ""):
        self.message, self.detail = message, detail
        super().__init__(message)


@dataclass
class Mail:
    to: str
    subject: str
    text: str
    html: str


def build_message(sender: str, mail: Mail) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = mail.to
    msg["Subject"] = mail.subject
    msg["Message-ID"] = make_msgid(domain="floembi.app")
    msg.set_content(mail.text)
    msg.add_alternative(mail.html, subtype="html")
    return msg


def send(settings: MailSettings, mail: Mail, outbox: Path) -> tuple[str, str | None]:
    """E-postayı gönderir. Dönüş: (durum, giden kutusu dosyası). Durum: sent | outbox."""
    msg = build_message(settings.sender, mail)
    if settings.smtp is None:
        outbox.mkdir(parents=True, exist_ok=True)
        path = outbox / f"{uuid.uuid4().hex}.eml"
        path.write_bytes(bytes(msg))
        return "outbox", str(path)
    s = settings.smtp
    try:
        if s.security == "ssl":
            client = smtplib.SMTP_SSL(s.host, s.port, timeout=s.timeout, context=ssl.create_default_context())
        else:
            client = smtplib.SMTP(s.host, s.port, timeout=s.timeout)
        with client:
            if s.security == "starttls":
                client.starttls(context=ssl.create_default_context())
            if s.user:
                client.login(s.user, s.password or "")
            client.send_message(msg)
    except smtplib.SMTPAuthenticationError as e:
        raise MailError("E-posta sunucusu kullanıcı adı/şifreyi kabul etmedi", str(e)) from e
    except smtplib.SMTPRecipientsRefused as e:
        raise MailError(f"E-posta sunucusu alıcıyı reddetti: {mail.to}", str(e)) from e
    except (OSError, smtplib.SMTPException) as e:
        raise MailError(f"E-posta sunucusuna ulaşılamadı ({s.host}:{s.port})", str(e)) from e
    return "sent", None


# ------------------------------------------------------------------ şablonlar
def share_mail(*, to: str, sender_name: str, report_name: str, workspace: str, url: str, message: str | None) -> Mail:
    subject = f"{sender_name} sizinle '{report_name}' raporunu paylaştı"
    note = (message or "").strip()
    text = (
        f"{sender_name} sizinle floembi.app'te '{report_name}' raporunu paylaştı ({workspace}).\n\n"
        + (f"Mesaj:\n{note}\n\n" if note else "")
        + f"Raporu açın: {url}\n\n"
        "Bu e-postayı floembi.app gönderdi. Rapora erişmek için floembi.app hesabınızla oturum açmanız gerekir."
    )
    quote = (
        f'<blockquote style="margin:16px 0;padding:10px 14px;border-left:3px solid #f2c811;background:#faf9f8;'
        f'white-space:pre-wrap">{escape(note)}</blockquote>' if note else ""
    )
    html = f"""<!doctype html><html lang="tr"><body style="margin:0;background:#f3f2f1;font-family:Segoe UI,Arial,sans-serif;color:#201f1e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px">
<tr><td style="padding:18px 24px;border-bottom:1px solid #edebe9;font-weight:700">floembi.app</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 8px;font-size:16px"><strong>{escape(sender_name)}</strong> sizinle bir rapor paylaştı</p>
<p style="margin:0;font-size:20px;font-weight:600">{escape(report_name)}</p>
<p style="margin:4px 0 0;color:#605e5c">Çalışma alanı: {escape(workspace)}</p>
{quote}
<p style="margin:20px 0"><a href="{escape(url)}" style="display:inline-block;background:#1f6feb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">Raporu aç</a></p>
<p style="margin:0;color:#605e5c;font-size:12px">Düğme çalışmazsa bu adresi tarayıcınıza yapıştırın:<br>{escape(url)}</p>
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #edebe9;color:#605e5c;font-size:12px">Rapora erişmek için floembi.app hesabınızla oturum açmanız gerekir.</td></tr>
</table></td></tr></table></body></html>"""
    return Mail(to=to, subject=subject, text=text, html=html)


def sender_display(name: str, settings: MailSettings) -> str:
    """Gönderen adı paylaşan kişinin adıyla, adres floembi.app'in adresiyle (Power BI'daki gibi)."""
    addr = settings.sender.split("<")[-1].rstrip(">").strip() if "<" in settings.sender else settings.sender
    return formataddr((f"{name} (floembi.app)", addr))
