"""Gia tri chi dung trong test; ung dung that khong con secret mac dinh."""
import os

os.environ.setdefault("APP_ADMIN_PASSWORD", "NhapHang123@")
os.environ.setdefault("AGENT_ADMIN_PASSWORD", "NhapHang123")
