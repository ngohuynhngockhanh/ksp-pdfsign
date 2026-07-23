from app import accounts


def test_default_customer_credentials_prefer_tax_code():
    assert accounts.default_username("Công ty Bảo Toàn", "0314360282", 8) == "0314360282"
    assert accounts.default_password("0314360282") == "inut12345"


def test_default_username_falls_back_to_company_slug():
    assert accounts.default_username("Công ty Xuân Cường", "", 9) == "cong_ty_xuan_cuong"
