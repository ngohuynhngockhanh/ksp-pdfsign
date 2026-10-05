"""Client cho phan quan ly hoa don ban ra tren ihoadon.com.vn.

Chi thao tac voi hoa don GHI_TAM va cac API doc. Module nay khong co ham ky,
giu so hay phat hanh de tranh vo tinh bien ban nhap thanh hoa don phap ly.
"""
from __future__ import annotations

import base64
from typing import Any

import httpx


class IhoadonError(RuntimeError):
    pass


class Client:
    def __init__(self, settings):
        self.base_url = settings.ihoadon_base_url.rstrip("/")
        self.tax_code = settings.ihoadon_tax_code.strip()
        self.username = settings.ihoadon_username.strip()
        self.password = settings.ihoadon_password
        self.timeout = settings.ihoadon_timeout
        if not (self.base_url and self.tax_code and self.username and self.password):
            raise IhoadonError("Chưa cấu hình đầy đủ tài khoản iHOADON trong Cài đặt")
        self._http = httpx.Client(timeout=self.timeout, follow_redirects=True)
        self._token = ""

    def close(self) -> None:
        self._http.close()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()

    def login(self) -> dict:
        r = self._http.post(
            f"{self.base_url}/api/login",
            json={
                "tax_code": self.tax_code,
                "username": self.username,
                "password": self.password,
                "authen": "IHOADON",
            },
        )
        data = self._response(r)
        self._token = data.get("access_token", "")
        if not self._token:
            raise IhoadonError("iHOADON không trả access token")
        return data

    def _headers(self) -> dict[str, str]:
        if not self._token:
            self.login()
        return {
            "Authorization": f"Bearer {self._token}",
            "TaxCode": self.tax_code,
            "Accept": "application/json",
        }

    @staticmethod
    def _response(r: httpx.Response) -> Any:
        try:
            body = r.json()
        except ValueError as e:
            raise IhoadonError(f"iHOADON trả dữ liệu không hợp lệ (HTTP {r.status_code})") from e
        if r.status_code >= 400 or body.get("status") != "success":
            message = body.get("message") or body.get("code") or f"HTTP {r.status_code}"
            raise IhoadonError(str(message))
        return body.get("data")

    def get(self, path: str, params: list[tuple[str, str]] | None = None) -> Any:
        return self._response(
            self._http.get(f"{self.base_url}/api{path}", params=params, headers=self._headers())
        )

    def post(self, path: str, body: dict) -> Any:
        return self._response(
            self._http.post(f"{self.base_url}/api{path}", json=body, headers=self._headers())
        )

    @staticmethod
    def _status_params(status: str = "") -> list[tuple[str, str]]:
        if not status:
            return []
        return [
            ("filter_groups[0][filters][0][key]", "status"),
            ("filter_groups[0][filters][0][value]", status),
            ("filter_groups[0][filters][0][operator]", "eq"),
        ]

    def invoice_count(self, status: str = "") -> int:
        params = [("limit", "1"), ("page", "1"), *self._status_params(status)]
        data = self.get("/invoices", params)
        return int((data.get("meta") or {}).get("total") or 0)

    def dashboard(self) -> dict:
        login = self.login()
        return {
            "connected": True,
            "account_name": ((login.get("account") or {}).get("name") or ""),
            "tax_code": self.tax_code,
            "total": self.invoice_count(),
            "draft": self.invoice_count("GHI_TAM"),
            "issued": self.invoice_count("DA_XUAT"),
            "waiting": self.invoice_count("GIU_SO"),
            "web_url": f"{self.base_url}/system/vat-invoice",
        }

    def drafts(self, page: int = 1, limit: int = 30) -> dict:
        params = [
            ("limit", str(limit)),
            ("page", str(page)),
            ("includes[]", "template"),
            ("sort[0][key]", "created_at"),
            ("sort[0][direction]", "DESC"),
            *self._status_params("GHI_TAM"),
        ]
        data = self.get("/invoices", params)
        rows = []
        for inv in data.get("invoices") or []:
            template = inv.get("template") or {}
            rows.append({
                "id": inv.get("id"),
                "other_id": inv.get("other_id"),
                "customer_name": inv.get("customer_name") or inv.get("buyer_name") or "",
                "buyer_tax_code": inv.get("buyer_tax_code") or "",
                "total_payment": inv.get("total_payment") or 0,
                "created_at": inv.get("created_at") or "",
                "template_code": template.get("template_code") or inv.get("template_code") or "",
                "invoice_series": template.get("invoice_series") or inv.get("invoice_series") or "",
                "status": inv.get("status") or "",
            })
        return {"items": rows, "total": int((data.get("meta") or {}).get("total") or 0)}

    def invoice_detail(self, invoice_id: str) -> dict:
        data = self.get(f"/invoices/{invoice_id}")
        invoice = data.get("invoice", data) if isinstance(data, dict) else None
        if not isinstance(invoice, dict):
            raise IhoadonError("iHOADON không trả chi tiết hóa đơn")
        return invoice

    def issued_page(self, page: int = 1, limit: int = 100) -> dict:
        params = [
            ("limit", str(limit)),
            ("page", str(page)),
            ("sort[0][key]", "invoice_date"),
            ("sort[0][direction]", "DESC"),
            *self._status_params("DA_XUAT"),
        ]
        return self.get("/invoices", params)

    @staticmethod
    def _decode_file(data: Any, label: str) -> tuple[str, bytes]:
        if not isinstance(data, dict) or not data.get("file_content"):
            raise IhoadonError(f"iHOADON không trả file {label}")
        try:
            content = base64.b64decode(data["file_content"], validate=True)
        except (ValueError, TypeError) as e:
            raise IhoadonError(f"File {label} từ iHOADON không hợp lệ") from e
        return str(data.get("file_name") or label), content

    def invoice_pdf(self, invoice_id: str) -> tuple[str, bytes]:
        data = self.post(
            "/invoices/export-file-base-pdf",
            {"invoice": [invoice_id], "is_conversion": False},
        )
        if isinstance(data, list):
            data = data[0] if data else None
        return self._decode_file(data, "hoa-don.pdf")

    def invoice_xml_zip(self, invoice_id: str) -> tuple[str, bytes]:
        data = self.post("/invoices/export-file-zip-xml", {"invoice": [invoice_id]})
        return self._decode_file(data, "hoa-don-xml.zip")

    def active_template(self) -> dict:
        data = self.get("/templates", [("limit", "100"), ("page", "1")])
        templates = data.get("templates") or []
        active = [t for t in templates if t.get("status") == "HOAT_DONG"]
        current = next((t for t in active if t.get("is_decree_new")), None)
        current = current or (active[-1] if active else None)
        if not current:
            raise IhoadonError("Tài khoản chưa có mẫu hóa đơn hoạt động")
        return current

    def create_draft(self, invoice: dict) -> dict:
        template = self.active_template()
        invoice = {
            **invoice,
            "template_id": template.get("id"),
            "template_code": template.get("template_code"),
            "invoice_series": template.get("invoice_series"),
            "adjustment_type": "1",
        }
        # TT78 uses the /new API; the legacy endpoint rejects accounts migrated from TT32.
        endpoint = "/new/invoices" if template.get("is_decree_new") else "/invoices"
        payload = {
            key: value for key, value in invoice.items()
            if key not in {"other_id", "is_decree_new"}
        }
        data = self.post(endpoint, {"invoice": payload})
        created = data.get("invoice") if isinstance(data, dict) and data.get("invoice") else data
        if not isinstance(created, dict):
            created = {}
        return {
            "id": created.get("id"),
            "other_id": created.get("other_id") or invoice.get("other_id"),
            "status": created.get("status") or "GHI_TAM",
            "template_code": template.get("template_code"),
            "invoice_series": template.get("invoice_series"),
            "web_url": f"{self.base_url}/system/vat-invoice",
        }

    def send_invoice_email(self, invoice_id: str, emails: str | list[str]) -> dict:
        """Gửi email hóa đơn điện tử cho khách hàng qua iHOADON API.

        emails: chuỗi các email phân cách bởi dấu chấm phẩy (;) hoặc danh sách các email.
        """
        if isinstance(emails, (list, set, tuple)):
            email_str = ";".join(str(e).strip() for e in emails if str(e).strip())
        else:
            email_str = str(emails).strip()
        if not email_str:
            raise IhoadonError("Chưa cung cấp địa chỉ email người nhận")
        payload = {
            "invoices": [
                {
                    "id": invoice_id,
                    "email": email_str,
                }
            ]
        }
        res = self.post("/invoices-send-mail", payload)
        return res or {"status": "success", "invoice_id": invoice_id, "emails": email_str}
