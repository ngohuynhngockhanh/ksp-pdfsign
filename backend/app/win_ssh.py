"""Ky PDF qua SSH toi may Windows cam token (che do 'ssh').

Khong can cai gi tren may Windows ngoai OpenSSH Server. Backend SSH vao bang
tai khoan Administrator, chay PowerShell dung **kho chung thu Windows + CSP**
de:
  - liet ke chung thu co private key (token),
  - lay chung thu + chuoi (DER),
  - ky raw digest voi PIN truyen tu dong (CspParameters.KeyPassword + NoPrompt),
    nen KHONG bi hoi PIN tuong tac.

Yeu cau tren may backend: `sshpass` va `ssh` (openssh-client).
"""
from __future__ import annotations

import base64
import json
import os
import subprocess

from .config import Settings
from .schemas import CertInfo

# digest_algorithm -> (lop hash .NET, OID)
_HASH_OID = {
    "sha1": ("SHA1", "1.3.14.3.2.26"),
    "sha256": ("SHA256", "2.16.840.1.101.3.4.2.1"),
    "sha384": ("SHA384", "2.16.840.1.101.3.4.2.2"),
    "sha512": ("SHA512", "2.16.840.1.101.3.4.2.3"),
}


class WinSshError(RuntimeError):
    pass


def _encode_ps(script: str) -> str:
    return base64.b64encode(script.encode("utf-16-le")).decode()


def _run(settings: Settings, host: str, admin_password: str, script: str) -> str:
    """Chay PowerShell tren may Windows qua SSH, tra ve stdout (text)."""
    enc = _encode_ps(script)
    cmd = [
        "sshpass",
        "-e",
        "ssh",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        f"ConnectTimeout={settings.ssh_connect_timeout}",
        f"{settings.ssh_user}@{host}",
        f"powershell -NoProfile -OutputFormat Text -EncodedCommand {enc}",
    ]
    env = dict(os.environ)
    env["SSHPASS"] = admin_password
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            env=env,
            timeout=settings.ssh_command_timeout,
        )
    except FileNotFoundError as e:
        raise WinSshError("Thieu 'sshpass'/'ssh' tren may backend.") from e
    except subprocess.TimeoutExpired as e:
        raise WinSshError(
            f"Qua thoi gian ky/ket noi toi {host} (co the token dang hoi PIN)."
        ) from e
    out = proc.stdout.decode("utf-8", "replace")
    err = proc.stderr.decode("utf-8", "replace")
    if proc.returncode != 0:
        low = err.lower()
        if "permission denied" in low or "authentication" in low:
            raise WinSshError("Sai mat khau Administrator (SSH tu choi).")
        if "could not resolve" in low or "no route" in low or "connection refused" in low:
            raise WinSshError(f"Khong ket noi duoc SSH toi {host}: {err.strip()[:160]}")
        raise WinSshError(f"Loi PowerShell tren may Windows: {(err or out).strip()[:300]}")
    return out


def _extract(prefix: str, stdout: str) -> str:
    for line in stdout.splitlines():
        line = line.strip()
        if line.startswith(prefix):
            return line[len(prefix):]
    raise WinSshError(f"Khong nhan duoc ket qua ('{prefix}') tu may Windows.")


def _out_json(stdout: str):
    """Giai ma dong OUT=<base64 utf8 json> (tranh loi codepage tieng Viet)."""
    raw = base64.b64decode(_extract("OUT=", stdout))
    return json.loads(raw.decode("utf-8"))


# ---------------------------------------------------------------------------
# Liet ke chung thu
# ---------------------------------------------------------------------------
_LIST_PS = r"""
$ErrorActionPreference="Stop"; $ProgressPreference="SilentlyContinue"
$items=@()
Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.HasPrivateKey } | ForEach-Object {
  $items += [pscustomobject]@{
    id=$_.Thumbprint
    subject=$_.Subject
    issuer=$_.Issuer
    serial=$_.SerialNumber
    valid_from=$_.NotBefore.ToString("s")
    valid_to=$_.NotAfter.ToString("s")
  }
}
$json=$items | ConvertTo-Json -Compress
if (-not $json) { $json="[]" }
$bytes=[System.Text.Encoding]::UTF8.GetBytes($json)
"OUT=" + [Convert]::ToBase64String($bytes)
"""


def list_certs(settings: Settings, host: str, admin_password: str) -> list[CertInfo]:
    data = _out_json(_run(settings, host, admin_password, _LIST_PS))
    if isinstance(data, dict):  # ConvertTo-Json tra object don khi chi 1 phan tu
        data = [data]
    return [CertInfo(**c) for c in data]


# ---------------------------------------------------------------------------
# Lay chung thu + chuoi (DER base64)
# ---------------------------------------------------------------------------
_CHAIN_PS = r"""
$ErrorActionPreference="Stop"; $ProgressPreference="SilentlyContinue"
$tp="__TP__"
$cert=Get-Item ("Cert:\CurrentUser\My\" + $tp)
$chain=New-Object System.Security.Cryptography.X509Certificates.X509Chain
$chain.ChainPolicy.RevocationMode="NoCheck"
[void]$chain.Build($cert)
$ders=@()
$ders += [Convert]::ToBase64String($cert.RawData)
foreach ($el in $chain.ChainElements) {
  $b=[Convert]::ToBase64String($el.Certificate.RawData)
  if ($ders -notcontains $b) { $ders += $b }
}
$json=$ders | ConvertTo-Json -Compress
$bytes=[System.Text.Encoding]::UTF8.GetBytes($json)
"OUT=" + [Convert]::ToBase64String($bytes)
"""


def get_cert_chain(
    settings: Settings, host: str, admin_password: str, thumbprint: str
) -> list[bytes]:
    tp = "".join(c for c in thumbprint if c.isalnum())
    data = _out_json(_run(settings, host, admin_password, _CHAIN_PS.replace("__TP__", tp)))
    if isinstance(data, str):
        data = [data]
    return [base64.b64decode(b) for b in data]


# ---------------------------------------------------------------------------
# Ky raw digest (PIN truyen tu dong, khong hoi tuong tac)
# ---------------------------------------------------------------------------
_SIGN_PS = r"""
$ErrorActionPreference="Stop"; $ProgressPreference="SilentlyContinue"
$tp="__TP__"; $pin="__PIN__"; $oid="__OID__"; $hashName="__HASH__"
$data=[Convert]::FromBase64String("__DATA__")
$cert=Get-Item ("Cert:\CurrentUser\My\" + $tp)
$info=$cert.PrivateKey.CspKeyContainerInfo
$cp=New-Object System.Security.Cryptography.CspParameters
$cp.ProviderName=$info.ProviderName
$cp.KeyContainerName=$info.KeyContainerName
$cp.ProviderType=$info.ProviderType
$cp.Flags=[System.Security.Cryptography.CspProviderFlags]::UseExistingKey -bor [System.Security.Cryptography.CspProviderFlags]::NoPrompt
$sec=New-Object System.Security.SecureString
$pin.ToCharArray() | ForEach-Object { $sec.AppendChar($_) }
$sec.MakeReadOnly()
$cp.KeyPassword=$sec
$rsa=New-Object System.Security.Cryptography.RSACryptoServiceProvider($cp)
$hash=[System.Security.Cryptography.HashAlgorithm]::Create($hashName).ComputeHash($data)
$sig=$rsa.SignHash($hash,$oid)
"SIG=" + [Convert]::ToBase64String($sig)
"""


def sign_raw(
    settings: Settings,
    host: str,
    admin_password: str,
    thumbprint: str,
    pin: str,
    data: bytes,
    digest_algorithm: str,
) -> bytes:
    if digest_algorithm not in _HASH_OID:
        raise WinSshError(f"digest_algorithm khong ho tro: {digest_algorithm}")
    hash_name, oid = _HASH_OID[digest_algorithm]
    tp = "".join(c for c in thumbprint if c.isalnum())
    script = (
        _SIGN_PS.replace("__TP__", tp)
        .replace("__PIN__", pin)
        .replace("__OID__", oid)
        .replace("__HASH__", hash_name)
        .replace("__DATA__", base64.b64encode(data).decode())
    )
    out = _run(settings, host, admin_password, script)
    return base64.b64decode(_extract("SIG=", out))
