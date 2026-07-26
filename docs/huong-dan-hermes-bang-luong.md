# Huong dan review module bang luong Viet Nam 2026

## Pham vi

Review code va du lieu gia lap. Khong doc, ghi nho, trich xuat ten nhan vien, tai khoan ngan hang hay muc luong that.

## Chinh sach can dung

- Luat Thue TNCN 109/2025/QH15 ap dung thu nhap tien luong nam 2026.
- Giam tru gia canh: ban than 15,5 trieu/thang; nguoi phu thuoc 6,2 trieu/thang.
- Bieu thue 5 bac: 5%, 10%, 20%, 30%, 35% tai cac moc 10, 30, 60, 100 trieu.
- Tien lam them gio hop phap duoc mien TNCN theo che do nam 2026.
- Tien an duoc mien toi da 1,2 trieu/thang tu 01/07/2026.
- BH nguoi lao dong 10,5%; BH doanh nghiep 21,5%; KPCD 2% tach rieng.
- Luong, phu cap va khoan bo sung on dinh ghi trong hop dong co the thuoc nen BHXH.
- Tuy Hoa thuoc vung III; luong toi thieu thang 2026 la 4,14 trieu.

## Kien truc

- Engine: `backend/app/payroll.py`.
- API va import Drive read-only: `backend/app/payroll_api.py`.
- Bang SQLite cong them: `payroll_employees`, `payroll_periods`, `payroll_lines`, `payroll_imports`.
- UI admin: `frontend/src/pages/Payroll.tsx`, route `/bang-luong`.
- Workflow bat bien sau khoa: `draft -> reviewed -> locked`.
- Override chi chap nhan khi co ly do va giu ket qua canonical de doi chieu.

## Tinh nang thuc linh muc tieu

- Endpoint: `POST /api/payroll/imports/{import_id}/net-target`.
- UI nam trong form sua tung nhan vien cua file Excel da sync.
- Engine `plan_net_target` chi phan bo phan tang qua du dia tien an mien thue va gio lam them thuc te.
- Gio lam them phai do nguoi dung khai theo bang cham cong/phe duyet; he thong khong tu tao gio.
- Thuong chuyen can, hoan chi dien thoai va xang xe khong duoc tu dong cong de dat muc thuc linh.
- Neu du dia hop phap khong du, API tra `feasible=false` va `shortfall`; UI khong cho ap dung de tranh tao so lieu khong co can cu.
- Ket qua luon doi chieu va giu nguyen TNCN, BHXH nguoi lao dong so voi file submit.
- Bang `cashflows` tom tat tien an, lam them, gross, TNCN, BHXH, thuc linh va tong chi phi cong ty.
- Mau xanh la khoan co loi cho nguoi lao dong; mau do la chi phi cong ty tang; mau trung tinh la khoan khong doi.
- Nut ap dung chi dien de xuat vao form. Nguoi dung van phai luu nhap, chay review, sau do moi gui ban moi len Drive.

Payload mau:

```json
{
  "row": 15,
  "target_net": 20000000,
  "available_weekday_ot_hours": 12,
  "available_weekend_ot_hours": 8
}
```

## Nguon chinh thuc da doi chieu

- https://xaydungchinhsach.chinhphu.vn/noi-dung-chinh-cua-luat-thue-thu-nhap-ca-nhan-so-109-2025-qh15-119260123144204743.htm
- https://xaydungchinhsach.chinhphu.vn/nghi-quyet-110-2025-ubtvqh15-dieu-chinh-muc-giam-tru-gia-canh-cua-thue-thu-nhap-ca-nhan-119251110101313787.htm
- https://baochinhphu.vn/cac-truong-hop-tien-luong-tien-cong-duoc-mien-thue-tncn-102260715163431228.htm
- https://xaydungchinhsach.chinhphu.vn/nghi-dinh-158-2025-nd-cp-quy-dinh-moi-ve-bao-hiem-xa-hoi-bat-buoc-119250626172814006.htm
- https://xaydungchinhsach.chinhphu.vn/danh-muc-dia-ban-ap-dung-muc-luong-toi-thieu-tu-ngay-01-01-2026-11925111017422725.htm
