"""floembi.app e-posta gönderimi.

E-posta sunucusu iki yerden tanımlanır (öncelik sırasıyla):
  1. Web'deki Yönetim → E-posta sunucusu ekranı (metadata DB'de; şifre şifreli saklanır)
  2. Ortam değişkenleri (FLOEM_SMTP_HOST …)
İkisi de yoksa e-postalar sunucunun giden kutusuna (.eml) yazılır ve web'deki
"Gelen e-postalar" sayfasından okunur; sahte @floembi.test adresleriyle test böyle yapılır.
Gönderim standart kütüphanedeki smtplib ile; şifre saklama cryptography (Fernet) ile.
"""

from __future__ import annotations

import base64
import os
import smtplib
import socket
import ssl
import uuid
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from html import escape
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


@dataclass
class SmtpSettings:
    host: str
    port: int = 587
    user: str | None = None
    password: str | None = None
    security: str = "starttls"            # starttls | ssl | none
    timeout: float = 15.0


SECURITY = ("starttls", "ssl", "none")


@dataclass
class MailSettings:
    sender: str = "floembi.app <no-reply@floembi.app>"
    smtp: SmtpSettings | None = None      # None: giden kutusu (geliştirme)
    source: str = "env"                   # screen | env (smtp None ise giden kutusu)

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


# ------------------------------------------------------------------ ayarın saklanması
class SecretBox:
    """SMTP şifresini metadata DB'de şifreli tutar. Anahtar sunucu gizli anahtarından (FLOEM_SERVER_SECRET)
    HKDF ile türetilir; gizli anahtar değişirse kayıtlı şifre çözülemez ve ekrandan yeniden girilir."""

    def __init__(self, server_secret: str):
        key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=b"floem-mail-config").derive(
            server_secret.encode("utf-8"))
        self._f = Fernet(base64.urlsafe_b64encode(key))

    def seal(self, plain: str) -> str:
        return self._f.encrypt(plain.encode("utf-8")).decode("ascii")

    def open(self, sealed: str) -> str:
        try:
            return self._f.decrypt(sealed.encode("ascii")).decode("utf-8")
        except (InvalidToken, ValueError) as e:
            raise MailError("Kayıtlı SMTP şifresi çözülemedi; Yönetim → E-posta sunucusu ekranında şifreyi yeniden girin",
                            "Sunucu gizli anahtarı (FLOEM_SERVER_SECRET) değişmiş olabilir") from e


def settings_from_row(row, box: SecretBox) -> MailSettings:
    """Yönetim ekranında kaydedilen ayar (mail_config satırı) → gönderim ayarı."""
    sender = formataddr((row.from_name or "floembi.app", row.from_address))
    password = box.open(row.password_enc) if row.password_enc else None
    return MailSettings(sender=sender, source="screen", smtp=SmtpSettings(
        host=row.host, port=row.port, security=row.security, user=row.username or None, password=password,
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


def _open(s: SmtpSettings):
    """SMTP bağlantısını açar. Sunucu adı birden çok adrese çözülüyorsa sırayla dener: bazı sağlayıcılarda
    (ör. Titan) adreslerden biri bağlantıyı kabul edip hiç karşılama göndermeyebilir; tek adrese takılmayız.
    Sertifika doğrulaması ve STARTTLS her zaman sunucu adıyla yapılır."""
    base = smtplib.SMTP_SSL if s.security == "ssl" else smtplib.SMTP
    kw = {"context": ssl.create_default_context()} if s.security == "ssl" else {}
    if not hasattr(base, "_get_socket"):           # test sahteleri
        return base(s.host, s.port, timeout=s.timeout, **kw)
    ips = list(dict.fromkeys(a[4][0] for a in socket.getaddrinfo(s.host, s.port, type=socket.SOCK_STREAM)))

    class Pinned(base):  # type: ignore[misc, valid-type]
        def _get_socket(self, host, port, timeout):
            return super()._get_socket(self.floem_ip, port, timeout)

    per_ip = min(s.timeout, 10.0) if len(ips) > 1 else s.timeout
    last: Exception | None = None
    for ip in ips:
        client = Pinned(timeout=per_ip, **kw)
        client._host = s.host                     # SNI, sertifika ve STARTTLS için sunucu adı
        client.floem_ip = ip
        try:
            client.connect(s.host, s.port)
            client.timeout = s.timeout
            if client.sock is not None:
                client.sock.settimeout(s.timeout)
            return client
        except (smtplib.SMTPServerDisconnected, OSError) as e:
            last = e
            client.close()
    assert last is not None
    raise last


def send(settings: MailSettings, mail: Mail, outbox: Path) -> tuple[str, str | None]:
    """E-postayı gönderir. Dönüş: (durum, giden kutusu dosyası). Durum: sent | outbox."""
    msg = build_message(settings.sender, mail)
    if settings.smtp is None:
        outbox.mkdir(parents=True, exist_ok=True)
        path = outbox / f"{uuid.uuid4().hex}.eml"
        path.write_bytes(bytes(msg))
        return "outbox", str(path)
    s = settings.smtp
    where = f"{s.host}:{s.port}"
    step = "connect"                          # connect | tls | login | send: hata mesajı adıma göre
    try:
        client = _open(s)
        with client:
            if s.security == "starttls":
                step = "tls"
                client.starttls(context=ssl.create_default_context())
            if s.user:
                step = "login"
                client.login(s.user, s.password or "")
            step = "send"
            client.send_message(msg)
    except smtplib.SMTPAuthenticationError as e:
        raise MailError(LOGIN_REFUSED, str(e)) from e
    except smtplib.SMTPNotSupportedError as e:
        raise MailError("E-posta sunucusu bu güvenlik türünde girişe izin vermiyor; Güvenlik olarak STARTTLS "
                        "ya da SSL/TLS seçin", str(e)) from e
    except smtplib.SMTPRecipientsRefused as e:
        raise MailError(f"E-posta sunucusu alıcıyı reddetti: {mail.to}", str(e)) from e
    except smtplib.SMTPSenderRefused as e:
        raise MailError("E-posta sunucusu gönderen adresini reddetti; gönderen adresi çoğu sunucuda kullanıcı "
                        "adıyla aynı olmalı", str(e)) from e
    except smtplib.SMTPServerDisconnected as e:
        if step == "login":                   # Gmail yanlış kimlik bilgisinde bağlantıyı açıklamasız keser
            raise MailError(LOGIN_REFUSED, str(e)) from e
        if step == "connect" and s.security == "starttls" and s.port == 465:
            raise MailError(f"Port 465 SSL/TLS ister; Güvenlik olarak SSL/TLS seçin ya da port 587 kullanın ({where})",
                            str(e)) from e
        raise MailError(f"E-posta sunucusu bağlantıyı kapattı ({where})", str(e)) from e
    except ssl.SSLError as e:
        raise MailError(f"Şifreli bağlantı kurulamadı ({where}); port ile güvenlik türü uyuşmuyor olabilir "
                        "(587 → STARTTLS, 465 → SSL/TLS)", str(e)) from e
    except ConnectionRefusedError as e:
        raise MailError(f"Bu adreste çalışan bir e-posta sunucusu yok ({where}); sunucu açık mı, port doğru mu?",
                        str(e)) from e
    except (TimeoutError, socket.timeout) as e:
        raise MailError(f"E-posta sunucusu yanıt vermedi ({where}); güvenlik duvarı bu portu engelliyor olabilir",
                        str(e)) from e
    except socket.gaierror as e:
        raise MailError(f"Sunucu adı bulunamadı: {s.host}", str(e)) from e
    except (OSError, smtplib.SMTPException) as e:
        raise MailError(f"E-posta sunucusuna ulaşılamadı ({where})", str(e)) from e
    return "sent", None


LOGIN_REFUSED = ("E-posta sunucusu girişi reddetti: kullanıcı adı tam e-posta adresi mi, şifre doğru mu? "
                 "Gmail ve Microsoft 365'te hesap şifresi değil uygulama şifresi gerekir")


def login_hint(host: str, username: str | None) -> str | None:
    """Bilinen sağlayıcılarda sık yapılan hata: kullanıcı adı tam adres değil."""
    known = ("smtp.gmail.com", "smtp.office365.com", "smtp-mail.outlook.com", "smtp.yandex.com", "smtp.titan.email")
    if host.strip().lower() in known and username and "@" not in username:
        return f"{host.strip()} için kullanıcı adı tam e-posta adresi olmalı (ör. ad@sirket.com)"
    return None


# ------------------------------------------------------------------ şablonlar
def _layout(*, intro: str, title: str, subtitle: str, quote: str | None, button: str, url: str, footer: str) -> str:
    """Tüm floembi.app e-postalarının ortak HTML çerçevesi (metinler çağıran tarafta kaçışlanmış olmalı)."""
    q = (
        f'<blockquote style="margin:16px 0;padding:10px 14px;border-left:3px solid #f2c811;background:#faf9f8;'
        f'white-space:pre-wrap">{quote}</blockquote>' if quote else ""
    )
    sub = f'<p style="margin:4px 0 0;color:#605e5c">{subtitle}</p>' if subtitle else ""
    return f"""<!doctype html><html lang="tr"><body style="margin:0;background:#f3f2f1;font-family:Segoe UI,Arial,sans-serif;color:#201f1e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px">
<tr><td style="padding:18px 24px;border-bottom:1px solid #edebe9;font-weight:700">floembi.app</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 8px;font-size:16px">{intro}</p>
<p style="margin:0;font-size:20px;font-weight:600">{title}</p>
{sub}
{q}
<p style="margin:20px 0"><a href="{escape(url)}" style="display:inline-block;background:#1f6feb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">{button}</a></p>
<p style="margin:0;color:#605e5c;font-size:12px">Düğme çalışmazsa bu adresi tarayıcınıza yapıştırın:<br>{escape(url)}</p>
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #edebe9;color:#605e5c;font-size:12px">{footer}</td></tr>
</table></td></tr></table></body></html>"""


def share_mail(*, to: str, sender_name: str, report_name: str, workspace: str, url: str, message: str | None) -> Mail:
    subject = f"{sender_name} sizinle '{report_name}' raporunu paylaştı"
    note = (message or "").strip()
    text = (
        f"{sender_name} sizinle floembi.app'te '{report_name}' raporunu paylaştı ({workspace}).\n\n"
        + (f"Mesaj:\n{note}\n\n" if note else "")
        + f"Raporu açın: {url}\n\n"
        "Bu e-postayı floembi.app gönderdi. Rapora erişmek için floembi.app hesabınızla oturum açmanız gerekir."
    )
    html = _layout(
        intro=f"<strong>{escape(sender_name)}</strong> sizinle bir rapor paylaştı", title=escape(report_name),
        subtitle=f"Çalışma alanı: {escape(workspace)}", quote=escape(note) if note else None,
        button="Raporu aç", url=url, footer="Rapora erişmek için floembi.app hesabınızla oturum açmanız gerekir.",
    )
    return Mail(to=to, subject=subject, text=text, html=html)


def app_mail(*, to: str, sender_name: str, app_name: str, description: str | None, url: str,
             message: str | None) -> Mail:
    """App'e erişim verildi (Power BI: uygulama yüklendi bildirimi)."""
    subject = f"{sender_name} size '{app_name}' uygulamasını açtı"
    note = (message or "").strip()
    text = (
        f"{sender_name} size floembi.app'te '{app_name}' uygulamasına erişim verdi.\n\n"
        + (f"{description.strip()}\n\n" if (description or "").strip() else "")
        + (f"Mesaj:\n{note}\n\n" if note else "")
        + f"Uygulamayı açın: {url}\n\n"
        "Bu e-postayı floembi.app gönderdi. Uygulamaya erişmek için floembi.app hesabınızla oturum açmanız gerekir."
    )
    html = _layout(
        intro=f"<strong>{escape(sender_name)}</strong> size bir uygulama açtı", title=escape(app_name),
        subtitle=escape(description.strip()) if (description or "").strip() else "floembi.app uygulaması",
        quote=escape(note) if note else None, button="Uygulamayı aç", url=url,
        footer="Uygulamaya erişmek için floembi.app hesabınızla oturum açmanız gerekir.",
    )
    return Mail(to=to, subject=subject, text=text, html=html)


def invite_mail(*, to: str, inviter: str, grants: list[str], url: str, days: int, message: str | None = None) -> Mail:
    """Hesabı olmayan adrese davet: bağlantıdan ad ve şifre belirleyip hesabını açar."""
    subject = f"{inviter} sizi floembi.app'e davet etti"
    note = (message or "").strip()
    lines = "\n".join(f"  - {g}" for g in grants)
    text = (
        f"{inviter} sizi floembi.app'e davet etti. Size verilen erişim:\n{lines}\n\n"
        + (f"Mesaj:\n{note}\n\n" if note else "")
        + f"Hesabınızı oluşturmak için: {url}\n\n"
        f"Bağlantı {days} gün geçerlidir ve yalnızca bir kez kullanılabilir. Daveti beklemiyorsanız bu e-postayı yok sayın."
    )
    html = _layout(
        intro=f"<strong>{escape(inviter)}</strong> sizi floembi.app'e davet etti",
        title="Hesabınızı oluşturun",
        subtitle="Size verilen erişim:<br>" + "<br>".join(f"• {escape(g)}" for g in grants),
        quote=escape(note) if note else None, button="Daveti kabul et", url=url,
        footer=f"Bağlantı {days} gün geçerlidir ve yalnızca bir kez kullanılabilir. "
               "Daveti beklemiyorsanız bu e-postayı yok sayın.",
    )
    return Mail(to=to, subject=subject, text=text, html=html)


def access_mail(*, to: str, granter: str, workspace: str, role_label: str, url: str) -> Mail:
    """Mevcut kullanıcıya çalışma alanı yetkisi verildi."""
    subject = f"{granter} size '{workspace}' çalışma alanında erişim verdi"
    text = (
        f"{granter} size floembi.app'te '{workspace}' çalışma alanında {role_label} rolü verdi.\n\n"
        f"Çalışma alanını açın: {url}\n"
    )
    html = _layout(
        intro=f"<strong>{escape(granter)}</strong> size bir çalışma alanında erişim verdi", title=escape(workspace),
        subtitle=f"Rolünüz: {escape(role_label)}", quote=None, button="Çalışma alanını aç", url=url,
        footer="Erişmek için floembi.app hesabınızla oturum açmanız gerekir.",
    )
    return Mail(to=to, subject=subject, text=text, html=html)


def test_mail(*, to: str, by: str, url: str, server: str) -> Mail:
    subject = "floembi.app test e-postası"
    text = f"Bu e-posta floembi.app e-posta sunucusu ayarını denemek için {by} tarafından gönderildi ({server}).\n{url}\n"
    html = _layout(
        intro="E-posta sunucusu ayarı çalışıyor", title="Test e-postası",
        subtitle=f"Gönderen: {escape(by)} · Sunucu: {escape(server)}", quote=None, button="floembi.app'i aç", url=url,
        footer="Bu e-posta Yönetim → E-posta sunucusu ekranından gönderildi.",
    )
    return Mail(to=to, subject=subject, text=text, html=html)


def sender_display(name: str, settings: MailSettings) -> str:
    """Gönderen adı paylaşan kişinin adıyla, adres floembi.app'in adresiyle (Power BI'daki gibi)."""
    addr = settings.sender.split("<")[-1].rstrip(">").strip() if "<" in settings.sender else settings.sender
    return formataddr((f"{name} (floembi.app)", addr))
