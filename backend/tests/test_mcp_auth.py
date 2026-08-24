from pathlib import Path

from starlette.requests import Request

from app.auth import authenticate_mcp_bearer
from app.db import User
from app.security import hash_password


def _request(authorization: str, host: str = "127.0.0.1") -> Request:
    return Request({
        "type": "http",
        "method": "GET",
        "path": "/internal/mcp/session",
        "headers": [(b"authorization", authorization.encode())],
        "client": (host, 1234),
        "server": ("127.0.0.1", 2032),
    })


def test_mcp_bearer_auth_is_loopback_only_and_maps_to_admin(tmp_path, monkeypatch, db):
    token_file = Path(tmp_path) / "mcp.token"
    token_file.write_text("unit-mcp-token")
    monkeypatch.setenv("INUT_CRM_MCP_TOKEN_FILE", str(token_file))
    admin = User(username="mcp-admin", password_hash=hash_password("unused"), role="admin")
    db.add(admin)
    db.commit()
    db.refresh(admin)

    current = authenticate_mcp_bearer(_request("Bearer unit-mcp-token"), db)
    assert current is not None
    assert current.id == admin.id
    assert current.role == "admin"

    assert authenticate_mcp_bearer(_request("Bearer unit-mcp-token", "192.168.1.5"), db) is None
    assert authenticate_mcp_bearer(_request("Bearer wrong"), db) is None
