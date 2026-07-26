# Bang luong 2026 - bang chung TDD

Du lieu test la du lieu gia lap, khong chua ten hay muc luong cua nhan vien that.

## RED

- Test dau tien that bai tai import `app.payroll` vi module chua ton tai.
- Checkpoint: `121be43 test(payroll): define 2026 payroll compliance workflow`.

## GREEN

- Kiem tra bieu thue TNCN 5 bac va giam tru 15,5/6,2 trieu.
- Kiem tra BH nguoi lao dong 10,5%, BH doanh nghiep 21,5%, KPCD 2%.
- Kiem tra tien an toi da 1,2 trieu tu 01/07/2026 va tien lam them duoc mien TNCN.
- Kiem tra workflow `draft -> reviewed -> locked`, khoa sua sau khi chot.
- Kiem tra override bat buoc co ly do.
- Kiem tra review Excel cu canh bao KPCD trong va tien an vuot tran.
- E2E Playwright dung nhan vien an danh: tao thang, review, khoa so.

## Lenh xac minh

```bash
cd backend && .venv/bin/python -m pytest -q
cd backend && .venv/bin/python -m pytest tests/test_payroll.py --cov=app.payroll --cov=app.payroll_api
cd frontend && npm run build
cd frontend && npm run test:e2e
```

## Bo sung so HR nam va thanh toan

- RED backend: `484e614` - thieu engine TNCN nam va API tong hop HR.
- RED E2E: `bdfa017` - chua co giao dien buc tranh HR, ghi thanh toan va bo sung chung tu.
- GREEN backend: 24 test pass; coverage `app.payroll` va `app.payroll_api` dat 85%.
- GREEN frontend: build pass; Playwright desktop/mobile 2/2 pass, kem axe WCAG A/AA.

| Dam bao | Test | Loai |
|---|---|---|
| Bieu thue nam duoc quy doi 12 thang va giam tru ban than 186 trieu | `test_annual_pit_uses_annualized_bands_and_full_year_self_deduction` | Unit |
| Moi thang chi cong phien ban Excel moi nhat va ghep ten da chuan hoa | `test_hr_summary_merges_normalized_names_and_ignores_older_month_version` | Integration |
| Thanh toan hoan tat cap nhat da tra, con lai, chung tu va huy giao dich | `test_hr_summary_tracks_paid_outstanding_and_annual_tax` | Integration |
| HR ghi thanh toan va tai chung tu tren desktop/mobile | `frontend/e2e/payroll.spec.ts` | E2E |

## Bo sung bieu do nhieu nhan vien

- RED E2E: `1e698b5` - chua co khu vuc bieu do, bo chon va chon lai nhan vien.
- Moi nhan vien duoc chon co mot hang rieng gom bieu do gross/thuc linh va BHXH/TNCN theo thang.
- Mac dinh chon tat ca; co nut `Chon tat ca`, `Bo chon` va thong bao tieng Viet khi danh sach rong.
- SVG khong them thu vien ngoai; vung bieu do cuon ngang rieng tren dien thoai.
- Playwright desktop/mobile kiem tra chon nhieu nguoi, so tien, bo chon, khoi phuc lua chon va axe WCAG A/AA.
