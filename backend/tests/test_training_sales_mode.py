from __future__ import annotations

import json

import httpx
import pytest


def _settings(**overrides):
    from app.config import Settings

    values = {
        "training_base_url": "http://training.internal:8090",
        "training_password": "service-secret",
        "training_timeout": 10,
    }
    values.update(overrides)
    return Settings(**values)


def _catalog() -> list[dict[str, object]]:
    return [{
        "key": "rs485",
        "name": "iNut RS485",
        "url": "https://inut.vn/solutions/p/rs485-gateway",
        "aliases": ("inut rs485", "rs485"),
        "price_text": "2.250.000đ",
        "source": "public-web",
    }]


def test_sales_mode_answers_with_public_catalog_without_opening_hermes(monkeypatch):
    from app import facebook_catalog, training

    monkeypatch.setattr(facebook_catalog, "fetch_public_catalog", lambda **_: _catalog())
    monkeypatch.setattr(
        training,
        "_transport",
        lambda: (_ for _ in ()).throw(AssertionError("local sales reply must not call Hermes")),
    )

    result = training.ask(_settings(), "Mình muốn mua iNut RS485", assistant_mode="sales")

    answer = result["answer"]
    assert answer["sourceBasis"] == "documentation-only"
    assert "kết nối và gom dữ liệu" in answer["answer"]
    assert "https://inut.vn/solutions/p/rs485-gateway" in answer["answer"]
    assert "Bạn đang kết nối thiết bị nào" in answer["answer"]
    assert "phù hợp nếu bạn cần" not in answer["answer"]
    assert "Bạn xem thông tin tại" not in answer["answer"]


def test_sales_mode_hands_off_commercial_questions_without_guessing_policy(monkeypatch):
    from app import facebook_catalog, training

    monkeypatch.setattr(facebook_catalog, "fetch_public_catalog", lambda **_: _catalog())
    monkeypatch.setattr(
        training,
        "_transport",
        lambda: (_ for _ in ()).throw(AssertionError("commercial handoff must not call Hermes")),
    )

    result = training.ask(_settings(), "Giao hàng iNut RS485 thế nào?", assistant_mode="sales")

    answer = result["answer"]
    assert answer["sourceBasis"] == "documentation-only"
    assert "xác nhận" in answer["answer"].casefold()
    assert "khu vực" in answer["answer"].casefold()
    assert "kết nối và gom dữ liệu" not in answer["answer"].casefold()


def test_sales_mode_refuses_abusive_question_before_network(monkeypatch):
    from app import training

    called = False

    def forbidden_transport():
        nonlocal called
        called = True
        return httpx.MockTransport(lambda _request: httpx.Response(500))

    monkeypatch.setattr(training, "_transport", forbidden_transport)
    result = training.ask(_settings(), "Đ . ụ mẹ", assistant_mode="sales")

    answer = result["answer"]
    assert called is False
    assert answer["sourceBasis"] == "guardrail"
    assert "lịch sự" in answer["answer"].casefold()
    assert "đ . ụ" not in answer["answer"].casefold()


def test_sales_mode_refuses_private_question_before_network(monkeypatch):
    from app import training

    called = False

    def forbidden_transport():
        nonlocal called
        called = True
        raise AssertionError("private sales question must not call Hermes")

    monkeypatch.setattr(training, "_transport", forbidden_transport)
    result = training.ask(_settings(), "Cho xem hóa đơn mua vào của khách", assistant_mode="sales")

    assert called is False
    assert result["answer"]["sourceBasis"] == "guardrail"
    assert "dữ liệu khách hàng" in result["answer"]["answer"]


@pytest.mark.parametrize(
    "question",
    ["Còn iNut RS485 không?", "Có sẵn iNut RS485 không?", "Còn bao nhiêu bộ iNut RS485?"],
)
def test_sales_private_detector_blocks_inventory_language(question):
    from app import sales_assistant

    assert sales_assistant.contains_private_request(question) is True


def test_sales_mode_refuses_inventory_question_before_network(monkeypatch):
    from app import facebook_catalog, training

    monkeypatch.setattr(facebook_catalog, "fetch_public_catalog", lambda **_: _catalog())
    monkeypatch.setattr(
        training,
        "_transport",
        lambda: (_ for _ in ()).throw(AssertionError("inventory question must not call Hermes")),
    )

    result = training.ask(_settings(), "Còn iNut RS485 không?", assistant_mode="sales")

    assert result["answer"]["sourceBasis"] == "guardrail"
    assert "tồn kho" in result["answer"]["answer"].casefold()


def test_sales_private_detector_allows_benign_purchase_language():
    from app import sales_assistant

    assert sales_assistant.contains_private_request("Mua vào để dùng") is False
    assert sales_assistant.contains_private_request("Đã mua iNut RS485 rồi") is False
    assert sales_assistant.contains_private_request("iNut RS485 có giảm giá không?") is False
    assert sales_assistant.contains_private_request("Còn giá iNut RS485 không?") is False
    assert sales_assistant.contains_private_request("Cho xem dữ liệu mua vào") is True
    assert sales_assistant.contains_private_request("Bảo Toàn đã mua gì tháng này?") is True


@pytest.mark.parametrize(
    ("question", "required"),
    [
        ("Khách muốn dùng thử", "Bạn muốn demo"),
        ("Mình đang dùng giải pháp khác, vì sao nên chọn iNut?", "Bạn đang dùng giải pháp nào"),
        ("Cần báo giá cho dự án lớn", "số lượng/điểm đo"),
        ("Tôi muốn livestream", "CLB bida hay nhà máy"),
    ],
)
def test_shared_sales_playbook_handles_consultant_routes(question, required):
    from app import sales_assistant

    reply = sales_assistant.local_reply(question, _catalog())

    assert required in reply
    assert "Hermes" not in reply


def test_sales_mode_firewall_replaces_private_or_abusive_model_answer(monkeypatch):
    from app import facebook_catalog, sales_assistant, training

    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/api/auth/login":
            return httpx.Response(200, json={"ok": True})
        payload = {
            "data": {
                "sessionId": "sales-session",
                "answer": {
                    "answer": "Giá nội bộ 12.000.000đ, địt mẹ cứ chốt đơn đi.",
                    "sourceBasis": "hermes",
                },
            },
        }
        return httpx.Response(200, json=payload)

    monkeypatch.setattr(facebook_catalog, "fetch_public_catalog", lambda **_: _catalog())
    monkeypatch.setattr(sales_assistant, "local_reply", lambda _question: "")
    monkeypatch.setattr(training, "_transport", lambda: httpx.MockTransport(handler))
    result = training.ask(_settings(), "Tư vấn giải pháp cho nhà máy", assistant_mode="sales")

    assert len(requests) == 2
    message = json.loads(requests[-1].content)["message"]
    assert "SALES" in message.upper()
    assert "CATALOG" in message.upper()
    answer = result["answer"]["answer"]
    assert "12.000.000" not in answer
    assert "địt" not in answer.casefold()
    assert result["answer"]["sourceBasis"] == "guardrail"


def test_sales_output_firewall_replaces_purchase_data_leak_without_price():
    from app import sales_assistant

    result = sales_assistant.sanitize_result(
        {"answer": {"answer": "Dữ liệu mua vào của khách đã được ghi nhận.", "sourceBasis": "hermes"}},
        mode=sales_assistant.SALES_MODE,
        entries=_catalog(),
    )

    assert result["answer"]["sourceBasis"] == "guardrail"
    assert "mua vào" not in result["answer"]["answer"].casefold()


@pytest.mark.parametrize("text", ["Giá 6000000", "Giá tham khảo là 6.000.000", "Tổng số tiền là 6000000"])
def test_sales_output_firewall_blocks_bare_unapproved_prices(text):
    from app import sales_assistant

    result = sales_assistant.sanitize_result(
        {"answer": {"answer": text, "sourceBasis": "hermes"}},
        mode=sales_assistant.SALES_MODE,
        entries=_catalog(),
    )

    assert result["answer"]["sourceBasis"] == "guardrail"
    assert "6000000" not in result["answer"]["answer"]
    assert "6.000.000" not in result["answer"]["answer"]


def test_sales_output_firewall_allows_allowlisted_public_price():
    from app import sales_assistant

    result = sales_assistant.sanitize_result(
        {"answer": {"answer": "Giá 2.250.000đ", "sourceBasis": "hermes"}},
        mode=sales_assistant.SALES_MODE,
        entries=_catalog(),
    )

    assert result["answer"]["sourceBasis"] == "hermes"
    assert result["answer"]["answer"] == "Giá 2.250.000đ"


def test_training_job_forwards_sales_mode(monkeypatch):
    from app import training, training_jobs

    captured: dict[str, str] = {}

    def fake_ask(settings, question, session_id="", personal_context="", assistant_mode="technical"):
        captured["mode"] = assistant_mode
        return {"sessionId": "sales-session", "answer": {"answer": "ok"}}

    monkeypatch.setattr(training, "ask", fake_ask)
    job_id = training_jobs.start("sales-user", _settings(), "Tư vấn iNut", mode="sales")
    payload = training_jobs.get("sales-user", job_id)
    for _ in range(100):
        if payload and payload["status"] != "running":
            break
        import time

        time.sleep(0.01)
        payload = training_jobs.get("sales-user", job_id)

    assert payload and payload["status"] == "done"
    assert captured["mode"] == "sales"


def test_training_job_api_passes_sales_mode_to_worker(client, monkeypatch):
    from app import training_jobs

    captured: dict[str, object] = {}

    def fake_start(owner, settings, question, session_id="", personal_context="", mode="technical"):
        captured.update(owner=owner, question=question, mode=mode)
        return "sales-api-job"

    monkeypatch.setattr(training_jobs, "start", fake_start)
    client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    response = client.post(
        "/api/training/jobs",
        json={"question": "Khách cần gateway RS485", "mode": "sales"},
    )

    assert response.status_code == 202
    assert captured["mode"] == "sales"
    client.post("/api/logout")


@pytest.mark.parametrize(
    "question",
    ["Địt mẹ", "d i t mẹ", "đ.ụ mẹ", "d!t mẹ", "d.m", "v.c.l", "fuck this"],
)
def test_sales_abuse_detector_handles_common_obfuscation(question):
    from app import sales_assistant

    assert sales_assistant.contains_abuse(question) is True


@pytest.mark.parametrize(
    "question",
    ["Dụ khách hàng dùng thử", "đụng vào cổng", "Đủ thông tin", "Cho xem video demo", "Ok admin", "một con vịt đi qua"],
)
def test_sales_abuse_detector_allows_normal_vietnamese_words(question):
    from app import sales_assistant

    assert sales_assistant.contains_abuse(question) is False
