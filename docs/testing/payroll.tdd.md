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
