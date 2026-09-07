#!/usr/bin/env python3
"""Script CLI phat hien va cap nhat IP dong cho may Windows (DESKTOP-2022PHR).

Chuc nang:
1. Kiem tra IP hien tai co thong port SSH (22) hay khong.
2. Neu khong thong (hoac khi truyen flag --force), tu dong quet dai mang bang nmap
   de tim IP theo NetBIOS/Computer Name 'DESKTOP-2022PHR'.
3. Neu tim thay IP moi:
   - In ra IP moi.
   - Tuy chon cap nhat truc tiep vao file .env (AGENT_DEFAULT_IP va ECUS_SSH_HOST) neu truyen --update-env.

Cach dung:
  python3 scripts/discover_windows_host.py
  python3 scripts/discover_windows_host.py --force --update-env
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent

# Tu dong dung virtualenv neu dang chay system python
venv_python = ROOT_DIR / "backend" / ".venv" / "bin" / "python3"
if venv_python.exists() and sys.executable != str(venv_python):
    import os
    os.execv(str(venv_python), [str(venv_python)] + sys.argv)

sys.path.insert(0, str(ROOT_DIR / "backend"))
from app.config import get_settings
from app.host_discovery import DEFAULT_WINDOWS_HOSTNAME, DEFAULT_WINDOWS_SUBNET, is_tcp_port_open, scan_host_by_name


def update_env_file(env_path: Path, new_ip: str) -> bool:
    """Cap nhat AGENT_DEFAULT_IP va ECUS_SSH_HOST trong file .env."""
    if not env_path.exists():
        print(f"[WARN] Khong tim thay file {env_path}")
        return False
    lines = env_path.read_text(encoding="utf-8").splitlines()
    updated = []
    changed = False
    for line in lines:
        if line.startswith("AGENT_DEFAULT_IP="):
            updated.append(f"AGENT_DEFAULT_IP={new_ip}")
            changed = True
        elif line.startswith("ECUS_SSH_HOST="):
            updated.append(f"ECUS_SSH_HOST={new_ip}")
            changed = True
        else:
            updated.append(line)
    if changed:
        env_path.write_text("\n".join(updated) + "\n", encoding="utf-8")
        print(f"[INFO] Da cap nhat IP moi {new_ip} vao {env_path}")
        return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Phat hien IP dong may Windows qua Nmap")
    parser.add_argument("--name", default=DEFAULT_WINDOWS_HOSTNAME, help="Ten may Windows can tim")
    parser.add_argument("--subnet", default=DEFAULT_WINDOWS_SUBNET, help="Dai mang can quet")
    parser.add_argument("--force", action="store_true", help="Bat buoc quet Nmap du IP hien tai dang thong")
    parser.add_argument("--update-env", action="store_true", help="Ghi IP moi vao file .env")
    args = parser.parse_args()

    settings = get_settings()
    current_ip = settings.agent_default_ip or "192.168.1.10"

    print(f"[INFO] May Windows muc tieu: {args.name}")
    print(f"[INFO] IP hien tai: {current_ip}")

    if not args.force and is_tcp_port_open(current_ip, port=22, timeout=1.5):
        print(f"[OK] IP hien tai {current_ip} van dang ket noi SSH binh thuong.")
        return 0

    if not args.force:
        print(f"[WARN] IP {current_ip} khong phan hoi tren port 22! Bat dau quet dai mang {args.subnet}...")
    else:
        print(f"[INFO] Chay quet cuong buc dai mang {args.subnet}...")

    found_ip = scan_host_by_name(target_name=args.name, subnet=args.subnet)
    if not found_ip:
        print(f"[ERROR] Khong tim thay host '{args.name}' tren dai mang {args.subnet}")
        return 1

    print(f"[SUCCESS] Da phat hien host '{args.name}' tai IP: {found_ip}")

    if args.update_env:
        env_file = ROOT_DIR / ".env"
        update_env_file(env_file, found_ip)

    return 0


if __name__ == "__main__":
    sys.exit(main())
