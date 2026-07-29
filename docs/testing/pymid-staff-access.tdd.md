# PYMID staff access - TDD evidence

## User journeys

- Tai khoan chinh PYMID tao tai khoan cho nhan vien trong khu vuc CO.OP.
- Nhan vien PYMID xem va thao tac CO.OP nhung khong xem ho so, hoa don, ZIP hay chu ky.
- Khach hang khac va tai khoan con khong duoc quan ly nhan vien PYMID.

## Evidence

| Guarantee | Test | Type | Result |
|---|---|---|---|
| PYMID tao duoc tai khoan `pymid_staff` va tai khoan moi dang nhap duoc | `backend/tests/test_pymid_coop.py` | Integration | PASS |
| Tai khoan con bi chan khoi API ho so, hoa don va ZIP | `backend/tests/test_pymid_coop.py` | Authorization integration | PASS |
| Khach hang khac va tai khoan con khong quan ly duoc nhan vien PYMID | `backend/tests/test_pymid_coop.py` | Security integration | PASS |
| Tai khoan con bi dieu huong ve CO.OP va khong thay menu ho so | `frontend/e2e/pymid-coop.spec.ts` | E2E desktop/mobile | PASS |
| Tai khoan chinh tao nhan vien tren giao dien CO.OP | `frontend/e2e/pymid-coop.spec.ts` | E2E desktop/mobile | PASS |

## RED/GREEN record

- RED: `python -m pytest -q backend/tests/test_pymid_coop.py` tra 2 loi do `/api/pymid/staff` chua ton tai.
- RED: Playwright giu nhan vien tai `/ho-so-cua-toi` thay vi chuyen ve `/pymid-coop`.
- GREEN: 22 backend tests lien quan tai khoan/API/PYMID deu pass.
- GREEN: 4 Playwright tests pass tren desktop va mobile.
- Build: TypeScript va Vite production build pass.

## Known gaps

- Pham vi hien tai la tao va liet ke tai khoan con. Reset mat khau hoặc thu hoi tai khoan con co the bo sung trong dot sau.
- Bo test muc tieu khong do coverage toan repo; cac nhanh phan quyen moi duoc test truc tiep bang integration va E2E.
