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
- Engine `plan_net_target` tu dua tien an ve dung tran, sau do tu tinh du dia lam them con lai trong gioi han 40 gio/thang.
- Nguoi dung chi nhap muc thuc linh; khong can tu nhap so gio de he thong lap de xuat.
- Neu file da co qua 40 gio lam them/thang, he thong canh bao va khong tu cong them gio.
- Che do tu dong dua file vuot tran ve mau 32 gio ngay thuong + 8 gio ngay nghi hang tuan; ke toan van phai doi chieu bang cham cong that.
- Tuy chon `allow_taxable_bonus` gross-up phan thieu bang thuong hieu qua kinh doanh chiu TNCN de khop thuc linh; khong lam tang nen BHXH neu khoan thuong bien dong co KPI/quyet dinh rieng.
- Thuong chuyen can, hoan chi dien thoai va xang xe khong duoc tu dong cong de dat muc thuc linh.
- Neu du dia hop phap khong du, API tra `feasible=false` va `shortfall`; UI khong cho ap dung de tranh tao so lieu khong co can cu.
- Che do mac dinh giu nguyen TNCN va BHXH; che do thuong chiu thue hien ro phan TNCN tang, con BHXH giu nguyen theo gia dinh thuong KPI bien dong co ho so hop le.
- Bang `cashflows` tom tat tien an, lam them, gross, TNCN, BHXH, thuc linh va tong chi phi cong ty.
- Mau xanh la khoan co loi cho nguoi lao dong; mau do la chi phi cong ty tang; mau trung tinh la khoan khong doi.
- Nut ap dung chi dien de xuat vao form. Nguoi dung van phai luu nhap, chay review, sau do moi gui ban moi len Drive.

## Quyet toan TNCN cuoi nam

- Thue TNCN khau tru theo tung thang la so tam tinh, khong phai nghia vu cuoi cung cua ca nam.
- Cuoi nam phai cong thu nhap chiu thue, cac khoan giam tru va so thue da khau tru de xac dinh nop them hoac xu ly so nop thua.
- Cong ty chi quyet toan thay khi nguoi lao dong du dieu kien va co uy quyen theo quy dinh.
- Neu ca nhan yeu cau giam tru chi phi giao duc thi ca nhan tu quyet toan; bang luong thang khong tu dong tru khoan nay.
- Giam tru giao duc toi da 24 trieu dong/nam, theo chi phi thuc te co hoa don, chung tu tai co so giao duc trong nuoc va khong duoc nguon khac hoan tra.
- Doi chieu file da sync tu thang 1 den thang 7/2026: hai nhan vien duoc kiem tra dang co thue TNCN tam khau tru 0 dong va chua thay thieu thue theo tong thu nhap hien co. Can tinh lai khi co du thu nhap, thuong va giam tru tu thang 8 den thang 12.

## Tong quan HR va so thanh toan

- `GET /api/payroll/hr-summary?year=2026` tong hop mot ban luong hien hanh cho moi thang, khong cong trung cac file cu.
- Giao dien khong tao them ky luong thu cong; danh sach, bieu do va so HR lay tu file Excel da sync/parse.
- He thong tu tao ho so HR va ghep ten Excel theo dang chuan hoa; dong tieu de, thu viec va dong tong khong duoc nhan la nhan vien.
- So thanh toan tach khoi so thuc linh trong Excel. Chi giao dich `completed` moi cong vao da tra; giao dich sai phai huy co ly do.
- Thanh toan hoan tat thieu PDF/PNG/JPG duoc cong vao da tra nhung hien canh bao thieu chung tu.
- Dong dang co ban nhap da review hoac da upload nhung chua sync lai bi khoa ghi thanh toan de tranh chuyen sai so.
- TNCN nam hien ba lop: da khau tru, nghia vu tam tinh nam va chenh lech du kien. So nay chi dua tren du lieu cong ty dang quan ly.
- Chung tu toi da 10 MB, kiem tra phan mo rong, MIME va chu ky tep; chi admin duoc tai len hoac tai xuong.
- Khu vuc `Bieu do luong va thue` cho phep chon nhieu nhan vien cung luc; mac dinh hien tat ca.
- Moi nhan vien co hai bieu do theo thang: tong thu nhap/thuc linh va BHXH nguoi lao dong/BHXH cong ty dong/TNCN.
- Tren dien thoai, hai bieu do xep doc va chi vung bieu do cuon ngang; bang so chi tiet van hien gia tri 0 de tranh hieu nham la thieu du lieu.

Payload mau:

```json
{
  "row": 15,
  "target_net": 20000000,
  "allow_taxable_bonus": true
}
```

## Nguon chinh thuc da doi chieu

- https://xaydungchinhsach.chinhphu.vn/noi-dung-chinh-cua-luat-thue-thu-nhap-ca-nhan-so-109-2025-qh15-119260123144204743.htm
- https://xaydungchinhsach.chinhphu.vn/nghi-quyet-110-2025-ubtvqh15-dieu-chinh-muc-giam-tru-gia-canh-cua-thue-thu-nhap-ca-nhan-119251110101313787.htm
- https://baochinhphu.vn/cac-truong-hop-tien-luong-tien-cong-duoc-mien-thue-tncn-102260715163431228.htm
- https://xaydungchinhsach.chinhphu.vn/nghi-dinh-158-2025-nd-cp-quy-dinh-moi-ve-bao-hiem-xa-hoi-bat-buoc-119250626172814006.htm
- https://xaydungchinhsach.chinhphu.vn/danh-muc-dia-ban-ap-dung-muc-luong-toi-thieu-tu-ngay-01-01-2026-11925111017422725.htm
