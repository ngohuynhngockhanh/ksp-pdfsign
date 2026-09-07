---
name: spx-print-by-label
description: Tu dong tra cuu ma van don SPX (SPXVN...) hoac ma don hang (VN...), tai file PDF tem nhan goc tu SPX Express, bien doi ma tran Ti Le Vang (Golden Ratio 65% can lech phai) va gui lenh in truc tiep sang may in nhiet TP732H (192.168.1.10).
---

# SPX Thermal Label Printer (In Tem Van Don SPX Chuan Ti Le Vang)

Skill nay cung cap kha nang tu dong hoa 100% quy trinh in tem van don **SPX Express** ra may in nhiet **TP732H** theo dung tieu chuan ky thuat chuan mau.

## Cong & Dich vu SPX Express
- **SPX Admin / Order Tracking**: `https://spx.vn/spx-admin/order/trackings`
- **Tra cuu don hang API**: `GET https://spx.vn/shipment/order/logistic/order/get_order_info?spx_tn={tracking_no}`
- **Tai nhan PDF goc API**: `GET https://spx.vn/shipment/order/logistic/label/batch_get_shipping_label?order_sn_list={order_sn}`

---

## Quy trinh xu ly tu dong (4 Buoc Chuan Hoa)

1. **Dinh danh & Tra cuu 2 chieu**:
   - Nhan ma van don `SPXVN...` hoac ma don hang `VN...` tu nguoi dung.
   - Tu dong goi `get_order_info` lay `order_sn`, tuyen phan loai (*Sort code*), thong tin nguoi gui, nguoi nhan, ten hang, can nang va tien COD.
2. **Tai PDF tem nhan goc tu SPX**:
   - Dung cookies tai khoan SPX goi `batch_get_shipping_label?order_sn_list={order_sn}` de lay file PDF goc.
3. **Bien doi Affine theo Chuan Ti Le Vang (Golden Ratio Standard)**:
   - **Ti le scale**: Co **`65%`** (`scale = 0.65`) de vua khit hoan hao dau in nhiet 80mm.
   - **Can le (Align Right)**: `tx = (w - w * 0.65) - 2.0 pt` ep sat le phai cuon giay.
   - **Can giua truc doc**: `ty = (h - h * 0.65) / 2.0 pt`.
   - Luu vao Document storage va tao link Public Share 90 ngay.
4. **Thuc thi in tu xa (Remote Thermal Printing)**:
   - SCP file PDF sang may Windows `Administrator@192.168.1.10:C:/ksp/label_{tracking_no}.pdf`.
   - Goi Foxit Reader CLI: `"C:\Program Files (x86)\Foxit Software\Foxit Reader\FoxitReader.exe" /t "C:\ksp\label_{tracking_no}.pdf" "TP732H"`.
   - Danh dau `is_printed = True` va cap nhat `printed_at` vao CSDL.

---

## Cach su dung tu Python SDK / Codebase

```python
from backend.app.db import get_session
from backend.app import spx

for db in get_session():
    result = spx.quick_print_by_code(
        db,
        code="SPXVN062473567318",
        printer_name="TP732H",
        host="192.168.1.10",
        print_remote=True,
    )
    print("Ket qua in:", result)
```

---

## REST API Endpoints
- `POST /api/spx/quick-print`: Nhan `tracking_no` (hoac `order_code`), tu tra cuu, scale ti le vang va in ngay sang TP732H.
- `GET /api/spx/orders/{tracking_no}/label`: Tai file PDF tem nhan da bien doi ti le vang.
- `POST /api/spx/orders/{tracking_no}/print-remote`: Gui lenh in remote sang may in Windows.
