"""Remote A4 laser printing integration for Brother HL-L2320D on Windows host.

Transfers PDF files over OpenSSH (`scp -O`) to the Windows print workstation
(`DESKTOP-O3VN908`, default `192.168.1.12`) and executes silent printing via
`C:\\ksp\\SumatraPDF.exe` (with fallback to Foxit Reader CLI) using strict
input allowlists and PowerShell `-EncodedCommand`.
"""
from __future__ import annotations

import base64
import json
import logging
import re
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from . import storage
from .db import Document
from .host_discovery import resolve_windows_host
from .security_utils import (
    build_powershell_encoded_command,
    validate_allowed_host,
    validate_safe_token_str,
)

logger = logging.getLogger("ksp_pdfsign.brother_print")

DEFAULT_BROTHER_PRINTER = "Brother HL-L2320D series"
DEFAULT_WINDOWS_HOST = "192.168.1.12"
SSH_KEY_PATH = "/home/ksp/.ssh/id_ed25519"
MAX_PDF_BYTES = 50 * 1024 * 1024  # 50 MB

ALLOWED_PAPER_SIZES = {
    "a4": "A4",
    "a5": "A5",
    "a6": "A6",
    "b5": "B5",
    "letter": "Letter",
    "legal": "Legal",
}

ALLOWED_DUPLEX_MODES = {
    "simplex": "simplex",
    "1": "simplex",
    "onesided": "simplex",
    "long": "duplexlong",
    "duplex": "duplexlong",
    "duplexlong": "duplexlong",
    "twosidedlongedge": "duplexlong",
    "short": "duplexshort",
    "duplexshort": "duplexshort",
    "twosidedshortedge": "duplexshort",
}

ALLOWED_SCALE_MODES = {
    "fit": "fit",
    "shrink": "shrink",
    "noscale": "noscale",
}

ALLOWED_ORIENTATIONS = {
    "auto": "",
    "portrait": "portrait",
    "landscape": "landscape",
}

ALLOWED_TRAYS = {
    "auto": "",
    "tray1": "Tray1",
    "manual": "Manual",
}

_PAGE_RANGE_RE = re.compile(r"^(?:odd|even|\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$")


def allowed_windows_hosts() -> set[str]:
    from .config import get_settings

    settings = get_settings()
    hosts = {
        "192.168.1.10",
        "192.168.1.11",
        "192.168.1.12",
        "192.168.1.13",
        "192.168.1.111",
        "inut-dev",
    }
    for candidate in (
        getattr(settings, "agent_default_ip", ""),
        getattr(settings, "ecus_ssh_host", ""),
    ):
        if candidate and candidate.strip():
            hosts.add(candidate.strip().lower())
    extra = getattr(settings, "allowed_ssh_hosts", "") or ""
    for item in extra.split(","):
        if item.strip():
            hosts.add(item.strip().lower())
    return hosts


def _resolve_host(host: str) -> tuple[str, str]:
    clean_host = validate_allowed_host(host, allowed_windows_hosts())
    probe = "" if clean_host == "inut-dev" else clean_host
    try:
        resolved = resolve_windows_host(probe, probe_port=445)
    except TypeError:
        resolved = resolve_windows_host(probe)
    return clean_host, resolved


def _validate_printer_name(printer_name: str) -> str:
    return validate_safe_token_str(
        printer_name,
        pattern=r"^[A-Za-z0-9 _().-]{1,80}$",
        field="printer_name",
    )


def _normalize_print_options(
    *,
    paper_size: str = "A4",
    duplex: str = "simplex",
    copies: int = 1,
    page_range: str | None = None,
    scale: str = "fit",
    orientation: str = "auto",
    tray: str = "auto",
) -> dict[str, Any]:
    paper_key = (paper_size or "A4").strip().lower()
    if paper_key not in ALLOWED_PAPER_SIZES:
        raise ValueError(
            f"paper_size không hợp lệ '{paper_size}'. Hỗ trợ: {', '.join(ALLOWED_PAPER_SIZES.values())}"
        )
    clean_paper = ALLOWED_PAPER_SIZES[paper_key]

    duplex_key = (duplex or "simplex").strip().lower()
    if duplex_key not in ALLOWED_DUPLEX_MODES:
        raise ValueError(
            f"duplex không hợp lệ '{duplex}'. Hỗ trợ: simplex, long (duplexlong), short (duplexshort)"
        )
    clean_duplex = ALLOWED_DUPLEX_MODES[duplex_key]

    if not isinstance(copies, int) or copies < 1 or copies > 50:
        raise ValueError("copies phải là số nguyên từ 1 đến 50")

    clean_pages = ""
    if page_range is not None and str(page_range).strip():
        compact = re.sub(r"\s+", "", str(page_range).strip().lower())
        if not _PAGE_RANGE_RE.fullmatch(compact):
            raise ValueError(
                "page_range không hợp lệ (ví dụ hợp lệ: '1-3', '1,3,5-7', 'odd', 'even')"
            )
        clean_pages = compact

    scale_key = (scale or "fit").strip().lower()
    if scale_key not in ALLOWED_SCALE_MODES:
        raise ValueError("scale không hợp lệ. Hỗ trợ: fit, shrink, noscale")
    clean_scale = ALLOWED_SCALE_MODES[scale_key]

    orient_key = (orientation or "auto").strip().lower()
    if orient_key not in ALLOWED_ORIENTATIONS:
        raise ValueError("orientation không hợp lệ. Hỗ trợ: auto, portrait, landscape")
    clean_orient = ALLOWED_ORIENTATIONS[orient_key]

    tray_key = (tray or "auto").strip().lower()
    if tray_key not in ALLOWED_TRAYS:
        raise ValueError("tray không hợp lệ. Hỗ trợ: auto, tray1, manual")
    clean_tray = ALLOWED_TRAYS[tray_key]

    return {
        "paper_size": clean_paper,
        "duplex": clean_duplex,
        "copies": copies,
        "page_range": clean_pages,
        "scale": clean_scale,
        "orientation": clean_orient,
        "tray": clean_tray,
    }


def build_sumatra_settings(
    *,
    paper_size: str = "A4",
    duplex: str = "simplex",
    copies: int = 1,
    page_range: str | None = None,
    scale: str = "fit",
    orientation: str = "auto",
    tray: str = "auto",
) -> str:
    opts = _normalize_print_options(
        paper_size=paper_size,
        duplex=duplex,
        copies=copies,
        page_range=page_range,
        scale=scale,
        orientation=orientation,
        tray=tray,
    )
    tokens: list[str] = [
        f"paper={opts['paper_size']}",
        opts["duplex"],
        opts["scale"],
        "monochrome",
        f"{opts['copies']}x",
    ]
    if opts["orientation"]:
        tokens.append(opts["orientation"])
    if opts["tray"]:
        tokens.append(f"bin={opts['tray']}")
    if opts["page_range"]:
        tokens.append(opts["page_range"])
    return ",".join(tokens)


def _ssh_base_cmd(resolved_host: str, *, connect_timeout: int = 15) -> list[str]:
    return [
        "ssh",
        "-n",
        "-i",
        SSH_KEY_PATH,
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ProxyCommand=none",
        "-o",
        "BatchMode=yes",
        "-o",
        f"ConnectTimeout={connect_timeout}",
        f"Administrator@{resolved_host}",
    ]


def _run_ps_json(resolved_host: str, ps_script: str, *, timeout: int = 30) -> Any:
    encoded = build_powershell_encoded_command(ps_script)
    cmd = _ssh_base_cmd(resolved_host, connect_timeout=15) + [
        f"powershell -NoProfile -NonInteractive -EncodedCommand {encoded}"
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(f"Lỗi thực thi PowerShell trên {resolved_host}: {proc.stderr.strip()}")
    raw = (proc.stdout or "").strip()
    if not raw:
        return None
    # Strip any stray warning lines before JSON array/object
    start_idx = min(
        [i for i in (raw.find("["), raw.find("{")) if i != -1],
        default=-1,
    )
    if start_idx == -1:
        raise RuntimeError(f"Phản hồi PowerShell không phải JSON hợp lệ: {raw[:200]}")
    return json.loads(raw[start_idx:])


def list_windows_printers(host: str = DEFAULT_WINDOWS_HOST) -> list[dict[str, Any]]:
    """Liệt kê toàn bộ máy in trên máy Windows kèm khổ giấy, duplex, trạng thái online."""
    _, resolved_host = _resolve_host(host)
    ps_script = (
        "$ErrorActionPreference = 'SilentlyContinue'\n"
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n"
        "$items = @()\n"
        "foreach ($p in (Get-CimInstance Win32_Printer)) {\n"
        "  $cfg = Get-PrintConfiguration -PrinterName $p.Name\n"
        "  $jobs = @(Get-PrintJob -PrinterName $p.Name)\n"
        "  $items += [PSCustomObject]@{\n"
        "    name = [string]$p.Name\n"
        "    driver = [string]$p.DriverName\n"
        "    port = [string]$p.PortName\n"
        "    shared = [bool]$p.Shared\n"
        "    share_name = [string]$p.ShareName\n"
        "    default = [bool]$p.Default\n"
        "    work_offline = [bool]$p.WorkOffline\n"
        "    printer_status = [int]$p.PrinterStatus\n"
        "    paper_size = if ($cfg) { [string]$cfg.PaperSize } else { '' }\n"
        "    duplex_mode = if ($cfg) { [string]$cfg.DuplexingMode } else { '' }\n"
        "    collate = if ($cfg) { [bool]$cfg.Collate } else { $false }\n"
        "    dpi = [int]$p.HorizontalResolution\n"
        "    jobs_count = $jobs.Count\n"
        "  }\n"
        "}\n"
        "$items | ConvertTo-Json -Compress -Depth 3\n"
    )
    data = _run_ps_json(resolved_host, ps_script, timeout=25)
    if data is None:
        return []
    if isinstance(data, dict):
        data = [data]

    printers: list[dict[str, Any]] = []
    for item in data:
        name = str(item.get("name") or "")
        upper = name.upper()
        is_thermal = any(k in upper for k in ("TP732", "TP58", "TP80", "XPRINTER"))
        is_brother = "BROTHER" in upper or "HL-L2320" in upper
        is_virtual = any(
            k in upper for k in ("MICROSOFT PRINT TO PDF", "XPS", "FAX", "WPS PDF", "ONENOTE")
        )
        printers.append(
            {
                "name": name,
                "driver": str(item.get("driver") or ""),
                "port": str(item.get("port") or ""),
                "shared": bool(item.get("shared")),
                "share_name": str(item.get("share_name") or ""),
                "default": bool(item.get("default")),
                "work_offline": bool(item.get("work_offline")),
                "ready": (not bool(item.get("work_offline"))) and int(item.get("printer_status") or 0) in (3, 4),
                "printer_status": int(item.get("printer_status") or 0),
                "paper_size": str(item.get("paper_size") or ""),
                "duplex_mode": str(item.get("duplex_mode") or ""),
                "collate": bool(item.get("collate")),
                "dpi": int(item.get("dpi") or 0),
                "jobs_count": int(item.get("jobs_count") or 0),
                "is_thermal": is_thermal,
                "is_a4_laser": is_brother,
                "is_virtual": is_virtual,
                "host": resolved_host,
            }
        )
    return printers


def get_printer_jobs(
    host: str = DEFAULT_WINDOWS_HOST,
    printer_name: str = DEFAULT_BROTHER_PRINTER,
) -> list[dict[str, Any]]:
    """Xem hàng đợi lệnh in hiện tại trên máy in Windows."""
    _, resolved_host = _resolve_host(host)
    clean_printer = _validate_printer_name(printer_name)
    printer_b64 = base64.b64encode(clean_printer.encode("utf-8")).decode("ascii")
    ps_script = (
        "$ErrorActionPreference = 'SilentlyContinue'\n"
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n"
        f"$p = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('{printer_b64}'))\n"
        "$jobs = @(Get-PrintJob -PrinterName $p | ForEach-Object {\n"
        "  [PSCustomObject]@{\n"
        "    id = [int]$_.Id\n"
        "    document_name = [string]$_.DocumentName\n"
        "    user_name = [string]$_.UserName\n"
        "    job_status = [string]$_.JobStatus\n"
        "    total_pages = [int]$_.TotalPages\n"
        "    pages_printed = [int]$_.PagesPrinted\n"
        "    submitted_time = if ($_.SubmittedTime) { $_.SubmittedTime.ToString('o') } else { '' }\n"
        "  }\n"
        "})\n"
        "if ($jobs.Count -eq 0) { '[]' } else { $jobs | ConvertTo-Json -Compress -Depth 3 }\n"
    )
    data = _run_ps_json(resolved_host, ps_script, timeout=20)
    if data is None:
        return []
    return [data] if isinstance(data, dict) else list(data)


def cancel_printer_jobs(
    host: str = DEFAULT_WINDOWS_HOST,
    printer_name: str = DEFAULT_BROTHER_PRINTER,
    job_id: int | None = None,
) -> dict[str, Any]:
    """Hủy 1 lệnh in cụ thể hoặc toàn bộ lệnh bị kẹt trong hàng đợi máy in."""
    _, resolved_host = _resolve_host(host)
    clean_printer = _validate_printer_name(printer_name)
    if job_id is not None and (not isinstance(job_id, int) or job_id <= 0):
        raise ValueError("job_id phải là số nguyên dương")

    printer_b64 = base64.b64encode(clean_printer.encode("utf-8")).decode("ascii")
    filter_expr = f"| Where-Object {{ $_.Id -eq {int(job_id)} }}" if job_id is not None else ""
    ps_script = (
        "$ErrorActionPreference = 'Stop'\n"
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n"
        f"$p = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('{printer_b64}'))\n"
        f"$targets = @(Get-PrintJob -PrinterName $p -ErrorAction SilentlyContinue {filter_expr})\n"
        "$cancelled = @()\n"
        "foreach ($j in $targets) {\n"
        "  Remove-PrintJob -PrinterName $p -ID $j.Id -ErrorAction SilentlyContinue\n"
        "  $cancelled += [int]$j.Id\n"
        "}\n"
        "[PSCustomObject]@{ printer = $p; cancelled_ids = $cancelled; count = $cancelled.Count } | ConvertTo-Json -Compress\n"
    )
    res = _run_ps_json(resolved_host, ps_script, timeout=20) or {}
    return {
        "success": True,
        "host": resolved_host,
        "printer_name": clean_printer,
        "cancelled_ids": res.get("cancelled_ids") or [],
        "cancelled_count": int(res.get("count") or 0),
    }


def _build_remote_print_cmd(
    win_file_name: str,
    printer_name: str,
    sumatra_settings: str,
) -> str:
    file_b64 = base64.b64encode(f"C:\\ksp\\{win_file_name}".encode("utf-8")).decode("ascii")
    printer_b64 = base64.b64encode(printer_name.encode("utf-8")).decode("ascii")
    settings_b64 = base64.b64encode(sumatra_settings.encode("utf-8")).decode("ascii")
    ps_script = (
        "$ErrorActionPreference = 'Stop'\n"
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n"
        f"$f = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('{file_b64}'))\n"
        f"$p = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('{printer_b64}'))\n"
        f"$s = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('{settings_b64}'))\n"
        "$sumatra = 'C:\\ksp\\SumatraPDF.exe'\n"
        "$foxit = 'C:\\Program Files (x86)\\Foxit Software\\Foxit Reader\\FoxitReader.exe'\n"
        "$engine = 'sumatra'\n"
        "try {\n"
        "  if (Test-Path $sumatra) {\n"
        "    $psi = New-Object System.Diagnostics.ProcessStartInfo\n"
        "    $psi.FileName = $sumatra\n"
        "    $psi.Arguments = ('-silent -exit-when-done -print-to \"' + $p + '\" -print-settings \"' + $s + '\" \"' + $f + '\"')\n"
        "    $psi.UseShellExecute = $false\n"
        "    $psi.CreateNoWindow = $true\n"
        "    $proc = [System.Diagnostics.Process]::Start($psi)\n"
        "    $exited = $proc.WaitForExit(60000)\n"
        "    if (-not $exited) { $proc.Kill(); throw 'SumatraPDF print timeout (60s)' }\n"
        "    if ($proc.ExitCode -ne 0) { throw ('SumatraPDF exit code ' + $proc.ExitCode) }\n"
        "  } elseif (Test-Path $foxit) {\n"
        "    $engine = 'foxit'\n"
        "    $psi = New-Object System.Diagnostics.ProcessStartInfo\n"
        "    $psi.FileName = $foxit\n"
        "    $psi.Arguments = ('/t \"' + $f + '\" \"' + $p + '\"')\n"
        "    $psi.UseShellExecute = $false\n"
        "    $proc = [System.Diagnostics.Process]::Start($psi)\n"
        "    $proc.WaitForExit(20000) | Out-Null\n"
        "    if (-not $proc.HasExited) { $proc.Kill() }\n"
        "  } else {\n"
        "    throw 'Khong tim thay SumatraPDF.exe hoac FoxitReader.exe tren Windows'\n"
        "  }\n"
        "  [PSCustomObject]@{ ok = $true; engine = $engine; printer = $p; settings = $s } | ConvertTo-Json -Compress\n"
        "} finally {\n"
        "  Start-Sleep -Milliseconds 800\n"
        "  Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue\n"
        "}\n"
    )
    encoded = build_powershell_encoded_command(ps_script)
    return f"powershell -NoProfile -NonInteractive -EncodedCommand {encoded}"


def print_pdf_bytes_a4(
    pdf_bytes: bytes,
    *,
    filename: str = "document.pdf",
    host: str = DEFAULT_WINDOWS_HOST,
    printer_name: str = DEFAULT_BROTHER_PRINTER,
    paper_size: str = "A4",
    duplex: str = "simplex",
    copies: int = 1,
    page_range: str | None = None,
    scale: str = "fit",
    orientation: str = "auto",
    tray: str = "auto",
    dry_run: bool = False,
) -> dict[str, Any]:
    """Gửi lệnh in PDF khổ A4 (hoặc tùy chọn) sang máy in Brother HL-L2320D trên Windows."""
    if not pdf_bytes or not pdf_bytes.lstrip()[:5].startswith(b"%PDF-"):
        raise ValueError("Dữ liệu đầu vào không phải tệp PDF hợp lệ")
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise ValueError(f"Tệp PDF vượt quá giới hạn {MAX_PDF_BYTES // (1024 * 1024)} MB")

    clean_printer = _validate_printer_name(printer_name)
    opts = _normalize_print_options(
        paper_size=paper_size,
        duplex=duplex,
        copies=copies,
        page_range=page_range,
        scale=scale,
        orientation=orientation,
        tray=tray,
    )
    sumatra_settings = build_sumatra_settings(**opts)

    stem = re.sub(r"[^A-Za-z0-9_-]+", "_", Path(filename or "document.pdf").stem).strip("_")[:48] or "doc"
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    win_file_name = f"a4_{ts}_{uuid.uuid4().hex[:6]}_{stem}.pdf"
    validate_safe_token_str(win_file_name, pattern=r"^[A-Za-z0-9_.-]{1,120}$", field="win_file_name")

    if dry_run:
        clean_host = validate_allowed_host(host, allowed_windows_hosts())
        return {
            "success": True,
            "dry_run": True,
            "host": clean_host,
            "printer_name": clean_printer,
            "filename": filename,
            "size_bytes": len(pdf_bytes),
            "print_settings": sumatra_settings,
            "options": opts,
            "message": f"[DRY-RUN] Sẵn sàng in '{filename}' ({len(pdf_bytes)} bytes) tới '{clean_printer}' ({sumatra_settings})",
        }

    clean_host, resolved_host = _resolve_host(host)

    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(prefix="ksp_a4_", suffix=".pdf", delete=False) as tmp:
            tmp.write(pdf_bytes)
            tmp_path = Path(tmp.name)

        scp_cmd = [
            "scp",
            "-O",
            "-i",
            SSH_KEY_PATH,
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            "ProxyCommand=none",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=30",
            str(tmp_path),
            f"Administrator@{resolved_host}:C:/ksp/{win_file_name}",
        ]
        scp_proc = subprocess.run(scp_cmd, capture_output=True, text=True, timeout=120)
        if scp_proc.returncode != 0:
            raise RuntimeError(
                f"Lỗi chuyển file PDF sang máy Windows {resolved_host}: {scp_proc.stderr.strip()}"
            )

        ps_cmd = _build_remote_print_cmd(win_file_name, clean_printer, sumatra_settings)
        ssh_cmd = _ssh_base_cmd(resolved_host, connect_timeout=30) + [ps_cmd]
        print_proc = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=90)
        if print_proc.returncode != 0:
            raise RuntimeError(
                f"Lỗi thực thi lệnh in trên máy Windows {resolved_host}: {print_proc.stderr.strip() or print_proc.stdout.strip()}"
            )

        engine = "sumatra"
        raw_out = (print_proc.stdout or "").strip()
        idx = raw_out.find("{")
        if idx != -1:
            try:
                parsed = json.loads(raw_out[idx:])
                engine = str(parsed.get("engine") or engine)
            except Exception:
                pass

        return {
            "success": True,
            "dry_run": False,
            "host": resolved_host,
            "requested_host": clean_host,
            "printer_name": clean_printer,
            "engine": engine,
            "filename": filename,
            "size_bytes": len(pdf_bytes),
            "print_settings": sumatra_settings,
            "options": opts,
            "printed_at": datetime.now(timezone.utc).isoformat(),
            "message": f"Đã gửi lệnh in A4 '{filename}' ({opts['copies']} bản, {opts['duplex']}) tới '{clean_printer}'!",
        }
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass


def print_ksp_document_a4(
    db: Session,
    doc_pk: int,
    *,
    prefer_signed: bool = True,
    host: str = DEFAULT_WINDOWS_HOST,
    printer_name: str = DEFAULT_BROTHER_PRINTER,
    paper_size: str = "A4",
    duplex: str = "simplex",
    copies: int = 1,
    page_range: str | None = None,
    scale: str = "fit",
    orientation: str = "auto",
    tray: str = "auto",
    dry_run: bool = False,
) -> dict[str, Any]:
    """Lấy file PDF của hồ sơ KSP PDFSign theo `doc_pk` và in ra Brother HL-L2320D."""
    doc = db.get(Document, doc_pk)
    if not doc:
        raise ValueError(f"Không tìm thấy hồ sơ KSP #{doc_pk}")

    used_signed = False
    target_doc_id = doc.doc_id
    target_name = doc.filename or f"document_{doc_pk}.pdf"

    if prefer_signed and doc.signed_upload_id:
        signed_found = storage.find_doc_path(doc.signed_upload_id)
        if signed_found and signed_found[1].lower() == ".pdf":
            target_doc_id = doc.signed_upload_id
            target_name = doc.signed_upload_name or target_name
            used_signed = True

    found = storage.find_doc_path(target_doc_id)
    if not found:
        raise FileNotFoundError(f"Không tìm thấy file lưu trữ cho hồ sơ #{doc_pk} ({target_doc_id})")
    fpath, suffix = found
    if suffix.lower() != ".pdf":
        raise ValueError(
            f"Hồ sơ #{doc_pk} có định dạng '{suffix}', chỉ hỗ trợ in trực tiếp tệp PDF"
        )

    pdf_bytes = fpath.read_bytes()
    result = print_pdf_bytes_a4(
        pdf_bytes,
        filename=target_name,
        host=host,
        printer_name=printer_name,
        paper_size=paper_size,
        duplex=duplex,
        copies=copies,
        page_range=page_range,
        scale=scale,
        orientation=orientation,
        tray=tray,
        dry_run=dry_run,
    )
    result.update(
        {
            "doc_pk": doc.id,
            "doc_id": target_doc_id,
            "used_signed_file": used_signed,
        }
    )
    return result
