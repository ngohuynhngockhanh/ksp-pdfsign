from app import accounts


def test_default_customer_credentials_prefer_tax_code_and_use_random_temp_password():
    assert accounts.default_username("Công ty Bảo Toàn", "0314360282", 8) == "0314360282"
    pw1 = accounts.default_password("0314360282")
    pw2 = accounts.default_password("0314360282")
    assert pw1 != "inut12345"
    assert pw2 != "inut12345"
    assert pw1 != pw2
    assert len(pw1) >= 12


def test_default_username_falls_back_to_company_slug():
    assert accounts.default_username("Công ty Xuân Cường", "", 9) == "cong_ty_xuan_cuong"
