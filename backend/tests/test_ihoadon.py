from types import SimpleNamespace

from app import ihoadon


def _settings():
    return SimpleNamespace(
        ihoadon_base_url="https://example.test",
        ihoadon_tax_code="4401053694",
        ihoadon_username="user",
        ihoadon_password="pass",
        ihoadon_timeout=10,
    )


class FakeResponse:
    status_code = 200

    def __init__(self, data):
        self._data = data

    def json(self):
        return {"status": "success", "code": "IWS001", "data": self._data}


class FakeHTTP:
    def close(self):
        pass

    def post(self, url, json=None, headers=None):
        if url.endswith("/api/login"):
            return FakeResponse({"access_token": "token", "account": {"name": "INUT"}})
        if url.endswith("/api/invoices"):
            return FakeResponse({"invoice": {"id": "draft-1", "status": "GHI_TAM"}})
        raise AssertionError(url)

    def get(self, url, params=None, headers=None):
        params = dict(params or [])
        if url.endswith("/api/templates"):
            return FakeResponse({"templates": [{
                "id": "tpl-1", "template_code": "1", "invoice_series": "C26TPK",
                "status": "HOAT_DONG", "is_decree_new": True,
            }]})
        if url.endswith("/api/invoices"):
            status = params.get("filter_groups[0][filters][0][value]", "")
            totals = {"": 238, "GHI_TAM": 3, "DA_XUAT": 22, "GIU_SO": 0}
            return FakeResponse({"meta": {"total": totals[status]}, "invoices": []})
        raise AssertionError(url)


def test_dashboard_counts():
    client = ihoadon.Client(_settings())
    client._http.close()
    client._http = FakeHTTP()
    result = client.dashboard()
    assert result["account_name"] == "INUT"
    assert result["total"] == 238
    assert result["draft"] == 3
    assert result["issued"] == 22


def test_create_draft_uses_current_template():
    client = ihoadon.Client(_settings())
    client._http.close()
    client._http = FakeHTTP()
    result = client.create_draft({"other_id": "ksp-1", "invoice_products": []})
    assert result == {
        "id": "draft-1", "other_id": "ksp-1", "status": "GHI_TAM",
        "template_code": "1", "invoice_series": "C26TPK",
        "web_url": "https://example.test/system/vat-invoice",
    }
