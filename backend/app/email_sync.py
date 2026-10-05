"""Dong bo hoa don PDF/XML tu email (Zoho Mail IMAP) vao he thong KSP."""
from __future__ import annotations

import email
import email.header
import fcntl
import hashlib
import imaplib
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import crypto, inv_import, inventory, storage
from .config import Settings
from .db import AppSetting, InvPurchase, JobRun


class EmailSyncError(RuntimeError):
    pass


class EmailAuthError(EmailSyncError):
    pass


class EmailConnectionError(EmailSyncError):
    pass


class EmailSyncBusy(EmailSyncError):
    pass


@contextmanager
def sync_lock(data_path: Path):
    lock_path = data_path / "email-sync.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+") as fh:
        try:
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as e:
            raise EmailSyncBusy("Một phiên đồng bộ email đang chạy") from e
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def decode_mime_str(val: str | None) -> str:
    """Giai ma chuoi MIME RFC 2047 an toan."""
    if not val:
        return ""
    try:
        decoded_chunks = email.header.decode_header(val)
        parts = []
        for text, encoding in decoded_chunks:
            if isinstance(text, bytes):
                encoding = encoding or "utf-8"
                try:
                    parts.append(text.decode(encoding, errors="replace"))
                except (LookupError, UnicodeDecodeError):
                    parts.append(text.decode("utf-8", errors="replace"))
            else:
                parts.append(str(text))
        return "".join(parts).strip()
    except Exception:
        return str(val).strip()


def _supplement_from_filename(parsed: dict | None, filename: str) -> dict:
    """Bo sung thong tin MST, Ky hieu, So HD tu ten file neu parse PDF thieu."""
    if parsed is None:
        parsed = {}
    fn = Path(filename).stem

    # 1. Pattern MST _ KY_HIEU _ SO_HD: 0102182292_1K26TPB_1205
    m1 = re.search(r"(\d{10,14})[_-]+([12]?[A-Z]\d{2}[A-Z]{2,4})[_-]+(\d+)", fn, re.IGNORECASE)
    if m1:
        if not parsed.get("mst_ban"):
            parsed["mst_ban"] = m1.group(1)
        if not parsed.get("ky_hieu"):
            parsed["ky_hieu"] = m1.group(2).upper()
        if not parsed.get("so_hd"):
            parsed["so_hd"] = m1.group(3)

    # 2. Pattern ihoadon.vn_MST_SOHD_DATE: ihoadon.vn_0319148473_143_07082026
    m2 = re.search(r"(\d{10,14})[_-]+(\d+)[_-]+(\d{6,8})", fn)
    if m2:
        if not parsed.get("mst_ban"):
            parsed["mst_ban"] = m2.group(1)
        if not parsed.get("so_hd"):
            parsed["so_hd"] = m2.group(2)

    # 3. Pattern KY_HIEU _ SO_HD: 1C26TNS_00000384 or 1C25MVH_00010748
    m3 = re.search(r"([12]?[A-Z]\d{2}[A-Z]{2,4})[_-]+(\d+)", fn, re.IGNORECASE)
    if m3:
        if not parsed.get("ky_hieu"):
            parsed["ky_hieu"] = m3.group(1).upper()
        if not parsed.get("so_hd"):
            parsed["so_hd"] = m3.group(2)

    # 4. Pattern KY_HIEU SO_HD: C26MSL572 or C25TDK3447
    m4 = re.search(r"([12]?[A-Z]\d{2}[A-Z]{2,4})(\d{3,8})", fn, re.IGNORECASE)
    if m4:
        if not parsed.get("ky_hieu"):
            parsed["ky_hieu"] = m4.group(1).upper()
        if not parsed.get("so_hd"):
            parsed["so_hd"] = m4.group(2)

    # 5. Pattern SO_HD _ KY_HIEU: 343556_C26MCV_31012026
    m5 = re.search(r"^(\d+)[_-]+([12]?[A-Z]\d{2}[A-Z]{2,4})", fn, re.IGNORECASE)
    if m5:
        if not parsed.get("so_hd"):
            parsed["so_hd"] = m5.group(1)
        if not parsed.get("ky_hieu"):
            parsed["ky_hieu"] = m5.group(2).upper()

    return parsed


def get_zoho_settings(db: Session, settings: Settings) -> dict[str, Any]:
    """Lay cau hinh Zoho REST API / IMAP tu AppSetting (neu co) hoac fallback sang .env."""
    def _val(k: str, default: Any, is_secret: bool = False) -> Any:
        row = db.get(AppSetting, k)
        val = row.value if row is not None and row.value != "" else default
        if is_secret and val:
            dec = crypto.decrypt(str(val))
            return dec if dec else val
        return val

    enabled_str = _val("zoho_imap_enabled", str(settings.zoho_imap_enabled).lower())
    enabled = enabled_str in {"true", "1", "yes"}

    mode = str(_val("zoho_sync_mode", settings.zoho_sync_mode or "rest_api"))
    client_id_val = str(_val("zoho_client_id", getattr(settings, "zoho_client_id", "")))
    user_val = str(_val("zoho_imap_username", settings.zoho_imap_username))
    pass_val = str(_val("zoho_imap_password", settings.zoho_imap_password, is_secret=True))

    if mode == "rest_api" and not client_id_val and user_val and pass_val:
        mode = "imap"

    port_val = _val("zoho_imap_port", settings.zoho_imap_port)
    try:
        port = int(port_val)
    except (ValueError, TypeError):
        port = 993

    days_val = _val("zoho_imap_days", settings.zoho_imap_days)
    try:
        days = int(days_val)
    except (ValueError, TypeError):
        days = 30

    return {
        "enabled": enabled,
        "mode": mode,
        # Zoho REST API OAuth 2.0
        "client_id": str(_val("zoho_client_id", getattr(settings, "zoho_client_id", ""))),
        "client_secret": str(_val("zoho_client_secret", getattr(settings, "zoho_client_secret", ""), is_secret=True)),
        "refresh_token": str(_val("zoho_refresh_token", getattr(settings, "zoho_refresh_token", ""), is_secret=True)),
        "accounts_url": str(_val("zoho_accounts_url", getattr(settings, "zoho_accounts_url", "https://accounts.zoho.com"))),
        "mail_api_url": str(_val("zoho_mail_api_url", getattr(settings, "zoho_mail_api_url", "https://mail.zoho.com"))),
        # IMAP
        "server": str(_val("zoho_imap_server", settings.zoho_imap_server)),
        "port": port,
        "username": str(_val("zoho_imap_username", settings.zoho_imap_username)),
        "password": str(_val("zoho_imap_password", settings.zoho_imap_password, is_secret=True)),
        "mailbox": str(_val("zoho_imap_mailbox", settings.zoho_imap_mailbox)),
        "days": days,
    }


def save_zoho_settings(db: Session, config: dict[str, Any]) -> None:
    """Luu cau hinh Zoho vao bang AppSetting (tu dong ma hoa Fernet cho client_secret, refresh_token, password)."""
    for key, val in config.items():
        # Chu y: mode, client_id, etc. luu theo prefix zoho_ hoac zoho_imap_
        if key in {"mode", "client_id", "client_secret", "refresh_token", "accounts_url", "mail_api_url"}:
            db_key = f"zoho_{key}" if not key.startswith("zoho_") else key
            if key == "mode":
                db_key = "zoho_sync_mode"
        else:
            db_key = f"zoho_imap_{key}" if not key.startswith("zoho_imap_") else key

        val_to_save = str(val) if val is not None else ""
        if val_to_save and key in {"client_secret", "refresh_token", "password"}:
            val_to_save = crypto.encrypt(val_to_save)

        row = db.get(AppSetting, db_key)
        if row is None:
            row = AppSetting(key=db_key, value=val_to_save)
            db.add(row)
        else:
            row.value = val_to_save
            row.updated_at = datetime.now(timezone.utc)
    db.commit()


# ---------------------------------------------------------------------------
# Zoho Mail REST API (OAuth 2.0)
# ---------------------------------------------------------------------------
def exchange_grant_token(
    client_id: str,
    client_secret: str,
    grant_token: str,
    accounts_url: str = "https://accounts.zoho.com",
    timeout: float = 15.0,
) -> dict[str, Any]:
    """Doi Grant token (code) lay Refresh token va Access token qua OAuth 2.0."""
    if not client_id or not client_secret or not grant_token:
        raise EmailAuthError("Cần Client ID, Client Secret và Mã code (Grant Token)")

    url = f"{accounts_url.rstrip('/')}/oauth/v2/token"
    data = urllib.parse.urlencode({
        "code": grant_token,
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "authorization_code",
    }).encode("utf-8")

    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        err_msg = exc.read().decode("utf-8", errors="replace")
        raise EmailAuthError(f"Lỗi xác thực OAuth từ Zoho: {exc.code} {err_msg}") from exc
    except Exception as exc:
        raise EmailConnectionError(f"Không thể kết nối đến Zoho Accounts: {exc}") from exc

    if "error" in body:
        raise EmailAuthError(f"Zoho từ chối cấp token: {body.get('error')}")

    return body


def get_access_token_from_refresh(
    client_id: str,
    client_secret: str,
    refresh_token: str,
    accounts_url: str = "https://accounts.zoho.com",
    timeout: float = 15.0,
) -> str:
    """Su dung Refresh token de lay Access token moi nhat."""
    if not client_id or not client_secret or not refresh_token:
        raise EmailAuthError("Cần Client ID, Client Secret và Refresh Token để lấy access token")

    url = f"{accounts_url.rstrip('/')}/oauth/v2/token"
    data = urllib.parse.urlencode({
        "refresh_token": refresh_token,
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "refresh_token",
    }).encode("utf-8")

    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        err_msg = exc.read().decode("utf-8", errors="replace")
        raise EmailAuthError(f"Lỗi làm mới Access token Zoho: {exc.code} {err_msg}") from exc
    except Exception as exc:
        raise EmailConnectionError(f"Không thể kết nối đến Zoho Accounts: {exc}") from exc

    if "error" in body:
        raise EmailAuthError(f"Zoho từ chối làm mới token: {body.get('error')}")

    access_token = body.get("access_token")
    if not access_token:
        raise EmailAuthError("Zoho không trả về access_token")
    return access_token


def download_meinvoice_pdf(code: str, timeout: float = 20.0) -> bytes | None:
    """Tai truc tiep file PDF goc tu MISA meInvoice bang ma tra cuu (sc/Code)."""
    code = code.strip()
    if not code:
        return None
    url = f"https://www.meinvoice.vn/tra-cuu/DownloadHandler.ashx?Type=pdf&Code={code}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": "https://www.meinvoice.vn/tra-cuu/",
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            content = resp.read()
            if content.startswith(b"%PDF"):
                return content
    except Exception:
        return None
    return None

def fetch_rest_api_attachments(
    client_id: str,
    client_secret: str,
    refresh_token: str,
    accounts_url: str = "https://accounts.zoho.com",
    mail_api_url: str = "https://mail.zoho.com",
    days: int = 30,
    timeout: float = 25.0,
) -> list[dict[str, Any]]:
    """Quet va tai file dinh kem tu Zoho Mail REST API OAuth 2.0 (ho tro phan trang)."""
    access_token = get_access_token_from_refresh(
        client_id=client_id,
        client_secret=client_secret,
        refresh_token=refresh_token,
        accounts_url=accounts_url,
        timeout=timeout,
    )

    # 1. Lay accountId
    acc_url = f"{mail_api_url.rstrip('/')}/api/accounts"
    acc_req = urllib.request.Request(acc_url)
    acc_req.add_header("Authorization", f"Zoho-oauthtoken {access_token}")

    try:
        with urllib.request.urlopen(acc_req, timeout=timeout) as resp:
            acc_data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        raise EmailConnectionError(f"Lỗi lấy thông tin tài khoản Zoho Mail: {exc}") from exc

    accounts = acc_data.get("data", [])
    if not accounts:
        raise EmailAuthError("Không tìm thấy tài khoản Zoho Mail nào với token này")
    account_id = str(accounts[0].get("accountId"))

    # 2. Lay danh sach tin nhan (Messages) ho tro phan trang
    cutoff_ts_ms = 0.0
    if days > 0:
        cutoff_dt = datetime.now(timezone.utc) - timedelta(days=days)
        cutoff_ts_ms = cutoff_dt.timestamp() * 1000

    attachments: list[dict[str, Any]] = []
    seen_att_keys: set[str] = set()
    start = 1
    page_limit = 50

    while True:
        msg_url = f"{mail_api_url.rstrip('/')}/api/accounts/{account_id}/messages/view?limit={page_limit}&start={start}"
        msg_req = urllib.request.Request(msg_url)
        msg_req.add_header("Authorization", f"Zoho-oauthtoken {access_token}")

        try:
            with urllib.request.urlopen(msg_req, timeout=timeout) as resp:
                msgs_data = json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            break

        raw_msgs = msgs_data.get("data", [])
        if not raw_msgs:
            break

        reached_cutoff = False

        for msg in raw_msgs:
            msg_id = str(msg.get("messageId", ""))
            folder_id = str(msg.get("folderId", ""))
            received_time = msg.get("receivedTime", 0)
            received_ts = 0.0
            try:
                received_ts = float(received_time)
                if cutoff_ts_ms > 0 and received_ts < cutoff_ts_ms:
                    reached_cutoff = True
                    continue
            except (ValueError, TypeError):
                pass

            has_att = msg.get("hasAttachment")
            subject = msg.get("subject", "")
            summary = msg.get("summary", "")
            from_addr = msg.get("fromAddress", "")

            if not has_att or str(has_att) in {"0", "false", "False"}:
                # Neu email khong co attachment truc tiep, kiem tra link tra cuu online (MISA meInvoice)
                combined_text = f"{subject} {summary}".lower()
                if any(k in combined_text for k in ["hóa đơn", "hoá đơn", "invoice", "meinvoice", "misa", "đông kim", "vinh phát", "tra cứu"]):
                    curl = f"{mail_api_url.rstrip('/')}/api/accounts/{account_id}/folders/{folder_id}/messages/{msg_id}/content"
                    creq = urllib.request.Request(curl)
                    creq.add_header("Authorization", f"Zoho-oauthtoken {access_token}")
                    try:
                        with urllib.request.urlopen(creq, timeout=timeout) as cresp:
                            cdata = json.loads(cresp.read().decode("utf-8")).get("data", {})
                        body_html = cdata.get("content", "")
                        me_codes = re.findall(r"meinvoice\.vn/tra-cuu/[^\"'\s>]*?[?&](?:sc|Code)=([A-Za-z0-9_]+)", body_html, re.IGNORECASE)
                        for sc_code in set(me_codes):
                            pdf_bytes = download_meinvoice_pdf(sc_code, timeout=timeout)
                            if pdf_bytes:
                                date_str = ""
                                if received_ts > 0:
                                    date_str = datetime.fromtimestamp(received_ts / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                                attachments.append({
                                    "filename": f"meinvoice_{sc_code}.pdf",
                                    "content": pdf_bytes,
                                    "subject": subject,
                                    "from": from_addr,
                                    "date": date_str,
                                })
                    except Exception:
                        pass
                continue

            # 3. Lay thong tin attachments cua message
            att_info_url = f"{mail_api_url.rstrip('/')}/api/accounts/{account_id}/folders/{folder_id}/messages/{msg_id}/attachmentinfo"
            info_req = urllib.request.Request(att_info_url)
            info_req.add_header("Authorization", f"Zoho-oauthtoken {access_token}")

            try:
                with urllib.request.urlopen(info_req, timeout=timeout) as info_resp:
                    info_json = json.loads(info_resp.read().decode("utf-8"))
            except Exception:
                continue

            data_block = info_json.get("data", {})
            att_list = data_block.get("attachments", []) if isinstance(data_block, dict) else (data_block if isinstance(data_block, list) else [])

            for att_item in att_list:
                att_id = str(att_item.get("attachmentId", ""))
                att_name = str(att_item.get("attachmentName", ""))
                if not att_id or not att_name:
                    continue

                att_key = f"{msg_id}_{att_id}_{att_name}"
                if att_key in seen_att_keys:
                    continue
                seen_att_keys.add(att_key)

                fn_low = att_name.lower()
                if not fn_low.endswith((".pdf", ".xml", ".zip")):
                    continue

                # 4. Tai file dinh kem
                dl_url = f"{mail_api_url.rstrip('/')}/api/accounts/{account_id}/folders/{folder_id}/messages/{msg_id}/attachments/{att_id}"
                dl_req = urllib.request.Request(dl_url)
                dl_req.add_header("Authorization", f"Zoho-oauthtoken {access_token}")
                dl_req.add_header("Accept", "application/octet-stream")

                try:
                    with urllib.request.urlopen(dl_req, timeout=timeout) as dl_resp:
                        content_bytes = dl_resp.read()
                    date_str = ""
                    if received_ts > 0:
                        date_str = datetime.fromtimestamp(received_ts / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                    attachments.append({
                        "filename": att_name,
                        "content": content_bytes,
                        "subject": subject,
                        "from": from_addr,
                        "date": date_str,
                    })
                except Exception:
                    continue

        if reached_cutoff or len(raw_msgs) < page_limit or start >= 500:
            break
        start += len(raw_msgs)

    return attachments


def test_rest_api_connection(
    client_id: str,
    client_secret: str,
    refresh_token: str = "",
    grant_token: str = "",
    accounts_url: str = "https://accounts.zoho.com",
    mail_api_url: str = "https://mail.zoho.com",
    timeout: float = 15.0,
) -> dict[str, Any]:
    """Kiem tra ket noi Zoho Mail REST API OAuth 2.0."""
    new_refresh_token = refresh_token
    if grant_token and not refresh_token:
        token_data = exchange_grant_token(
            client_id=client_id,
            client_secret=client_secret,
            grant_token=grant_token,
            accounts_url=accounts_url,
            timeout=timeout,
        )
        new_refresh_token = token_data.get("refresh_token", "")
        access_token = token_data.get("access_token", "")
    else:
        access_token = get_access_token_from_refresh(
            client_id=client_id,
            client_secret=client_secret,
            refresh_token=refresh_token,
            accounts_url=accounts_url,
            timeout=timeout,
        )

    # Lay thong tin account
    acc_url = f"{mail_api_url.rstrip('/')}/api/accounts"
    acc_req = urllib.request.Request(acc_url)
    acc_req.add_header("Authorization", f"Zoho-oauthtoken {access_token}")

    try:
        with urllib.request.urlopen(acc_req, timeout=timeout) as resp:
            acc_data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        raise EmailConnectionError(f"Không thể truy cập Zoho Mail REST API: {exc}") from exc

    accounts = acc_data.get("data", [])
    if not accounts:
        raise EmailAuthError("Xác thực OAuth thành công nhưng không tìm thấy tài khoản Zoho Mail nào")

    primary_acc = accounts[0]
    acc_name = primary_acc.get("accountName") or primary_acc.get("incomingUserName") or primary_acc.get("accountId")

    return {
        "ok": True,
        "message": f"Kết nối Zoho Mail REST API thành công! Tài khoản: {acc_name}",
        "account_name": acc_name,
        "account_id": primary_acc.get("accountId"),
        "refresh_token": new_refresh_token,
    }


def test_connection(
    server: str,
    port: int,
    username: str,
    password: str,
    mailbox: str = "INBOX",
    timeout: float = 15.0,
) -> dict[str, Any]:
    """Kiem tra ket noi IMAP SSL va dang nhap."""
    if not server or not username or not password:
        raise EmailAuthError("Chưa điền đủ thông tin máy chủ, tài khoản hoặc mật khẩu")
    try:
        imap = imaplib.IMAP4_SSL(server, port, timeout=timeout)
    except Exception as e:
        raise EmailConnectionError(f"Không thể kết nối đến máy chủ {server}:{port}: {e}") from e

    try:
        imap.login(username, password)
    except imaplib.IMAP4.error as e:
        imap.logout()
        raise EmailAuthError(f"Đăng nhập thất bại (kiểm tra lại email và App Password): {e}") from e
    except Exception as e:
        imap.logout()
        raise EmailConnectionError(f"Lỗi đăng nhập IMAP: {e}") from e

    try:
        status, data = imap.select(mailbox, readonly=True)
        if status != "OK":
            raise EmailConnectionError(f"Không thể mở hộp thư '{mailbox}': {status}")
        count_str = data[0].decode() if data and data[0] else "0"
        total_emails = int(count_str) if count_str.isdigit() else 0
        return {
            "ok": True,
            "message": f"Kết nối thành công! Hộp thư '{mailbox}' hiện có {total_emails} email.",
            "mailbox": mailbox,
            "total_emails": total_emails,
        }
    finally:
        try:
            imap.close()
        except Exception:
            pass
        try:
            imap.logout()
        except Exception:
            pass


def _is_invoice_email(subject: str, body_text: str, filename: str) -> bool:
    """Kiem tra xem email hoac attachment co lien quan toi hoa don khong."""
    fn_low = filename.lower()
    if fn_low.endswith((".xml", ".pdf", ".zip")):
        return True
    combined = f"{subject} {body_text}".lower()
    keywords = ["hóa đơn", "hoa don", "invoice", "hddt", "e-invoice", "phiếu xuất", "phieu xuat", "vat"]
    return any(kw in combined for kw in keywords)


def fetch_email_attachments(
    server: str,
    port: int,
    username: str,
    password: str,
    mailbox: str = "INBOX",
    days: int = 30,
    timeout: float = 20.0,
) -> list[dict[str, Any]]:
    """Ket noi IMAP va quet lay tat ca file dinh kem (.pdf, .xml, .zip) tu cac email hop le."""
    if not server or not username or not password:
        raise EmailAuthError("Chưa cấu hình tài khoản hoặc mật khẩu IMAP")

    try:
        imap = imaplib.IMAP4_SSL(server, port, timeout=timeout)
        imap.login(username, password)
    except imaplib.IMAP4.error as e:
        raise EmailAuthError(f"Đăng nhập Zoho Mail thất bại: {e}") from e
    except Exception as e:
        raise EmailConnectionError(f"Lỗi kết nối IMAP: {e}") from e

    attachments: list[dict[str, Any]] = []
    seen_hashes: set[str] = set()

    try:
        status, _ = imap.select(mailbox, readonly=True)
        if status != "OK":
            raise EmailConnectionError(f"Không thể chọn hộp thư {mailbox}")

        # Tim kiem theo ngay
        if days > 0:
            since_dt = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%d-%b-%Y")
            criteria = f'(SINCE "{since_dt}")'
        else:
            criteria = "ALL"

        status, msg_nums = imap.search(None, criteria)
        if status != "OK" or not msg_nums or not msg_nums[0]:
            return []

        ids = msg_nums[0].split()
        # Duyet tu email moi nhat tro ve truoc
        for msg_id in reversed(ids):
            status, msg_data = imap.fetch(msg_id, "(RFC822)")
            if status != "OK" or not msg_data:
                continue

            raw_email = None
            for item in msg_data:
                if isinstance(item, tuple) and len(item) == 2:
                    raw_email = item[1]
                    break
            if not raw_email:
                continue

            try:
                msg = email.message_from_bytes(raw_email)
            except Exception:
                continue

            subject = decode_mime_str(msg.get("Subject", ""))
            from_addr = decode_mime_str(msg.get("From", ""))
            date_str = msg.get("Date", "")

            # Trich xuat noi dung text
            body_text = ""
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    try:
                        payload = part.get_payload(decode=True)
                        if payload:
                            body_text += payload.decode("utf-8", errors="replace")
                    except Exception:
                        pass

            for part in msg.walk():
                filename = decode_mime_str(part.get_filename() or "")
                content_type = part.get_content_type()

                if not filename:
                    # Neu content type la PDF hoac XML nhung khong co filename
                    if content_type == "application/pdf":
                        filename = "hoa_don.pdf"
                    elif content_type in {"application/xml", "text/xml"}:
                        filename = "hoa_don.xml"
                    elif content_type in {"application/zip", "application/x-zip-compressed"}:
                        filename = "hoa_don.zip"

                if not filename:
                    continue

                fn_low = filename.lower()
                if not (fn_low.endswith(".pdf") or fn_low.endswith(".xml") or fn_low.endswith(".zip")):
                    continue

                payload = part.get_payload(decode=True)
                if not payload or len(payload) < 20:
                    continue

                h = hashlib.sha256(payload).hexdigest()
                if h in seen_hashes:
                    continue
                seen_hashes.add(h)

                attachments.append({
                    "email_id": msg_id.decode() if isinstance(msg_id, bytes) else str(msg_id),
                    "subject": subject,
                    "from_addr": from_addr,
                    "date": date_str,
                    "filename": filename,
                    "content": payload,
                    "sha256": h,
                })
    finally:
        try:
            imap.close()
        except Exception:
            pass
        try:
            imap.logout()
        except Exception:
            pass

    return attachments


def run_sync(db: Session, settings: Settings, days: int = 30) -> JobRun:
    """Quet email Zoho qua REST API OAuth 2.0 hoac IMAP, trich xuat hoa don va dong bo vao So Mua Vao."""
    cfg = get_zoho_settings(db, settings)
    if not cfg["enabled"]:
        raise EmailSyncError("Tính năng đồng bộ Email Zoho đang bị tắt")

    mode = cfg.get("mode", "rest_api")
    if mode == "rest_api":
        if not cfg["client_id"] or not cfg["client_secret"] or not cfg["refresh_token"]:
            raise EmailAuthError("Chưa cấu hình Client ID, Client Secret hoặc Refresh Token của Zoho API Console")
    else:
        if not cfg["username"] or not cfg["password"]:
            raise EmailAuthError("Chưa cấu hình tài khoản hoặc Mật khẩu ứng dụng Zoho Mail")

    with sync_lock(settings.data_path):
        job = JobRun(kind="email_invoice_sync", status="running")
        db.add(job)
        db.commit()
        db.refresh(job)

        stats = {
            "emails_scanned": 0,
            "attachments_found": 0,
            "pdf_attached_to_existing": 0,
            "created_new_draft": 0,
            "skipped_existing": 0,
            "errors": 0,
            "details": [],
        }

        try:
            if mode == "rest_api":
                raw_attachments = fetch_rest_api_attachments(
                    client_id=cfg["client_id"],
                    client_secret=cfg["client_secret"],
                    refresh_token=cfg["refresh_token"],
                    accounts_url=cfg.get("accounts_url", "https://accounts.zoho.com"),
                    mail_api_url=cfg.get("mail_api_url", "https://mail.zoho.com"),
                    days=days or cfg["days"],
                    timeout=getattr(settings, "zoho_imap_timeout", 20.0),
                )
            else:
                raw_attachments = fetch_email_attachments(
                    server=cfg["server"],
                    port=cfg["port"],
                    username=cfg["username"],
                    password=cfg["password"],
                    mailbox=cfg["mailbox"],
                    days=days or cfg["days"],
                    timeout=getattr(settings, "zoho_imap_timeout", 20.0),
                )
            stats["attachments_found"] = len(raw_attachments)

            # Mo rong cac file zip
            processed_files: list[tuple[str, bytes, dict[str, Any]]] = []
            for att in raw_attachments:
                fname = att["filename"]
                cnt = att["content"]
                if fname.lower().endswith(".zip"):
                    try:
                        expanded = inv_import.expand_zip(fname, cnt)
                        for sub_name, sub_cnt in expanded:
                            processed_files.append((sub_name, sub_cnt, att))
                    except Exception as e:
                        stats["errors"] += 1
                        stats["details"].append(f"Lỗi giải nén {fname}: {e}")
                else:
                    processed_files.append((fname, cnt, att))

            # Sap xep XML len truoc de parse du lieu chuan nhat neu co ca XML va PDF
            def _sort_key(item: tuple[str, bytes, dict]):
                fn = item[0].lower()
                return 0 if fn.endswith(".xml") else 1

            processed_files.sort(key=_sort_key)

            # Cache danh sach hoa don mua vao hien co de match da tang
            existing_by_mst_kh_so: dict[tuple[str, str, str], InvPurchase] = {}
            existing_by_mst_so: dict[tuple[str, str], list[InvPurchase]] = {}
            existing_by_kh_so: dict[tuple[str, str], list[InvPurchase]] = {}

            for inv in db.scalars(select(InvPurchase)):
                mst_norm = re.sub(r"\D", "", inv.mst_ban or "")
                kh = (inv.ky_hieu or "").strip().upper()
                kh_strip = re.sub(r"^[1-6]", "", kh)
                sh = inventory.normalize_so_hd(inv.so_hd or "")
                if sh:
                    if mst_norm:
                        if kh:
                            existing_by_mst_kh_so[(mst_norm, kh, sh)] = inv
                        if kh_strip:
                            existing_by_mst_kh_so[(mst_norm, kh_strip, sh)] = inv
                        existing_by_mst_so.setdefault((mst_norm, sh), []).append(inv)
                    if kh:
                        existing_by_kh_so.setdefault((kh, sh), []).append(inv)
                    if kh_strip and kh_strip != kh:
                        existing_by_kh_so.setdefault((kh_strip, sh), []).append(inv)

            for fname, content, meta in processed_files:
                fn_low = fname.lower()
                parsed_data = None
                suffix = ".pdf" if fn_low.endswith(".pdf") else (".xml" if fn_low.endswith(".xml") else "")

                try:
                    if fn_low.endswith(".xml") or content.lstrip()[:5] == b"<?xml":
                        parsed_data = inv_import.parse_purchase_xml(content)
                        suffix = ".xml"
                    elif fn_low.endswith(".pdf") or content.startswith(b"%PDF"):
                        parsed_data = inv_import.parse_purchase_pdf(content)
                        suffix = ".pdf"
                    else:
                        continue
                except Exception as e:
                    stats["errors"] += 1
                    stats["details"].append(f"Không thể đọc file {fname}: {e}")
                    continue

                parsed_data = _supplement_from_filename(parsed_data, fname)

                raw_mst = str(parsed_data.get("mst_ban") or "")
                mst_norm = re.sub(r"\D", "", raw_mst)
                if mst_norm == "4401053694":  # Khong dung MST nguoi mua lam MST nguoi ban
                    mst_norm = ""

                kh = str(parsed_data.get("ky_hieu") or "").strip().upper()
                kh_strip = re.sub(r"^[1-6]", "", kh)
                sh = inventory.normalize_so_hd(str(parsed_data.get("so_hd") or ""))

                if not sh:
                    continue

                # Tim hoa don da ton tai qua cac cap key
                existing = None
                if mst_norm and kh and (mst_norm, kh, sh) in existing_by_mst_kh_so:
                    existing = existing_by_mst_kh_so[(mst_norm, kh, sh)]
                elif mst_norm and kh_strip and (mst_norm, kh_strip, sh) in existing_by_mst_kh_so:
                    existing = existing_by_mst_kh_so[(mst_norm, kh_strip, sh)]
                elif mst_norm and (mst_norm, sh) in existing_by_mst_so and len(existing_by_mst_so[(mst_norm, sh)]) == 1:
                    existing = existing_by_mst_so[(mst_norm, sh)][0]
                elif kh and (kh, sh) in existing_by_kh_so and len(existing_by_kh_so[(kh, sh)]) == 1:
                    existing = existing_by_kh_so[(kh, sh)][0]
                elif kh_strip and (kh_strip, sh) in existing_by_kh_so and len(existing_by_kh_so[(kh_strip, sh)]) == 1:
                    existing = existing_by_kh_so[(kh_strip, sh)][0]

                if existing:
                    # Neu da co hoa don mua vao, nhung dang thieu PDF va file hien tai la PDF
                    if (not existing.doc_id or existing.doc_suffix != ".pdf") and suffix == ".pdf":
                        doc_id = storage.save_upload(content, suffix=".pdf")
                        existing.doc_id = doc_id
                        existing.doc_suffix = ".pdf"
                        stats["pdf_attached_to_existing"] += 1
                        stats["details"].append(f"Gán PDF cho HĐ #{existing.id} ({existing.so_hd} - {existing.ten_ban[:40]})")
                    else:
                        stats["skipped_existing"] += 1
                else:
                    # Tao hoa don mua vao nhap moi neu co du thong tin ben ban
                    if mst_norm and parsed_data.get("ten_ban"):
                        doc_id = storage.save_upload(content, suffix=suffix)
                        new_inv = inv_import.create_purchase_draft(db, parsed_data, doc_id=doc_id, doc_suffix=suffix)
                        key_full = (mst_norm, kh, sh)
                        existing_by_mst_kh_so[key_full] = new_inv
                        existing_by_mst_so.setdefault((mst_norm, sh), []).append(new_inv)
                        if kh:
                            existing_by_kh_so.setdefault((kh, sh), []).append(new_inv)
                        stats["created_new_draft"] += 1
                        stats["details"].append(f"Tạo mới HĐ #{new_inv.id} ({new_inv.so_hd} - {new_inv.ten_ban[:40]})")
                    else:
                        stats["skipped_existing"] += 1

                db.commit()

            job.status = "needs_action" if stats["errors"] > 0 else "success"
            job.needs_action = stats["errors"] > 0
        except Exception as exc:
            db.rollback()
            job = db.get(JobRun, job.id)
            job.status = "failed"
            job.error = str(exc)[:2000]

        job.stats = json.dumps(stats, ensure_ascii=False)
        job.finished_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(job)
        return job
