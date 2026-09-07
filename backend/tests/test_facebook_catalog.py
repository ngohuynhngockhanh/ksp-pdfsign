from __future__ import annotations

import httpx


def test_public_catalog_has_exactly_three_allowlisted_web_products(monkeypatch):
    from app import facebook_catalog

    pages = {
        "https://inut.vn/solutions/p/rs485-gateway": "Giá niêm yết từ <strong>2.250.000<!-- -->đ</strong>",
        "https://inut.vn/solutions/p/datalogger-cong-nghiep": "Giá niêm yết từ <strong>4.687.500<!-- -->đ</strong>",
        "https://inut.vn/solutions/billiard-live": "Khảo sát &amp; báo giá theo quy mô CLB",
    }

    def fake_get(url, **kwargs):
        assert url in pages
        return httpx.Response(200, request=httpx.Request("GET", url), text=pages[url])

    monkeypatch.setattr(facebook_catalog.httpx, "get", fake_get)
    facebook_catalog.clear_cache()
    entries = facebook_catalog.fetch_public_catalog(force=True)

    assert len(entries) == 3
    assert {entry["url"] for entry in entries} == set(pages)
    assert entries[0]["price_text"] == "2.250.000đ"
    assert entries[1]["price_text"] == "4.687.500đ"
    assert entries[2]["price_text"] == "Liên hệ báo giá theo quy mô"


def test_public_catalog_never_falls_back_to_internal_price(monkeypatch):
    from app import facebook_catalog

    def failed_get(url, **kwargs):
        raise httpx.ConnectError("offline", request=httpx.Request("GET", url))

    monkeypatch.setattr(facebook_catalog.httpx, "get", failed_get)
    facebook_catalog.clear_cache()
    entries = facebook_catalog.fetch_public_catalog(force=True)

    assert len(entries) == 3
    assert all(entry["price_text"] == "Chưa đọc được giá công khai" for entry in entries)
    assert all("nội bộ" not in entry["price_text"].casefold() for entry in entries)


def test_matching_products_rejects_internal_inventory_names():
    from app import facebook_catalog

    entries = [{
        "key": "rs485",
        "name": "iNut RS485",
        "url": "https://inut.vn/solutions/p/rs485-gateway",
        "aliases": ("inut rs485", "rs485"),
        "price_text": "2.250.000đ",
        "source": "public-web",
    }]

    assert facebook_catalog.matching_products("module A76 bao nhiêu tiền", entries) == []
    assert facebook_catalog.matching_products("iNut RS485 bao nhiêu tiền", entries) == entries


def test_matching_products_uses_product_boundaries_and_common_aliases():
    from app import facebook_catalog

    entries = [{
        "key": "rs485",
        "name": "iNut RS485",
        "url": "https://inut.vn/solutions/p/rs485-gateway",
        "aliases": ("inut rs485", "rs485", "rs 485"),
        "price_text": "2.250.000đ",
        "source": "public-web",
    }, {
        "key": "billiard",
        "name": "iNut BilliardLive",
        "url": "https://inut.vn/solutions/billiard-live",
        "aliases": ("inut billiardlive", "billiardlive", "billiard live"),
        "price_text": "Liên hệ báo giá theo quy mô",
        "source": "public-web",
    }]

    assert facebook_catalog.matching_products("rs485a bao nhiêu tiền", entries) == []
    assert facebook_catalog.matching_products("Billiard Live bao nhiêu tiền", entries) == [entries[1]]


def test_generic_livestream_does_not_guess_billiard_product():
    from app import facebook_catalog

    entries = [{
        "key": "billiard",
        "name": "iNut BilliardLive",
        "url": "https://inut.vn/solutions/billiard-live",
        "aliases": ("inut billiardlive", "billiardlive", "billiard live", "billiard", "bida", "check var"),
        "price_text": "Liên hệ báo giá theo quy mô",
        "source": "public-web",
    }]

    assert facebook_catalog.matching_products("Tôi muốn livestream", entries) == []
    assert facebook_catalog.suggested_products("Tôi muốn livestream", entries) == []
    assert [item["key"] for item in facebook_catalog.suggested_products("Livestream CLB bida", entries)] == ["billiard"]


def test_catalog_formatters_ignore_non_allowlisted_entries():
    from app import facebook_catalog

    entries = [{
        "key": "internal",
        "name": "Module A76",
        "url": "https://ksp-pdf-signer.p2p.inut.io.vn/api/inventory",
        "aliases": ("module a76",),
        "price_text": "9.999.999đ",
        "source": "internal-db",
    }]

    assert facebook_catalog.matching_products("module A76 giá", entries) == []
    assert "Module A76" not in facebook_catalog.format_catalog(entries)
    assert "9.999.999" not in facebook_catalog.format_matches(entries)


def test_public_price_query_detects_mixed_unknown_product_terms():
    from app import facebook_catalog

    assert facebook_catalog.has_unknown_price_terms("module A76 và iNut RS485 bao nhiêu tiền")
    assert not facebook_catalog.has_unknown_price_terms("mua iNut RS485 bao nhiêu tiền")
    assert not facebook_catalog.has_unknown_price_terms("iNut Datalogger giá niêm yết")


def test_sales_catalog_uses_benefit_led_copy_and_one_discovery_prompt():
    from app import facebook_catalog

    entries = [{
        "key": "rs485",
        "name": "iNut RS485",
        "url": "https://inut.vn/solutions/p/rs485-gateway",
        "aliases": ("inut rs485", "rs485"),
        "price_text": "2.250.000đ",
        "source": "public-web",
    }]

    reply = facebook_catalog.format_sales_catalog(entries)

    assert "kết nối" in reply.casefold()
    assert "https://inut.vn/solutions/p/rs485-gateway" in reply
    assert "Bạn đang giải quyết" in reply
    assert "bao nhiêu thiết bị" not in reply
    assert "thời gian nào" not in reply


def test_sales_price_reply_adds_public_price_and_qualification_question():
    from app import facebook_catalog

    entries = [{
        "key": "rs485",
        "name": "iNut RS485",
        "url": "https://inut.vn/solutions/p/rs485-gateway",
        "aliases": ("inut rs485", "rs485"),
        "price_text": "2.250.000đ",
        "source": "public-web",
    }]

    reply = facebook_catalog.format_matches(entries)

    assert "từ 2.250.000đ" in reply
    assert "Bạn đang kết nối thiết bị nào" in reply


def test_price_discovery_is_consultative_for_vague_price_question():
    from app import facebook_catalog

    entries = [{
        "key": "rs485",
        "name": "iNut RS485",
        "url": "https://inut.vn/solutions/p/rs485-gateway",
        "aliases": ("inut rs485", "rs485"),
        "price_text": "2.250.000đ",
        "source": "public-web",
    }, {
        "key": "datalogger",
        "name": "iNut Datalogger / iNut PC",
        "url": "https://inut.vn/solutions/p/datalogger-cong-nghiep",
        "aliases": ("inut datalogger", "datalogger"),
        "price_text": "4.687.500đ",
        "source": "public-web",
    }]

    reply = facebook_catalog.format_price_discovery(entries)

    assert "cần biết bạn đang hỏi sản phẩm nào" in reply
    assert "iNut RS485" in reply
    assert "Datalogger" in reply
    assert "chỉ tra giá công khai" not in reply.casefold()


def test_unknown_product_price_returns_warm_staff_handoff():
    from app import facebook_catalog

    reply = facebook_catalog.format_unknown_product_price("Module A76 bao nhiêu tiền?")

    assert "chưa thấy giá" in reply.casefold()
    assert "nhân viên iNut" in reply
    assert "xác nhận" in reply
    assert "hóa đơn" not in reply.casefold()


def test_product_consultation_and_link_are_benefit_led_without_unrequested_price():
    from app import facebook_catalog

    entry = {
        "key": "datalogger",
        "name": "iNut Datalogger / iNut PC",
        "url": "https://inut.vn/solutions/p/datalogger-cong-nghiep",
        "aliases": ("inut datalogger", "datalogger"),
        "price_text": "4.687.500đ",
        "source": "public-web",
    }

    consultation = facebook_catalog.format_product_consultation(entry)
    link = facebook_catalog.format_product_link(entry)

    assert "thu thập, lưu trữ và xử lý dữ liệu" in consultation
    assert entry["url"] in consultation
    assert "4.687.500" not in consultation
    assert "phù hợp nếu bạn cần" not in consultation
    assert "Bạn xem thông tin tại" not in consultation
    assert entry["url"] in link
    assert "Mình gửi bạn link" in link


def test_consultation_echoes_the_customer_problem_instead_of_a_brochure():
    from app import facebook_catalog

    entry = {
        "key": "datalogger",
        "name": "iNut Datalogger / iNut PC",
        "url": "https://inut.vn/solutions/p/datalogger-cong-nghiep",
        "aliases": ("inut datalogger", "datalogger"),
        "price_text": "4.687.500đ",
        "source": "public-web",
    }

    reply = facebook_catalog.format_product_consultation(
        entry, question="Mình cần kết nối PLC Siemens khoảng 20 máy",
    )

    assert "PLC Siemens" in reply
    assert "20 máy" in reply
    assert "phù hợp nếu bạn cần" not in reply
    assert "thường dùng cho" not in reply
    assert "mình" in reply.casefold()


def test_problem_hook_prefers_device_scale_over_an_earlier_count():
    from app import facebook_catalog

    entry = {
        "key": "datalogger",
        "name": "iNut Datalogger / iNut PC",
        "url": "https://inut.vn/solutions/p/datalogger-cong-nghiep",
        "aliases": ("inut datalogger", "datalogger"),
        "price_text": "4.687.500đ",
        "source": "public-web",
    }

    reply = facebook_catalog.format_product_consultation(
        entry, question="Mình có 3 cái cảm biến, cần kết nối PLC Siemens khoảng 20 máy",
    )

    assert "PLC Siemens" in reply
    assert "20 máy" in reply
    assert "3 cái" not in reply


def test_problem_hook_understands_unaccented_messenger_vietnamese():
    from app import facebook_catalog

    entry = {
        "key": "datalogger",
        "name": "iNut Datalogger / iNut PC",
        "url": "https://inut.vn/solutions/p/datalogger-cong-nghiep",
        "aliases": ("inut datalogger", "datalogger"),
        "price_text": "4.687.500đ",
        "source": "public-web",
    }

    reply = facebook_catalog.format_product_consultation(
        entry, question="Minh can ket noi PLC Siemens khoang 20 may",
    )

    assert "PLC Siemens" in reply
    assert "20 máy" in reply


def test_purchase_consultation_echoes_the_customer_problem():
    from app import facebook_catalog

    entry = {
        "key": "datalogger",
        "name": "iNut Datalogger / iNut PC",
        "url": "https://inut.vn/solutions/p/datalogger-cong-nghiep",
        "aliases": ("inut datalogger", "datalogger"),
        "price_text": "4.687.500đ",
        "source": "public-web",
    }

    reply = facebook_catalog.format_purchase_consultation(
        entry, question="Mình muốn mua iNut Datalogger cho PLC Siemens 20 máy",
    )

    assert "có thể phù hợp" in reply
    assert "PLC Siemens" in reply
    assert "20 máy" in reply
    assert "4.687.500" not in reply


def test_follow_up_helpers_detect_details_and_answered_discovery():
    from app import facebook_catalog

    assert facebook_catalog.looks_like_follow_up_details("PLC Siemens khoảng 20 điểm") is True
    assert facebook_catalog.looks_like_follow_up_details("20 điểm") is True
    assert facebook_catalog.looks_like_follow_up_details("Xin chào") is False
    assert facebook_catalog.discovery_already_answered(
        "PLC Siemens khoảng 20 điểm", "rs485",
    ) is True
    assert facebook_catalog.discovery_already_answered("Tôi cần 5 bộ iNut RS485", "rs485") is False


def test_single_price_reply_is_a_chat_line_not_a_catalog_dump():
    from app import facebook_catalog

    entries = [{
        "key": "rs485",
        "name": "iNut RS485",
        "url": "https://inut.vn/solutions/p/rs485-gateway",
        "aliases": ("inut rs485", "rs485"),
        "price_text": "2.250.000đ",
        "source": "public-web",
    }]

    reply = facebook_catalog.format_matches(entries)

    assert "từ 2.250.000đ" in reply
    assert "Bạn đang kết nối thiết bị nào" in reply
    assert "\n-" not in reply
    assert not any(line.lstrip().startswith("- ") for line in reply.splitlines())


def test_solution_hints_suggest_a_public_product_without_infering_price():
    from app import facebook_catalog

    entries = [{
        "key": "datalogger",
        "name": "iNut Datalogger / iNut PC",
        "url": "https://inut.vn/solutions/p/datalogger-cong-nghiep",
        "aliases": ("inut datalogger", "datalogger"),
        "price_text": "4.687.500đ",
        "source": "public-web",
    }, {
        "key": "rs485",
        "name": "iNut RS485",
        "url": "https://inut.vn/solutions/p/rs485-gateway",
        "aliases": ("inut rs485", "rs485"),
        "price_text": "2.250.000đ",
        "source": "public-web",
    }]

    result = facebook_catalog.suggested_products(
        "Tôi cần kết nối PLC Siemens khoảng 20 máy", entries,
    )

    assert [item["key"] for item in result] == ["datalogger"]


def test_custom_order_and_demo_formatters_stay_consultative():
    from app import facebook_catalog

    entry = {
        "key": "rs485",
        "name": "iNut RS485",
        "url": "https://inut.vn/solutions/p/rs485-gateway",
        "aliases": ("inut rs485", "rs485"),
        "price_text": "2.250.000đ",
        "source": "public-web",
    }

    custom = facebook_catalog.format_custom_order_handoff(entry)
    demo = facebook_catalog.format_demo_discovery(entry)

    assert "nhân viên" in custom.casefold()
    assert "2.250.000" not in custom
    assert "số lượng/điểm đo" in custom
    assert entry["url"] in demo
    assert "Bạn muốn demo" in demo


def test_custom_order_handoff_has_one_discovery_question():
    from app import facebook_catalog

    entry = {
        "key": "rs485",
        "name": "iNut RS485",
        "url": "https://inut.vn/solutions/p/rs485-gateway",
        "aliases": ("inut rs485", "rs485"),
        "price_text": "2.250.000đ",
        "source": "public-web",
    }

    reply = facebook_catalog.format_custom_order_handoff(entry)

    assert "Mình hiểu bạn đang" not in reply
    assert reply.count("Bạn cho mình biết") == 1
