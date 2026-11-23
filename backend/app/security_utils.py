"""Shared security utilities for KSP PDF Signer backend.

Provides SSRF-safe HTTP fetching, restrictive WeasyPrint URL fetching,
RFC 5987 Content-Disposition formatting, strict host/token allowlist validation,
PowerShell EncodedCommand encoding, and safe correlation-ID error reporting.
"""
from __future__ import annotations

import base64
import ipaddress
import logging
import os
import re
import socket
import uuid
from pathlib import Path
from typing import Iterable
from urllib.parse import quote, unquote, urljoin, urlsplit

import httpx

_APP_DIR = Path(__file__).resolve().parent
_ALLOWED_WEASYPRINT_DIRS = (
    (_APP_DIR / "assets").resolve(),
    (_APP_DIR / "templates_bbbg").resolve(),
)

_CONTROL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f]")


def _is_global_ip(raw_ip: str) -> bool:
    """Return True iff raw_ip is a globally routable public IP address."""
    try:
        ip = ipaddress.ip_address(raw_ip)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return (
        ip.is_global
        and not ip.is_private
        and not ip.is_loopback
        and not ip.is_link_local
        and not ip.is_multicast
        and not ip.is_reserved
        and not ip.is_unspecified
    )


def _host_matches_allowlist(hostname: str, allowed_hosts: Iterable[str]) -> bool:
    host = hostname.strip().lower().rstrip(".")
    if not host:
        return False
    for raw_rule in allowed_hosts:
        rule = (raw_rule or "").strip().lower().rstrip(".")
        if not rule:
            continue
        if rule.startswith("*."):
            suffix = rule[2:]
            if suffix and (host == suffix or host.endswith("." + suffix)):
                return True
        elif host == rule:
            return True
    return False


def safe_weasyprint_url_fetcher(
    url: str, timeout: int = 10, ssl_context=None, **_kwargs
) -> dict:
    """Restrictive WeasyPrint url_fetcher preventing LFI and SSRF.

    Permits ONLY:
      - ``data:`` URIs
      - ``file://`` URIs resolving strictly inside ``backend/app/assets/`` or
        ``backend/app/templates_bbbg/``

    All other ``file://`` paths and all network schemes (``http://``,
    ``https://``, ``ftp://``, etc.) raise ``ValueError``.
    """
    from weasyprint import default_url_fetcher

    if not isinstance(url, str) or not url.strip():
        raise ValueError("URL WeasyPrint không hợp lệ")

    raw = url.strip()
    parsed = urlsplit(raw)
    scheme = (parsed.scheme or "").lower()

    if scheme == "data":
        return default_url_fetcher(raw, timeout=timeout, ssl_context=ssl_context)

    if scheme == "file":
        if parsed.netloc and parsed.netloc.lower() not in ("", "localhost"):
            raise ValueError("Chặn truy cập file:// qua mạng từ WeasyPrint")
        raw_path = unquote(parsed.path or "")
        if not raw_path:
            raise ValueError("Đường dẫn file:// trống")
        candidate = Path(raw_path).resolve()
        for allowed_dir in _ALLOWED_WEASYPRINT_DIRS:
            try:
                candidate.relative_to(allowed_dir)
                if candidate.is_file():
                    return default_url_fetcher(
                        candidate.as_uri(), timeout=timeout, ssl_context=ssl_context
                    )
            except ValueError:
                continue
        raise ValueError("Chặn đọc tệp ngoài thư mục assets cho phép trong WeasyPrint")

    raise ValueError(f"Chặn giao thức không được phép trong WeasyPrint: {scheme or 'unknown'}")


def validate_outbound_url(
    url: str,
    *,
    allowed_hosts: Iterable[str] | None = None,
    allow_http: bool = False,
) -> str:
    """Validate an outbound HTTP(S) URL against SSRF and host allowlists.

    Blocks non-global IP literals and DNS records resolving to loopback,
    private, link-local, reserved, multicast, or unspecified addresses.
    """
    if not isinstance(url, str):
        raise ValueError("URL không hợp lệ")
    cleaned = url.strip()
    if not cleaned or _CONTROL_CHAR_RE.search(cleaned):
        raise ValueError("URL chứa ký tự không hợp lệ")

    parsed = urlsplit(cleaned)
    scheme = (parsed.scheme or "").lower()
    allowed_schemes = {"https", "http"} if allow_http else {"https"}
    if scheme not in allowed_schemes:
        raise ValueError(f"Chỉ chấp nhận giao thức {', '.join(sorted(allowed_schemes))}")

    if parsed.username or parsed.password:
        raise ValueError("URL không được chứa thông tin xác thực")

    hostname = (parsed.hostname or "").strip().lower().rstrip(".")
    if not hostname:
        raise ValueError("URL thiếu tên miền đích")

    if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(".localhost"):
        raise ValueError("Chặn truy cập địa chỉ nội bộ (localhost)")

    if allowed_hosts is not None:
        rules = [h for h in allowed_hosts if (h or "").strip()]
        if not rules or not _host_matches_allowlist(hostname, rules):
            raise ValueError(f"Tên miền không nằm trong danh sách cho phép: {hostname}")

    # Direct IP literal check before DNS lookup
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        is_literal_ip = False
    else:
        is_literal_ip = True
        if not _is_global_ip(hostname):
            raise ValueError(f"Chặn truy cập địa chỉ IP nội bộ/không công khai: {hostname}")

    port = parsed.port or (443 if scheme == "https" else 80)
    if not is_literal_ip:
        try:
            addr_infos = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
        except OSError as exc:
            raise ValueError(f"Không phân giải được tên miền: {hostname}") from exc
        if not addr_infos:
            raise ValueError(f"Không tìm thấy bản ghi DNS hợp lệ cho: {hostname}")
        resolved_ips = {info[4][0] for info in addr_infos if info[4]}
        if not resolved_ips or any(not _is_global_ip(ip) for ip in resolved_ips):
            raise ValueError(f"Tên miền phân giải về địa chỉ IP nội bộ/không công khai: {hostname}")

    return cleaned


def safe_http_get(
    url: str,
    *,
    allowed_hosts: Iterable[str] | None = None,
    headers: dict | None = None,
    timeout: float = 30.0,
    max_redirects: int = 5,
    max_bytes: int = 25 * 1024 * 1024,
    verify: bool | str = True,
) -> httpx.Response:
    """Perform an SSRF-safe GET request validating every redirect hop and body size."""
    current_url = validate_outbound_url(url, allowed_hosts=allowed_hosts, allow_http=False)
    req_headers = dict(headers) if headers else None

    with httpx.Client(timeout=timeout, follow_redirects=False, verify=verify) as client:
        for _ in range(max_redirects + 1):
            with client.stream("GET", current_url, headers=req_headers) as resp:
                if resp.status_code in {301, 302, 303, 307, 308}:
                    location = resp.headers.get("location", "").strip()
                    if not location:
                        raise ValueError("Phản hồi chuyển hướng thiếu header Location")
                    next_url = urljoin(current_url, location)
                    current_url = validate_outbound_url(
                        next_url, allowed_hosts=allowed_hosts, allow_http=False
                    )
                    continue

                content_len = resp.headers.get("content-length")
                if content_len:
                    try:
                        if int(content_len) > max_bytes:
                            raise ValueError(f"Tệp tải về vượt quá giới hạn {max_bytes} bytes")
                    except ValueError as exc:
                        if "vượt quá giới hạn" in str(exc):
                            raise

                chunks: list[bytes] = []
                total = 0
                for chunk in resp.iter_bytes(chunk_size=65536):
                    total += len(chunk)
                    if total > max_bytes:
                        raise ValueError(f"Tệp tải về vượt quá giới hạn {max_bytes} bytes")
                    chunks.append(chunk)

                return httpx.Response(
                    status_code=resp.status_code,
                    headers=resp.headers,
                    content=b"".join(chunks),
                    request=resp.request,
                )

    raise ValueError("Quá nhiều lượt chuyển hướng HTTP")


def safe_content_disposition(filename: str, *, disposition: str = "attachment") -> str:
    """Build an RFC 5987 safe Content-Disposition header stripping CR/LF/quotes/slashes."""
    disp = "inline" if (disposition or "").strip().lower() == "inline" else "attachment"
    raw = str(filename or "").replace("\r", "").replace("\n", "").replace("\x00", "")
    # Take basename across both POSIX and Windows separators
    raw = raw.replace("\\", "/").rsplit("/", 1)[-1]
    clean = re.sub(r'["\'\\;\x00-\x1f\x7f]+', "_", raw).strip().strip(".")
    if not clean:
        clean = "document"
    ascii_name = re.sub(r"[^A-Za-z0-9._() -]+", "_", clean.encode("ascii", "ignore").decode("ascii")).strip()
    if not ascii_name:
        ascii_name = "document"
    return f'{disp}; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(clean, safe="")}'


def validate_safe_token_str(
    value: str,
    pattern: str = r"^[A-Za-z0-9 _.-]{1,64}$",
    field: str = "value",
) -> str:
    """Validate a short identifier/token string (e.g., printer name, tracking code) against a regex."""
    if not isinstance(value, str):
        raise ValueError(f"{field} không hợp lệ")
    cleaned = value.strip()
    if not cleaned or not re.fullmatch(pattern, cleaned):
        raise ValueError(f"{field} chứa ký tự không hợp lệ")
    return cleaned


def validate_allowed_host(host: str, allowed_hosts: Iterable[str]) -> str:
    """Validate a target host/IP against an explicit allowlist."""
    if not isinstance(host, str):
        raise ValueError("Địa chỉ máy chủ không hợp lệ")
    cleaned = host.strip().lower()
    if not cleaned or cleaned.startswith("-") or _CONTROL_CHAR_RE.search(cleaned) or any(c.isspace() for c in cleaned):
        raise ValueError("Địa chỉ máy chủ không hợp lệ")
    normalized = {h.strip().lower() for h in allowed_hosts if (h or "").strip()}
    if cleaned not in normalized:
        raise ValueError(f"Máy chủ '{cleaned}' không nằm trong danh sách cho phép")
    return cleaned


def error_detail(user_msg: str, exc: Exception, logger_name: str = "ksp.security") -> str:
    """Log the full exception with a correlation reference and return a safe localized message."""
    ref = uuid.uuid4().hex[:8]
    logging.getLogger(logger_name).exception("[%s] %s: %s", ref, user_msg, exc)
    return f"{user_msg} (Mã tra cứu: {ref})"


def build_powershell_encoded_command(script: str) -> str:
    """Encode a PowerShell script to UTF-16LE Base64 for `-EncodedCommand`."""
    return base64.b64encode(script.encode("utf-16-le")).decode("ascii")


def get_gov_tls_verify() -> bool | str:
    """Resolve TLS verification policy for external Vietnam government portals.

    Checks ``GOV_CA_BUNDLE`` (path to PEM bundle); otherwise defaults to ``True``
    unless ``ALLOW_INSECURE_GOV_TLS=true`` is explicitly set in environment.
    """
    ca_bundle = (os.environ.get("GOV_CA_BUNDLE") or "").strip()
    if ca_bundle and Path(ca_bundle).is_file():
        return ca_bundle
    if (os.environ.get("ALLOW_INSECURE_GOV_TLS") or "").strip().lower() in {"1", "true", "yes"}:
        return False
    return True
