# inut-crm MCP

`inut-crm` là MCP Gateway cục bộ cho KSP. Gateway bind tại `127.0.0.1:2037` và gọi REST backend KSP tại `127.0.0.1:2032` bằng session owner; không mở cổng LAN/WAN.

## Transports

- Codex: Streamable HTTP `http://127.0.0.1:2037/mcp`
- agy: SSE `http://127.0.0.1:2037/sse`
- Diagnostics: `/health` và `/tools`

## Cài đặt

```bash
cp .env.example .env
# Đặt APP_ADMIN_PASSWORD hợp lệ trong .env
./scripts/install-inut-crm-mcp.sh
./scripts/verify-inut-crm-mcp.sh
```

Installer tạo token tại `~/.config/inut-crm/inut-crm.token` với quyền `0600`, cài user service và đăng ký cả Codex lẫn agy. Token không được commit hoặc in ra terminal.

## Quy tắc gọi tool

Tool đọc chạy trực tiếp. Tool ghi dùng hai bước:

1. Gọi `mode=prepare` để nhận preview và `confirmation_token`.
2. Gọi lại cùng payload với `mode=execute`, `confirm=true`, token chưa hết hạn.

Token xác nhận dùng một lần và bị vô hiệu khi gateway restart. Thao tác high-risk như ký số, đồng bộ thuế/hóa đơn, gửi Telegram, in SPX, NAS sync và xóa dữ liệu luôn được audit.

Mọi kết quả có `status`, `summary`, `data`, `next_actions`, `artifacts` và `meta`. Dữ liệu e-GP/AI fallback được đánh dấu rõ là `mock`, `cache` hoặc `heuristic`.

## Kiểm tra nhanh

```bash
codex mcp list
agy mcp list
systemctl --user status inut-crm-mcp.service --no-pager
```

Không expose qua MCP các webhook inbound, public share page, raw SQL, shell hoặc endpoint tùy ý.
