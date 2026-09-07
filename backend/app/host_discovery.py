"""Co che tu dong quet va phat hien IP may Windows (DESKTOP-2022PHR) qua Nmap.

Khi may Windows cam token WIN-CA dung IP dong (DHCP), neu IP cu khong thong (timeout /
connection refused), he thong se tu dong quet dai mang bang nmap va smb-os-discovery
de tim dung may theo Hostname / NetBIOS name 'DESKTOP-2022PHR'.
"""
from __future__ import annotations

import logging
import socket
import subprocess
import threading
import time
import xml.etree.ElementTree as ET
from typing import Optional

logger = logging.getLogger("ksp_pdfsign.host_discovery")

# Cache IP da tim thay de khong phai scan nmap lien tuc
_RESOLVED_CACHE: dict[str, tuple[str, float]] = {}
_CACHE_TTL = 3600.0  # 1 gio
_SCAN_LOCK = threading.Lock()

DEFAULT_WINDOWS_HOSTNAME = "DESKTOP-2022PHR"
DEFAULT_WINDOWS_SUBNET = "192.168.1.0/24"


def is_tcp_port_open(host: str, port: int = 22, timeout: float = 2.0) -> bool:
    """Kiem tra nhanh port TCP co mo khong (tranh scan nmap neu IP hien tai dang tot)."""
    if not host:
        return False
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def scan_host_by_name(
    target_name: str = DEFAULT_WINDOWS_HOSTNAME,
    subnet: str = DEFAULT_WINDOWS_SUBNET,
    timeout: int = 25,
) -> Optional[str]:
    """Quet subnet bang nmap smb-os-discovery de tim IP theo NetBIOS / Computer Name."""
    logger.info("Dang quet dai mang %s de tim host '%s'...", subnet, target_name)
    cmd = ["nmap", "-sT", "-p", "445", "--script", "smb-os-discovery", "-oX", "-", subnet]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if res.returncode != 0:
            logger.warning("Nmap scan loi (code %d): %s", res.returncode, res.stderr[:200])
            return None
        root = ET.fromstring(res.stdout)
        target_lower = target_name.lower()
        for host in root.findall("host"):
            addr_elem = host.find("address[@addrtype='ipv4']")
            ip = addr_elem.get("addr") if addr_elem is not None else None
            if not ip:
                continue
            for elem in host.iter("elem"):
                if elem.get("key") in ("fqdn", "server", "Computer name", "NetBIOS computer name"):
                    val = (elem.text or "").split(chr(92))[0].strip()
                    if val.lower() == target_lower:
                        logger.info("Da tim thay host '%s' tai IP moi: %s", target_name, ip)
                        return ip
    except subprocess.TimeoutExpired:
        logger.warning("Nmap scan qua thoi gian (%ds)", timeout)
    except Exception as exc:
        logger.warning("Loi khi phan tich ket qua nmap: %s", exc)
    return None


def resolve_windows_host(
    current_host: str = "",
    target_name: str = DEFAULT_WINDOWS_HOSTNAME,
    subnet: str = DEFAULT_WINDOWS_SUBNET,
    probe_port: int = 22,
) -> str:
    """Tra ve IP hoat dong tot nhat cua may Windows.

    1. Neu current_host van thong port probe_port -> tra ve ngay lap tuc.
    2. Neu co IP trong cache va van thong port -> tra ve IP trong cache.
    3. Neu khong thong -> kich hoat nmap scan tim theo Hostname/NetBIOS name.
    4. Neu tim thay IP moi -> cap nhat cache va tra ve.
    5. Neu khong tim thay -> tra ve fallback ve current_host cu.
    """
    if current_host and is_tcp_port_open(current_host, probe_port, timeout=1.5):
        return current_host

    with _SCAN_LOCK:
        # Kiem tra lai sau khi co lock
        if current_host and is_tcp_port_open(current_host, probe_port, timeout=1.0):
            return current_host

        now = time.time()
        cached = _RESOLVED_CACHE.get(target_name)
        if cached:
            cached_ip, cached_time = cached
            if now - cached_time < _CACHE_TTL and is_tcp_port_open(cached_ip, probe_port, timeout=1.0):
                return cached_ip

        # Scan nmap
        found_ip = scan_host_by_name(target_name, subnet)
        if found_ip and is_tcp_port_open(found_ip, probe_port, timeout=2.0):
            _RESOLVED_CACHE[target_name] = (found_ip, now)
            return found_ip

    return current_host or "192.168.1.10"
