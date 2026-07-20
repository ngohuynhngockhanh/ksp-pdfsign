"""API ton kho (admin-only): /api/inv/*."""
from __future__ import annotations

import json
import re

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import ai, audit, inv_export, inv_import, inventory, storage
from .auth import CurrentUser, require_admin
from .config import Settings, get_settings
from .db import (
    Customer,
    InvIssue,
    InvIssueLine,
    InvItem,
    InvMove,
    InvProduction,
    InvProductionLine,
    InvPurchase,
    InvPurchaseLine,
    InvRecipe,
    InvRecipeLine,
    InvSale,
    InvSaleLine,
    InvWarehouse,
    get_session,
)
from .inventory import NegativeStockError, PostError, normalize_name
from .schemas import (
    AssembleIn,
    BulkIds,
    DescribeBomIn,
    InvImportUrlIn,
    InvIssueIn,
    InvIssueLineOut,
    InvIssueOut,
    InvItemCreate,
    InvItemOut,
    InvItemUpdate,
    InvProductionIn,
    InvProductionLineOut,
    InvProductionOut,
    InvPurchaseLineOut,
    InvPurchaseOut,
    InvPurchaseUpdate,
    InvRecipeIn,
    InvRecipeOut,
    InvSaleLineOut,
    SuggestBomIn,
    InvSaleOut,
    InvSaleUpdate,
    InvWarehouseOut,
    OpeningImportResult,
    StockCardRow,
    StockReport,
    StockRowOut,
)

router = APIRouter(prefix="/api/inv")


def _audit(db, user, action: str, target: str = "", detail: str = "") -> None:
    audit.record(db, user.username, user.role, user.ip, action, target, detail)


def _neg(e: NegativeStockError) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, detail=e.detail())


def _jload(s: str) -> list:
    try:
        return json.loads(s or "[]")
    except json.JSONDecodeError:
        return []


_STATUS_VI = {"draft": "Nháp", "posted": "Đã ghi sổ", "reviewed": "Đã duyệt", "void": "Đã hủy"}


def _export_scope(stmt, Model, ids: str, tu: str, den: str, status_f: str):
    """Loc pham vi xuat: co ids -> uu tien loc theo ids (bo qua tu/den/status_f).
    Khong co ids -> loc theo status_f + tu/den (giong list-endpoint)."""
    if ids.strip():
        try:
            id_list = [int(x) for x in ids.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "ids không hợp lệ")
        return stmt.where(Model.id.in_(id_list))
    if status_f:
        stmt = stmt.where(Model.status == status_f)
    if tu:
        stmt = stmt.where(Model.ngay >= tu)
    if den:
        stmt = stmt.where(Model.ngay <= den)
    return stmt


# ---------------------------------------------------------------------------
# Danh muc
# ---------------------------------------------------------------------------
@router.get("/warehouses", response_model=list[InvWarehouseOut])
def list_warehouses(
    user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    return [
        InvWarehouseOut(id=w.id, code=w.code, name=w.name)
        for w in db.scalars(select(InvWarehouse).order_by(InvWarehouse.id))
    ]


def _item_out(i: InvItem) -> InvItemOut:
    return InvItemOut(
        id=i.id, ma_hang=i.ma_hang, ten=i.ten, dvt=i.dvt,
        note=i.note, active=i.active, product_id=i.product_id,
    )


@router.get("/items", response_model=list[InvItemOut])
def list_items(
    q: str = "",
    include_inactive: bool = False,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    stmt = select(InvItem)
    if not include_inactive:
        stmt = stmt.where(InvItem.active.is_(True))
    if q.strip():
        like = f"%{q.strip()}%"
        norm = f"%{normalize_name(q)}%"
        stmt = stmt.where(
            InvItem.ten.ilike(like) | InvItem.ma_hang.ilike(like) | InvItem.ten_norm.ilike(norm)
        )
    stmt = stmt.order_by(InvItem.ma_hang).limit(1000)
    return [_item_out(i) for i in db.scalars(stmt)]


_HH9_RE = re.compile(r"^HH9(\d{3,})$")


@router.get("/items/suggest-code")
def suggest_item_code(
    user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    """Goi y ma hang tiep theo trong day HH9xxx (danh cho hang moi phat sinh tu import)."""
    best = 0
    for ma in db.scalars(select(InvItem.ma_hang)):
        m = _HH9_RE.match(ma or "")
        if m:
            best = max(best, int(m.group(1)))
    return {"code": f"HH9{best + 1:03d}"}


def _last_thue_suat(db: Session, item_id: int) -> float:
    """Thue suat cua lan mua gan nhat (da ghi so) cua mat hang -> uoc luong gia von co thue."""
    last = db.scalars(
        select(InvPurchaseLine)
        .join(InvPurchase, InvPurchaseLine.invoice_id == InvPurchase.id)
        .where(InvPurchaseLine.item_id == item_id, InvPurchase.status == "posted")
        .order_by(InvPurchase.ngay.desc())
    ).first()
    return last.thue_suat if last and last.thue_suat else 8.0


@router.get("/items/{item_id}/cost")
def item_cost(
    item_id: int,
    ngay: str = "",
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Gia von binh quan (chua thue) + thue suat uoc luong + kha dung tai ngay, cho 1 mat hang.

    Dung khi user tu chon linh kien (khong qua AI) trong panel Ghep bo.
    """
    it = db.get(InvItem, item_id)
    if not it:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy mặt hàng")
    ton = gia_tri = 0.0
    best_wh: tuple[int, float] | None = None  # (warehouse_id, ton) kho co ton nhieu nhat
    for r in inventory.stock_snapshot(db):
        if r.item_id == item_id:
            ton += r.ton
            gia_tri += r.gia_tri
            if r.ton > inventory.EPS and (best_wh is None or r.ton > best_wh[1]):
                best_wh = (r.warehouse_id, r.ton)
    don_gia_bq = gia_tri / ton if ton > inventory.EPS else 0.0
    kha_dung = 0.0
    best_wh_avail: tuple[int, float] | None = None  # kho co kha dung nhieu nhat TAI NGAY do
    if ngay:
        for r in inventory.availability(db, ngay):
            if r.item_id == item_id:
                kha_dung += r.kha_dung or 0.0
                if (r.kha_dung or 0.0) > inventory.EPS and (
                    best_wh_avail is None or (r.kha_dung or 0.0) > best_wh_avail[1]
                ):
                    best_wh_avail = (r.warehouse_id, r.kha_dung or 0.0)
    # Uu tien kho co kha dung tai ngay HD; neu chua ro ngay hoac chua co ton tai
    # ngay do thi fallback ve kho dang giu ton nhieu nhat (giup UI khong mac
    # dinh sai kho "HH" cho hang von thuc chat nam o kho NVL/TP).
    warehouse_id = (best_wh_avail or best_wh)[0] if (best_wh_avail or best_wh) else None
    return {
        "dvt": it.dvt,
        "don_gia_bq": round(don_gia_bq, 2),
        "thue_suat_est": _last_thue_suat(db, item_id),
        "kha_dung_tai_ngay": round(kha_dung, 4),
        "warehouse_id": warehouse_id,
    }


@router.post("/items", response_model=InvItemOut)
def create_item(
    body: InvItemCreate,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    ma = body.ma_hang.strip()
    if not ma or not body.ten.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cần mã hàng và tên hàng")
    if db.scalars(select(InvItem).where(InvItem.ma_hang == ma)).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Mã hàng '{ma}' đã tồn tại")
    it = InvItem(
        ma_hang=ma, ten=body.ten.strip(), ten_norm=normalize_name(body.ten),
        dvt=body.dvt.strip(), note=body.note,
    )
    db.add(it)
    db.commit()
    db.refresh(it)
    _audit(db, user, "inv_item_create", ma, body.ten[:100])
    return _item_out(it)


@router.patch("/items/{item_id}", response_model=InvItemOut)
def update_item(
    item_id: int,
    body: InvItemUpdate,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    it = db.get(InvItem, item_id)
    if not it:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy mặt hàng")
    if body.ten is not None:
        it.ten = body.ten.strip()
        it.ten_norm = normalize_name(it.ten)
    if body.dvt is not None:
        it.dvt = body.dvt.strip()
    if body.note is not None:
        it.note = body.note
    if body.active is not None:
        it.active = body.active
    if body.product_id is not None:
        it.product_id = body.product_id or None
    db.commit()
    db.refresh(it)
    return _item_out(it)


@router.post("/items/merge")
def merge_items(
    source_id: int,
    target_id: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Gộp mã NGUỒN vào mã ĐÍCH: dồn hết sổ kho + chứng từ, xóa mã nguồn,
    tính lại giá bình quân. Nguồn biến mất, đích giữ nguyên tên/mã."""
    if source_id == target_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Không thể gộp một mã vào chính nó")
    src = db.get(InvItem, source_id)
    tgt = db.get(InvItem, target_id)
    if not src or not tgt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy mặt hàng")

    # Cac cap (mat hang, kho) bi anh huong tren mã dich (de replay lai)
    pairs = {
        (target_id, m.warehouse_id)
        for m in db.scalars(select(InvMove).where(InvMove.item_id == source_id))
    }
    pairs |= {
        (target_id, m.warehouse_id)
        for m in db.scalars(select(InvMove).where(InvMove.item_id == target_id))
    }
    # Doi item_id nguon -> dich o moi bang tham chieu
    for m in db.scalars(select(InvMove).where(InvMove.item_id == source_id)):
        m.item_id = target_id
    for ln in db.scalars(select(InvPurchaseLine).where(InvPurchaseLine.item_id == source_id)):
        ln.item_id = target_id
    for ln in db.scalars(select(InvIssueLine).where(InvIssueLine.item_id == source_id)):
        ln.item_id = target_id
    for ln in db.scalars(select(InvProductionLine).where(InvProductionLine.item_id == source_id)):
        ln.item_id = target_id
    for ln in db.scalars(select(InvRecipeLine).where(InvRecipeLine.item_id == source_id)):
        ln.item_id = target_id
    for r in db.scalars(select(InvRecipe).where(InvRecipe.output_item_id == source_id)):
        r.output_item_id = target_id
    db.delete(src)
    db.flush()
    try:
        inventory.validate_pairs(db, pairs)  # tinh lai gia binh quan + chan am kho
    except NegativeStockError as e:
        db.rollback()
        raise _neg(e)
    db.commit()
    _audit(db, user, "inv_item_merge", f"{src.ma_hang} → {tgt.ma_hang}", tgt.ten[:80])
    return _item_out(tgt)


# ---------------------------------------------------------------------------
# Bao cao ton / the kho / kha dung
# ---------------------------------------------------------------------------
def _stock_rows(db: Session, rows) -> list[StockRowOut]:
    items = {i.id: i for i in db.scalars(select(InvItem))}
    whs = {w.id: w for w in db.scalars(select(InvWarehouse))}
    out = []
    for r in rows:
        it = items.get(r.item_id)
        wh = whs.get(r.warehouse_id)
        if not it or not wh:
            continue
        out.append(StockRowOut(
            item_id=r.item_id, ma_hang=it.ma_hang, ten=it.ten, dvt=it.dvt,
            warehouse_id=r.warehouse_id, warehouse_code=wh.code,
            ton=round(r.ton, 4), don_gia_bq=round(r.don_gia_bq, 2),
            gia_tri=r.gia_tri, kha_dung=r.kha_dung, nhap_cuoi=r.nhap_cuoi,
        ))
    out.sort(key=lambda r: (r.warehouse_code, r.ma_hang))
    return out


@router.get("/stock", response_model=StockReport)
def stock_report(
    warehouse_id: int | None = None,
    date: str | None = None,
    all_items: bool = False,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    rows = inventory.stock_snapshot(db, warehouse_id=warehouse_id, as_of=date)
    if not all_items:
        rows = [r for r in rows if abs(r.ton) > inventory.EPS or abs(r.gia_tri) > 0.5]
    out = _stock_rows(db, rows)
    return StockReport(rows=out, tong_gia_tri=sum(r.gia_tri for r in out), ngay=date)


@router.get("/availability", response_model=StockReport)
def availability_report(
    date: str,
    warehouse_id: int | None = None,
    only_available: bool = True,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Kha dung tai ngay `date` — nguon cho picker phieu xuat (chan am kho)."""
    rows = inventory.availability(db, date, warehouse_id=warehouse_id)
    if only_available:
        rows = [r for r in rows if (r.kha_dung or 0) > inventory.EPS]
    out = _stock_rows(db, rows)
    return StockReport(rows=out, tong_gia_tri=sum(r.gia_tri for r in out), ngay=date)


@router.get("/items/{item_id}/card", response_model=list[StockCardRow])
def stock_card(
    item_id: int,
    warehouse_id: int,
    tu: str | None = None,
    den: str | None = None,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    if not db.get(InvItem, item_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy mặt hàng")
    return [
        StockCardRow(**r)
        for r in inventory.stock_card(db, item_id, warehouse_id, tu=tu, den=den)
    ]


# ---------------------------------------------------------------------------
# Import ton dau ky tu Excel
# ---------------------------------------------------------------------------
@router.post("/opening/import", response_model=OpeningImportResult)
async def opening_import(
    file: UploadFile = File(...),
    dry_run: bool = True,
    ngay: str = "2025-12-31",
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    data = await file.read()
    try:
        parsed = inv_import.parse_opening_xlsx(data)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Không đọc được file Excel: {e}")

    preview = []
    for ma, it in parsed["items"].items():
        for wh, s in it["stocks"].items():
            if s.get("skip") or s["sl"] <= 0:
                continue
            preview.append({
                "ma_hang": ma, "ten": it["ten"], "dvt": it["dvt"], "kho": wh,
                "so_luong": s["sl"], "gia_tri": s["gt"],
                "don_gia": round(s["gt"] / s["sl"], 2) if s["sl"] else 0,
            })
    preview.sort(key=lambda r: (r["kho"], r["ma_hang"]))

    applied = None
    if not dry_run:
        try:
            applied = inv_import.apply_opening(db, parsed, ngay=ngay)
        except PermissionError as e:
            raise HTTPException(status.HTTP_409_CONFLICT, str(e))
        _audit(
            db, user, "inv_opening_import", file.filename or "",
            f"{applied['moves']} dòng tồn · {parsed['tong']['tong_gia_tri']:,.0f}đ",
        )
    return OpeningImportResult(
        dry_run=dry_run, tong=parsed["tong"], warnings=parsed["warnings"],
        preview=preview, applied=applied,
    )


# ---------------------------------------------------------------------------
# Hoa don mua vao
# ---------------------------------------------------------------------------
def _purchase_out(db: Session, inv: InvPurchase, with_lines: bool = True) -> InvPurchaseOut:
    items = {i.id: i for i in db.scalars(select(InvItem))}
    lines = []
    if with_lines:
        all_items = [i for i in items.values() if i.active]
        aliases = inv_import.load_purchase_aliases(db)
        for ln in sorted(inv.lines, key=lambda x: (x.stt, x.id)):
            it = items.get(ln.item_id) if ln.item_id else None
            sugg = []
            if not ln.item_id:
                _m, _k, cands = inv_import.match_suggestions(
                    all_items, ln.ten_raw, aliases=aliases, mst_ban=inv.mst_ban
                )
                sugg = [
                    {
                        "item_id": c.id, "ma_hang": c.ma_hang, "ten": c.ten, "dvt": c.dvt,
                        "score": round(r, 2),
                        "reason": ("Trùng 100%" if r >= 0.99 else f"Giống {round(r * 100)}%")
                        + (f" · cùng ĐVT" if c.dvt and c.dvt == ln.dvt else ""),
                    }
                    for c, r in cands
                ]
            lines.append(InvPurchaseLineOut(
                id=ln.id, stt=ln.stt, ten_raw=ln.ten_raw, dvt=ln.dvt,
                so_luong=ln.so_luong, don_gia=ln.don_gia, thanh_tien=ln.thanh_tien,
                thue_suat=ln.thue_suat, item_id=ln.item_id,
                item_ma_hang=it.ma_hang if it else "", item_ten=it.ten if it else "",
                warehouse_id=ln.warehouse_id, match_kind=ln.match_kind,
                confidence=ln.confidence, warnings=_jload(ln.warnings),
                suggestions=sugg,
            ))
    return InvPurchaseOut(
        id=inv.id, so_hd=inv.so_hd, ky_hieu=inv.ky_hieu, mst_ban=inv.mst_ban,
        ten_ban=inv.ten_ban, ngay=inv.ngay,
        tong_truoc_thue=inv.tong_truoc_thue, tong_thue=inv.tong_thue,
        tong_tien=inv.tong_tien, source=inv.source, status=inv.status,
        loai=inv.loai or "hang_hoa",
        confidence=inv.confidence, warnings=_jload(inv.warnings), dup_of=inv.dup_of,
        created_at=inv.created_at.isoformat() if inv.created_at else "",
        doc_url=f"/api/inv/purchase/{inv.id}/file" if inv.doc_id else "",
        lines=lines,
    )


def _import_one_file(
    db: Session, settings: Settings, user: CurrentUser, name: str, content: bytes
) -> dict:
    """Parse 1 file (XML/PDF) hoa don mua vao -> tao draft + audit. Tra ve dict ket qua."""
    try:
        if name.lower().endswith(".xml") or content.lstrip()[:5] == b"<?xml":
            data = inv_import.parse_purchase_xml(content)
            doc_id = storage.save_upload(content, suffix=".xml")
            suffix = ".xml"
        elif content.startswith(b"%PDF"):
            data = inv_import.parse_purchase_pdf(content)
            suffix = ".pdf"
            _items = data.get("items") or []
            _rong_gia_tri = (
                sum(it.get("thanh_tien") or 0 for it in _items) == 0
                and (data.get("tong_truoc_thue") or 0) > 0
            )
            if not _items or _rong_gia_tri:
                # PDF khong co bang text, HOAC bang bi boc RONG gia tri (bang scan
                # loi anh -> pdfplumber doc duoc khung nhung khong ra so) -> thu AI
                try:
                    data = inv_import.extract_purchase_ai(settings, content)
                except ai.AINotConfigured:
                    data["warnings"] = (data.get("warnings") or []) + [{
                        "code": "scan",
                        "msg": "PDF scan không đọc được bảng, AI chưa bật — nhập tay từng dòng",
                    }]
                    data["confidence"] = 0.3
                except ai.AIError as e:
                    data["warnings"] = (data.get("warnings") or []) + [{
                        "code": "ai_loi", "msg": f"AI lỗi: {e} — nhập tay từng dòng",
                    }]
                    data["confidence"] = 0.3
            doc_id = storage.save_upload(content, suffix=".pdf")
        else:
            raise ValueError("Chỉ nhận file PDF hoặc XML hóa đơn")
        inv = inv_import.create_purchase_draft(db, data, doc_id=doc_id, doc_suffix=suffix)
        _audit(db, user, "inv_purchase_upload", name, f"HĐ #{inv.id} · {inv.ten_ban[:80]}")
        return {"filename": name, "ok": True, "purchase_id": inv.id,
                "confidence": inv.confidence, "dup_of": inv.dup_of}
    except Exception as e:  # noqa: BLE001
        return {"filename": name, "ok": False, "error": str(e)}


@router.post("/purchase/upload")
async def purchase_upload(
    files: list[UploadFile] = File(...),
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    """Upload nhieu file hoa don (XML/PDF/ZIP). Moi file (hoac moi file trong ZIP) -> 1 draft (hoac loi)."""
    results = []
    for f in files:
        name = f.filename or "file"
        content = await f.read()
        try:
            expanded = inv_import.expand_zip(name, content)
        except Exception as e:  # noqa: BLE001
            results.append({"filename": name, "ok": False, "error": str(e)})
            continue
        for sub_name, sub_content in expanded:
            results.append(_import_one_file(db, settings, user, sub_name, sub_content))
    return {"results": results}


@router.post("/purchase/import-url")
async def purchase_import_url(
    body: InvImportUrlIn,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    """Import HD tu link (Google Drive folder/file, hoac link PDF/XML/ZIP truc tiep)."""
    try:
        files = inv_import.fetch_from_url(body.url)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    results = []
    for name, content in files:
        try:
            expanded = inv_import.expand_zip(name, content)
        except Exception as e:  # noqa: BLE001
            results.append({"filename": name, "ok": False, "error": str(e)})
            continue
        for sub_name, sub_content in expanded:
            results.append(_import_one_file(db, settings, user, sub_name, sub_content))
    _audit(db, user, "inv_import_url", body.url[:255], f"{len(results)} file")
    return {"results": results}


@router.post("/purchase/bang-ke")
async def purchase_bang_ke(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Doi chieu bang ke hoa don mua vao (Excel ke khai thue) voi cac HD da import."""
    data = await file.read()
    try:
        rows = inv_import.parse_bang_ke_xlsx(data)
        result = inv_import.reconcile_bang_ke(db, rows)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except Exception as e:  # noqa: BLE001 — file hong/khong phai xlsx
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Không đọc được file Excel bảng kê: {e}")
    _audit(
        db, user, "inv_bang_ke", file.filename or "",
        f"khớp {len(result['khop'])} · lệch tiền {len(result['lech_tien'])} · "
        f"thiếu file {len(result['thieu_file'])} · ngoài bảng kê {len(result['ngoai_bang_ke'])}",
    )
    return result


@router.post("/purchase", response_model=InvPurchaseOut)
def purchase_create_manual(
    body: InvPurchaseUpdate,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Tao hoa don mua nhap tay (phieu ban le khong co PDF/XML)."""
    data = {
        "source": "manual",
        "so_hd": body.so_hd or "", "ky_hieu": body.ky_hieu or "",
        "mst_ban": body.mst_ban or "", "ten_ban": body.ten_ban or "",
        "ngay": body.ngay or "",
        "items": [ln.model_dump() | {"ten": ln.ten_raw} for ln in (body.lines or [])],
        "confidence": 1.0,
    }
    inv = inv_import.create_purchase_draft(db, data)
    # Nhap tay: giu item da chon neu co
    if body.lines:
        for ln, src in zip(sorted(inv.lines, key=lambda x: (x.stt, x.id)), body.lines):
            if src.item_id:
                ln.item_id = src.item_id
                ln.match_kind = "manual"
            if src.warehouse_id:
                ln.warehouse_id = src.warehouse_id
        db.commit()
    _audit(db, user, "inv_purchase_manual", f"HĐ #{inv.id}", inv.ten_ban[:100])
    return _purchase_out(db, inv)


@router.get("/purchase", response_model=list[InvPurchaseOut])
def purchase_list(
    status_f: str = "",
    q: str = "",
    tu: str = "",
    den: str = "",
    limit: int = 100,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    stmt = select(InvPurchase)
    if status_f:
        stmt = stmt.where(InvPurchase.status == status_f)
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            InvPurchase.ten_ban.ilike(like)
            | InvPurchase.so_hd.ilike(like)
            | InvPurchase.mst_ban.ilike(like)
        )
    if tu:
        stmt = stmt.where(InvPurchase.ngay >= tu)
    if den:
        stmt = stmt.where(InvPurchase.ngay <= den)
    stmt = stmt.order_by(InvPurchase.id.desc()).limit(min(limit, 500))
    return [_purchase_out(db, p, with_lines=False) for p in db.scalars(stmt)]


@router.get("/purchase/export-zip")
def purchase_export_zip(
    tu: str = "",
    den: str = "",
    status_f: str = "",
    ids: str = "",
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Zip cac file goc (PDF/XML) cua cac HD mua khop pham vi loc."""
    stmt = _export_scope(select(InvPurchase), InvPurchase, ids, tu, den, status_f)
    stmt = stmt.order_by(InvPurchase.ngay, InvPurchase.id)
    files: list[tuple[str, bytes]] = []
    for inv in db.scalars(stmt):
        suffix = inv.doc_suffix or ".pdf"
        if not inv.doc_id or not storage.exists(inv.doc_id, suffix):
            continue
        data = storage.read_doc(inv.doc_id, suffix)
        stem = inv_export.sanitize_arcname(f"{inv.ngay}_{inv.so_hd}_{inv.ten_ban[:40]}")
        files.append((f"{stem}{suffix}", data))
    if not files:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không có file gốc nào trong phạm vi lọc")
    return inv_export.zip_response(files, "hoa-don-mua.zip")


@router.get("/purchase/export-xlsx")
def purchase_export_xlsx(
    tu: str = "",
    den: str = "",
    status_f: str = "",
    ids: str = "",
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    stmt = _export_scope(select(InvPurchase), InvPurchase, ids, tu, den, status_f)
    stmt = stmt.order_by(InvPurchase.ngay, InvPurchase.id)
    items = {i.id: i for i in db.scalars(select(InvItem))}
    hd_rows, dong_rows = [], []
    for inv in db.scalars(stmt):
        hd_rows.append([
            inv.so_hd, inv.ky_hieu, inv.ngay, inv.ten_ban, inv.mst_ban,
            inv.tong_truoc_thue, inv.tong_thue, inv.tong_tien,
            inv.source, inv.loai or "hang_hoa", _STATUS_VI.get(inv.status, inv.status),
        ])
        for ln in sorted(inv.lines, key=lambda x: (x.stt, x.id)):
            it = items.get(ln.item_id) if ln.item_id else None
            dong_rows.append([
                inv.so_hd, ln.ten_raw, ln.dvt, ln.so_luong, ln.don_gia, ln.thanh_tien,
                ln.thue_suat, it.ma_hang if it else "",
            ])
    sheets = [
        ("Hóa đơn", [
            "Số HĐ", "Ký hiệu", "Ngày", "Người bán", "MST", "Trước thuế", "Thuế",
            "Tổng", "Nguồn", "Loại", "Trạng thái",
        ], hd_rows),
        ("Dòng hàng", [
            "Số HĐ", "Tên trên HĐ", "ĐVT", "SL", "Đơn giá", "Thành tiền", "VAT %",
            "Mã hàng đã khớp",
        ], dong_rows),
    ]
    return inv_export.xlsx_response(sheets, "hoa-don-mua.xlsx")


@router.get("/purchase/{pid}", response_model=InvPurchaseOut)
def purchase_get(
    pid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    inv = db.get(InvPurchase, pid)
    if not inv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hóa đơn")
    return _purchase_out(db, inv)


@router.get("/purchase/{pid}/file")
def purchase_file(
    pid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    inv = db.get(InvPurchase, pid)
    if not inv or not inv.doc_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hóa đơn không có file gốc")
    data = storage.read_doc(inv.doc_id, suffix=inv.doc_suffix or ".pdf")
    media = "application/pdf" if (inv.doc_suffix or ".pdf") == ".pdf" else "application/xml"
    return Response(content=data, media_type=media)


@router.patch("/purchase/{pid}", response_model=InvPurchaseOut)
def purchase_update(
    pid: int,
    body: InvPurchaseUpdate,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    inv = db.get(InvPurchase, pid)
    if not inv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hóa đơn")
    if inv.status != "draft":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Chỉ sửa được bản nháp (hủy ghi sổ trước)")
    for f in ("so_hd", "ky_hieu", "mst_ban", "ten_ban", "ngay"):
        v = getattr(body, f)
        if v is not None:
            setattr(inv, f, v.strip())
    if body.loai is not None:
        if body.loai not in ("hang_hoa", "dich_vu"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "loai phải là 'hang_hoa' hoặc 'dich_vu'")
        inv.loai = body.loai
    if body.lines is not None:
        for ln in list(inv.lines):
            db.delete(ln)
        for i, src in enumerate(body.lines, start=1):
            db.add(InvPurchaseLine(
                invoice=inv, stt=src.stt or i, ten_raw=src.ten_raw, dvt=src.dvt,
                so_luong=src.so_luong, don_gia=src.don_gia,
                thanh_tien=src.thanh_tien or round(src.so_luong * src.don_gia),
                thue_suat=src.thue_suat, item_id=src.item_id,
                warehouse_id=src.warehouse_id,
                match_kind=src.match_kind if src.item_id else "none",
            ))
    db.commit()
    db.refresh(inv)
    return _purchase_out(db, inv)


@router.delete("/purchase/{pid}")
def purchase_delete(
    pid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    inv = db.get(InvPurchase, pid)
    if not inv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hóa đơn")
    if inv.status == "posted":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Hóa đơn đã ghi sổ — hủy ghi sổ trước khi xóa")
    db.delete(inv)
    db.commit()
    _audit(db, user, "inv_purchase_delete", f"HĐ #{pid}")
    return {"ok": True}


@router.post("/purchase/{pid}/post", response_model=InvPurchaseOut)
def purchase_post(
    pid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    inv = db.get(InvPurchase, pid)
    if not inv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hóa đơn")
    try:
        inventory.post_purchase(db, inv)
    except PostError as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except NegativeStockError as e:
        db.rollback()
        raise _neg(e)
    _audit(db, user, "inv_purchase_post", f"HĐ #{pid}", f"{inv.ten_ban[:60]} · {inv.ngay}")
    return _purchase_out(db, inv)


@router.post("/purchase/{pid}/void", response_model=InvPurchaseOut)
def purchase_void(
    pid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    inv = db.get(InvPurchase, pid)
    if not inv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hóa đơn")
    try:
        inventory.unpost_purchase(db, inv)
    except PostError as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except NegativeStockError as e:
        db.rollback()
        raise _neg(e)
    _audit(db, user, "inv_purchase_void", f"HĐ #{pid}")
    return _purchase_out(db, inv)


@router.post("/purchase/bulk-delete")
def purchase_bulk_delete(
    body: BulkIds, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    """Xoa hang loat hoa don NHAP (bo qua cai da ghi so)."""
    deleted = skipped = 0
    for pid in body.ids:
        inv = db.get(InvPurchase, pid)
        if not inv:
            continue
        if inv.status == "posted":
            skipped += 1
            continue
        db.delete(inv)
        deleted += 1
    db.commit()
    _audit(db, user, "inv_purchase_delete", f"{deleted} HĐ (hàng loạt)")
    return {"deleted": deleted, "skipped": skipped}


@router.post("/purchase/bulk-post")
def purchase_bulk_post(
    body: BulkIds, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    """Ghi so hang loat. Tung cai duyet rieng; loi cai nao bao cai do."""
    results = []
    for pid in body.ids:
        inv = db.get(InvPurchase, pid)
        if not inv:
            continue
        if inv.status != "draft":
            results.append({"id": pid, "ok": False, "error": "không phải bản nháp"})
            continue
        ten = f"#{pid} {inv.ten_ban[:30]}"
        try:
            inventory.post_purchase(db, inv)
            results.append({"id": pid, "ok": True, "ten": ten})
        except PostError as e:
            db.rollback()
            results.append({"id": pid, "ok": False, "ten": ten, "error": str(e)})
        except NegativeStockError as e:
            db.rollback()
            results.append({"id": pid, "ok": False, "ten": ten, "error": e.detail()["message"]})
    ok = sum(1 for r in results if r["ok"])
    _audit(db, user, "inv_purchase_post", f"{ok}/{len(results)} HĐ (hàng loạt)")
    return {"results": results, "ok": ok, "total": len(results)}


# ---------------------------------------------------------------------------
# Hoa don BAN RA (iNut ban) — GD1: import + doi chieu ton, KHONG tru kho
# ---------------------------------------------------------------------------
def _fmt(x: float) -> str:
    return f"{round(x, 4):g}"


def _sale_line_lech(so_luong: float, don_gia_ban: float, thanh_tien: float, is_dieu_chinh: bool) -> bool:
    """SL x don_gia_ban lech thanh_tien (loi parse PDF/XML) — cung nguong voi Nhap hang."""
    if is_dieu_chinh or not thanh_tien or not so_luong:
        return False
    return abs(so_luong * don_gia_ban - thanh_tien) > max(1.0, thanh_tien * 0.01)


def _sale_out(db: Session, inv: InvSale, with_lines: bool = True) -> InvSaleOut:
    lines_out: list[InvSaleLineOut] = []
    if with_lines:
        items = {i.id: i for i in db.scalars(select(InvItem))}
        all_items = [i for i in items.values() if i.active]
        avail: dict[tuple[int, int], float] = {}
        snap: dict[tuple[int, int], float] = {}
        if inv.ngay and not inv.is_dieu_chinh:
            for r in inventory.availability(db, inv.ngay):
                avail[(r.item_id, r.warehouse_id)] = r.kha_dung or 0.0
            for r in inventory.stock_snapshot(db, as_of=inv.ngay):
                snap[(r.item_id, r.warehouse_id)] = r.ton

        for ln in sorted(inv.lines, key=lambda x: (x.stt, x.id)):
            it = items.get(ln.item_id) if ln.item_id else None
            sugg = []
            if not ln.item_id and not inv.is_dieu_chinh and ln.fulfil_kind != "doanh_thu":
                _m, _k, cands = inv_import.match_suggestions(all_items, ln.ten_raw)
                sugg = [
                    {
                        "item_id": c.id, "ma_hang": c.ma_hang, "ten": c.ten, "dvt": c.dvt,
                        "score": round(r, 2),
                        "reason": ("Trùng 100%" if r >= 0.99 else f"Giống {round(r * 100)}%"),
                    }
                    for c, r in cands
                ]
            key = (ln.item_id, ln.warehouse_id)
            kd = avail.get(key, 0.0) if ln.item_id else 0.0
            ton = snap.get(key, 0.0) if ln.item_id else 0.0
            fulfil = ln.fulfil_kind
            de_xuat, warn = "", False
            if inv.is_dieu_chinh:
                de_xuat = "↩︎ HĐ điều chỉnh — bỏ qua đối chiếu kho"
            elif ln.fulfil_kind == "doanh_thu":
                de_xuat = "Phần mềm — ghi doanh thu, không trừ kho" + (" (KCT)" if ln.thue_kct else "")
            elif ln.item_id and kd >= ln.so_luong - inventory.EPS:
                fulfil = "ton"
                de_xuat = f"✅ Xuất từ kho (khả dụng {_fmt(kd)})"
            elif ln.item_id and ton > inventory.EPS:
                fulfil, warn = "ton", True
                de_xuat = f"⚠️ Thiếu kho tại ngày HĐ (khả dụng {_fmt(kd)} < {_fmt(ln.so_luong)}) — cần SX/nhập trước"
            elif ln.line_class == "bo":
                fulfil = "sx"
                de_xuat = "🧩 Cần ghép bộ — khai báo linh kiện (bấm Ghép bộ, AI gợi ý)"
            elif ln.line_class == "inut":
                fulfil = "sx"
                de_xuat = "🏭 Cần sản xuất (chưa có thành phẩm tồn)"
            elif ln.item_id:
                fulfil, warn = "ton", True
                de_xuat = "⚠️ Chưa có tồn tại ngày HĐ — cần nhập/mua trước"
            else:
                de_xuat = "❓ Chưa khớp mặt hàng — gán tay"
            lines_out.append(InvSaleLineOut(
                id=ln.id, stt=ln.stt, ten_raw=ln.ten_raw, dvt=ln.dvt,
                so_luong=ln.so_luong, don_gia_ban=ln.don_gia_ban, thanh_tien=ln.thanh_tien,
                thue_suat=ln.thue_suat, thue_kct=ln.thue_kct,
                item_id=ln.item_id, item_ma_hang=it.ma_hang if it else "",
                item_ten=it.ten if it else "", warehouse_id=ln.warehouse_id,
                match_kind=ln.match_kind, line_class=ln.line_class, fulfil_kind=fulfil,
                confidence=ln.confidence, warnings=_jload(ln.warnings), suggestions=sugg,
                ton_hien_co=round(ton, 4), kha_dung_tai_ngay=round(kd, 4),
                de_xuat=de_xuat, warn_am_kho=warn,
                lech_dong=_sale_line_lech(ln.so_luong, ln.don_gia_ban, ln.thanh_tien, inv.is_dieu_chinh),
            ))
    cust = db.get(Customer, inv.customer_id) if inv.customer_id else None
    return InvSaleOut(
        id=inv.id, so_hd=inv.so_hd, ky_hieu=inv.ky_hieu, mst_mua=inv.mst_mua,
        ten_mua=inv.ten_mua, customer_id=inv.customer_id or (cust.id if cust else None),
        ngay=inv.ngay, tong_truoc_thue=inv.tong_truoc_thue, tong_thue=inv.tong_thue,
        tong_tien=inv.tong_tien, source=inv.source, status=inv.status,
        is_dieu_chinh=inv.is_dieu_chinh, dc_ref=inv.dc_ref,
        confidence=inv.confidence, warnings=_jload(inv.warnings), dup_of=inv.dup_of,
        created_at=inv.created_at.isoformat() if inv.created_at else "",
        doc_url=f"/api/inv/sale/{inv.id}/file" if inv.doc_id else "",
        lines=lines_out,
    )


def _import_one_sale(db: Session, user: CurrentUser, name: str, content: bytes) -> dict:
    try:
        if name.lower().endswith(".xml") or content.lstrip()[:5] == b"<?xml":
            data = inv_import.parse_sale_xml(content)
            doc_id = storage.save_upload(content, suffix=".xml")
            suffix = ".xml"
        elif content.startswith(b"%PDF"):
            data = inv_import.parse_sale_pdf(content, filename=name)
            doc_id = storage.save_upload(content, suffix=".pdf")
            suffix = ".pdf"
        else:
            raise ValueError("Chỉ nhận file PDF hoặc XML hóa đơn")
        inv = inv_import.create_sale_draft(db, data, doc_id=doc_id, doc_suffix=suffix)
        _audit(db, user, "inv_sale_upload", name, f"HĐ bán #{inv.id} · {inv.ten_mua[:80]}")
        return {"filename": name, "ok": True, "sale_id": inv.id,
                "confidence": inv.confidence, "dup_of": inv.dup_of,
                "is_dieu_chinh": inv.is_dieu_chinh}
    except Exception as e:  # noqa: BLE001
        return {"filename": name, "ok": False, "error": str(e)}


@router.post("/sale/upload")
async def sale_upload(
    files: list[UploadFile] = File(...),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    results = []
    for f in files:
        name = f.filename or "file"
        content = await f.read()
        try:
            expanded = inv_import.expand_zip(name, content)
        except Exception as e:  # noqa: BLE001
            results.append({"filename": name, "ok": False, "error": str(e)})
            continue
        for sub_name, sub_content in expanded:
            results.append(_import_one_sale(db, user, sub_name, sub_content))
    return {"results": results}


@router.post("/sale/import-url")
async def sale_import_url(
    body: InvImportUrlIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    try:
        files = inv_import.fetch_from_url(body.url)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    results = []
    for name, content in files:
        try:
            expanded = inv_import.expand_zip(name, content)
        except Exception as e:  # noqa: BLE001
            results.append({"filename": name, "ok": False, "error": str(e)})
            continue
        for sub_name, sub_content in expanded:
            results.append(_import_one_sale(db, user, sub_name, sub_content))
    _audit(db, user, "inv_sale_import_url", body.url[:255], f"{len(results)} file")
    return {"results": results}


@router.get("/sale", response_model=list[InvSaleOut])
def sale_list(
    status_f: str = "",
    q: str = "",
    tu: str = "",
    den: str = "",
    limit: int = 100,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    stmt = select(InvSale)
    if status_f:
        stmt = stmt.where(InvSale.status == status_f)
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            InvSale.ten_mua.ilike(like) | InvSale.so_hd.ilike(like) | InvSale.mst_mua.ilike(like)
        )
    if tu:
        stmt = stmt.where(InvSale.ngay >= tu)
    if den:
        stmt = stmt.where(InvSale.ngay <= den)
    stmt = stmt.order_by(InvSale.id.desc()).limit(min(limit, 500))
    return [_sale_out(db, s, with_lines=False) for s in db.scalars(stmt)]


@router.get("/sale/export-zip")
def sale_export_zip(
    tu: str = "",
    den: str = "",
    status_f: str = "",
    ids: str = "",
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Zip cac file goc (PDF/XML) cua cac HD ban khop pham vi loc."""
    stmt = _export_scope(select(InvSale), InvSale, ids, tu, den, status_f)
    stmt = stmt.order_by(InvSale.ngay, InvSale.id)
    files: list[tuple[str, bytes]] = []
    for inv in db.scalars(stmt):
        suffix = inv.doc_suffix or ".pdf"
        if not inv.doc_id or not storage.exists(inv.doc_id, suffix):
            continue
        data = storage.read_doc(inv.doc_id, suffix)
        stem = inv_export.sanitize_arcname(f"{inv.ngay}_{inv.so_hd}_{inv.ten_mua[:40]}")
        files.append((f"{stem}{suffix}", data))
    if not files:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không có file gốc nào trong phạm vi lọc")
    return inv_export.zip_response(files, "hoa-don-ban.zip")


@router.get("/sale/export-xlsx")
def sale_export_xlsx(
    tu: str = "",
    den: str = "",
    status_f: str = "",
    ids: str = "",
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    stmt = _export_scope(select(InvSale), InvSale, ids, tu, den, status_f)
    stmt = stmt.order_by(InvSale.ngay, InvSale.id)
    items = {i.id: i for i in db.scalars(select(InvItem))}
    hd_rows, dong_rows = [], []
    for inv in db.scalars(stmt):
        hd_rows.append([
            inv.so_hd, inv.ky_hieu, inv.ngay, inv.ten_mua, inv.mst_mua,
            inv.tong_truoc_thue, inv.tong_thue, inv.tong_tien,
            _STATUS_VI.get(inv.status, inv.status),
        ])
        for ln in sorted(inv.lines, key=lambda x: (x.stt, x.id)):
            it = items.get(ln.item_id) if ln.item_id else None
            dong_rows.append([
                inv.so_hd, ln.ten_raw, ln.dvt, ln.so_luong, ln.don_gia_ban, ln.thanh_tien,
                ln.thue_suat, it.ma_hang if it else "",
            ])
    sheets = [
        ("Hóa đơn", [
            "Số HĐ", "Ký hiệu", "Ngày", "Người mua", "MST mua", "Trước thuế", "Thuế",
            "Tổng", "Trạng thái",
        ], hd_rows),
        ("Dòng hàng", [
            "Số HĐ", "Tên trên HĐ", "ĐVT", "SL", "Đơn giá", "Thành tiền", "VAT %",
            "Mã hàng đã khớp",
        ], dong_rows),
    ]
    return inv_export.xlsx_response(sheets, "hoa-don-ban.xlsx")


@router.get("/sale/{sid}", response_model=InvSaleOut)
def sale_get(
    sid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    inv = db.get(InvSale, sid)
    if not inv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hóa đơn bán")
    return _sale_out(db, inv)


@router.get("/sale/{sid}/file")
def sale_file(
    sid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    inv = db.get(InvSale, sid)
    if not inv or not inv.doc_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hóa đơn không có file gốc")
    data = storage.read_doc(inv.doc_id, suffix=inv.doc_suffix or ".pdf")
    media = "application/pdf" if (inv.doc_suffix or ".pdf") == ".pdf" else "application/xml"
    return Response(content=data, media_type=media)


@router.patch("/sale/{sid}", response_model=InvSaleOut)
def sale_update(
    sid: int,
    body: InvSaleUpdate,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    inv = db.get(InvSale, sid)
    if not inv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hóa đơn bán")
    if inv.status == "void":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Hóa đơn đã hủy")
    for f in ("so_hd", "ky_hieu", "mst_mua", "ten_mua", "ngay"):
        v = getattr(body, f)
        if v is not None:
            setattr(inv, f, v.strip())
    if body.customer_id is not None:
        inv.customer_id = body.customer_id or None
    if body.status is not None:
        if body.status not in ("draft", "reviewed"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "status phải là 'draft' hoặc 'reviewed'")
        if body.status == "reviewed":
            # Chan cung: khong cho duyet khi con dong SL x don gia lech thanh tien
            # (loi parse PDF/XML — vd nhet don gia vao o thanh tien). Xet tren du lieu
            # SE luu (body.lines neu co gui kem, khong thi lay dong hien co).
            check_lines = (
                [(src.so_luong, src.don_gia_ban, src.thanh_tien) for src in body.lines]
                if body.lines is not None
                else [(ln.so_luong, ln.don_gia_ban, ln.thanh_tien) for ln in inv.lines]
            )
            bad = [
                i + 1 for i, (sl, dg, tt) in enumerate(check_lines)
                if _sale_line_lech(sl, dg, tt, inv.is_dieu_chinh)
            ]
            if bad:
                db.rollback()
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"Còn {len(bad)} dòng SL×đơn giá lệch thành tiền trên hóa đơn (dòng số "
                    f"{', '.join(map(str, bad))}) — sửa lại số lượng/đơn giá trước khi duyệt "
                    "(nghi ngờ lỗi parse PDF/XML)",
                )
        inv.status = body.status
    if body.lines is not None:
        for ln in list(inv.lines):
            db.delete(ln)
        for i, src in enumerate(body.lines, start=1):
            db.add(InvSaleLine(
                invoice=inv, stt=src.stt or i, ten_raw=src.ten_raw, dvt=src.dvt,
                so_luong=src.so_luong, don_gia_ban=src.don_gia_ban,
                thanh_tien=src.thanh_tien or round(src.so_luong * src.don_gia_ban),
                thue_suat=src.thue_suat, thue_kct=src.thue_kct,
                item_id=src.item_id, warehouse_id=src.warehouse_id,
                match_kind=src.match_kind if src.item_id else "none",
                line_class=src.line_class, fulfil_kind=src.fulfil_kind,
            ))
    db.commit()
    db.refresh(inv)
    return _sale_out(db, inv)


@router.delete("/sale/{sid}")
def sale_delete(
    sid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    inv = db.get(InvSale, sid)
    if not inv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hóa đơn bán")
    db.delete(inv)
    db.commit()
    _audit(db, user, "inv_sale_delete", f"HĐ bán #{sid}")
    return {"ok": True}


@router.post("/sale/bulk-delete")
def sale_bulk_delete(
    body: BulkIds, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    deleted = 0
    for sid in body.ids:
        inv = db.get(InvSale, sid)
        if not inv:
            continue
        db.delete(inv)
        deleted += 1
    db.commit()
    _audit(db, user, "inv_sale_delete", f"{deleted} HĐ bán (hàng loạt)")
    return {"deleted": deleted, "skipped": 0}


@router.post("/sale/{sid}/generate")
def sale_generate(
    sid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    """GD2: sinh phieu xuat + lenh san xuat NHAP (draft) tu HD ban. KHONG post."""
    inv = db.get(InvSale, sid)
    if not inv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hóa đơn bán")
    if inv.status != "reviewed":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Chỉ sinh chứng từ từ hóa đơn ĐÃ DUYỆT (bấm 'Lưu & Đánh dấu đã duyệt' trước)",
        )
    try:
        result = inventory.generate_from_sale(db, inv)
    except PostError as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    _audit(
        db, user, "inv_sale_generate", f"HĐ bán #{sid}",
        f"{len(result['issues'])} phiếu xuất · {len(result['productions'])} lệnh SX (nháp)",
    )
    return result


def _sale_line(db: Session, sid: int, line_id: int):
    inv = db.get(InvSale, sid)
    if not inv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hóa đơn bán")
    ln = next((l for l in inv.lines if l.id == line_id), None)
    if not ln:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy dòng hàng")
    return inv, ln


@router.post("/sale/{sid}/suggest-bom/{line_id}")
def sale_suggest_bom(
    sid: int,
    line_id: int,
    body: SuggestBomIn = SuggestBomIn(),
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    """AI opencode boc tach dong 'bo lap dat' -> linh kien, match vao ton kho.

    Enrich moi linh kien: DVT, gia von binh quan (chua thue), thue suat uoc luong
    (tu lan mua gan nhat), kha dung tai ngay HD (kiem tra thoi gian nhap). Kem
    tong hop (totals): gia von chua/co thue, bien loi nhuan thuc te, khoang gia
    ban de xuat theo bien 15-20%.
    """
    inv, ln = _sale_line(db, sid, line_id)
    all_items = list(db.scalars(select(InvItem).where(InvItem.active.is_(True))))
    agg: dict[int, list[float]] = {}
    agg_wh: dict[int, tuple[int, float]] = {}  # item_id -> (warehouse_id, ton) kho giu nhieu nhat
    for r in inventory.stock_snapshot(db):
        a = agg.setdefault(r.item_id, [0.0, 0.0])
        a[0] += r.ton
        a[1] += r.gia_tri
        if r.ton > inventory.EPS and (r.item_id not in agg_wh or r.ton > agg_wh[r.item_id][1]):
            agg_wh[r.item_id] = (r.warehouse_id, r.ton)
    avail: dict[int, float] = {}
    avail_wh: dict[int, tuple[int, float]] = {}  # item_id -> (warehouse_id, kha_dung) kho kha dung nhieu nhat
    if inv.ngay:
        for r in inventory.availability(db, inv.ngay):
            avail[r.item_id] = avail.get(r.item_id, 0.0) + (r.kha_dung or 0.0)
            kd = r.kha_dung or 0.0
            if kd > inventory.EPS and (r.item_id not in avail_wh or kd > avail_wh[r.item_id][1]):
                avail_wh[r.item_id] = (r.warehouse_id, kd)
    # Chi dua vao AI cac ma THUC SU con ton (SL > 0) — neu co ngay HD thi uu tien
    # kha dung tai ngay do (tranh AI goi y dung ma da het/chua ve kip, dan den
    # canh bao thieu thoi gian nhap sau nay).
    stock_items = []
    for it in all_items:
        ton_hien_tai = agg.get(it.id, [0.0, 0.0])[0]
        con_hang = avail.get(it.id, ton_hien_tai) if inv.ngay else ton_hien_tai
        if con_hang <= inventory.EPS:
            continue
        stock_items.append({
            "ma_hang": it.ma_hang, "ten": it.ten, "dvt": it.dvt,
            "don_gia_bq": (agg[it.id][1] / agg[it.id][0]) if ton_hien_tai > inventory.EPS else 0.0,
        })
    try:
        res = ai.suggest_bom(
            settings, ln.ten_raw, ln.don_gia_ban or ln.thanh_tien, stock_items,
            context=body.context,
            existing=[e.model_dump() for e in body.existing] or None,
        )
    except ai.AINotConfigured as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except ai.AIError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"AI lỗi: {e}")

    thue_cache: dict[int, float] = {}
    out = []
    cost_pretax = 0.0
    unmatched = 0
    for c in res["components"]:
        m, kind, cands = inv_import.match_suggestions(all_items, c["ten"])
        best = m or (cands[0][0] if cands else None)
        score = 1.0 if kind == "exact" else (cands[0][1] if cands else 0.0)
        dvt = don_gia_bq = thue_suat_est = kha_dung = 0.0
        dvt = ""
        warehouse_id = None
        if best:
            dvt = best.dvt
            a = agg.get(best.id, [0.0, 0.0])
            don_gia_bq = (a[1] / a[0]) if a[0] > inventory.EPS else 0.0
            if best.id not in thue_cache:
                thue_cache[best.id] = _last_thue_suat(db, best.id)
            thue_suat_est = thue_cache[best.id]
            kha_dung = avail.get(best.id, 0.0)
            # Uu tien kho co kha dung tai ngay HD; fallback kho dang giu ton
            # nhieu nhat — tranh gan mac dinh sai kho (vd luon "HH") cho hang
            # thuc chat nam o kho NVL/TP.
            best_wh = avail_wh.get(best.id) or agg_wh.get(best.id)
            warehouse_id = best_wh[0] if best_wh else None
        else:
            unmatched += 1
        cost_pretax += (c["so_luong"] or 0.0) * don_gia_bq
        out.append({
            **c,
            "match": {
                "item_id": best.id, "ma_hang": best.ma_hang, "ten": best.ten,
                "dvt": best.dvt, "score": round(score, 2), "warehouse_id": warehouse_id,
            } if best else None,
            "dvt": dvt,
            "don_gia_bq": round(don_gia_bq, 2),
            "thue_suat_est": thue_suat_est,
            "kha_dung_tai_ngay": round(kha_dung, 4),
        })

    gia_ban = ln.don_gia_ban or (ln.thanh_tien / ln.so_luong if ln.so_luong else 0.0)
    cost_with_tax = sum(
        (o["so_luong"] or 0.0) * o["don_gia_bq"] * (1 + (o["thue_suat_est"] or 0.0) / 100)
        for o in out
    )
    actual_margin = ((gia_ban - cost_pretax) / gia_ban * 100) if gia_ban else None
    _audit(db, user, "inv_bom_suggest", f"HĐ bán #{sid}", ln.ten_raw[:80])
    return {
        "components": out, "cost_est": res["cost_est"],
        "margin_est": res["margin_est"], "note": res["note"],
        "totals": {
            "cost_pretax": round(cost_pretax, 2),
            "cost_with_tax": round(cost_with_tax, 2),
            "unmatched_count": unmatched,
            "suggested_price_low": round(cost_pretax / 0.85, 2) if cost_pretax else 0.0,
            "suggested_price_high": round(cost_pretax / 0.80, 2) if cost_pretax else 0.0,
            "actual_gia_ban": round(gia_ban, 2),
            "actual_margin_pct": round(actual_margin, 1) if actual_margin is not None else None,
        },
    }


@router.post("/sale/{sid}/assemble/{line_id}")
def sale_assemble(
    sid: int,
    line_id: int,
    body: AssembleIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Tao LENH GHEP BO (draft) tu BOM da chot: tieu hao linh kien -> ra 1 Bo.

    Tuy chon: tao mat hang thanh pham moi cho bo, luu InvRecipe de dung lai.
    KHONG post — user duyet & ghi so tay (chan am kho).
    """
    inv, ln = _sale_line(db, sid, line_id)
    if inv.status == "void":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Hóa đơn đã hủy")
    if not body.components:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Chưa có linh kiện cấu thành")

    # Kiem tra thoi gian: linh kien phai co ton TRUOC ngay HD (ngay san xuat = ngay HD).
    # KHONG chan cung o day (user co the co ly do — hang ve trong ngay...) nhung PHAI canh bao
    # ro rang; validate_pairs khi POST that su moi la lop chan cung cuoi cung.
    timing_warnings: list[str] = []
    if inv.ngay:
        avail_now: dict[tuple[int, int], float] = {
            (r.item_id, r.warehouse_id): (r.kha_dung or 0.0)
            for r in inventory.availability(db, inv.ngay)
        }
        for c in body.components:
            kd = avail_now.get((c.item_id, c.warehouse_id), 0.0)
            if kd < c.so_luong - inventory.EPS:
                it = db.get(InvItem, c.item_id)
                timing_warnings.append(
                    f"⚠️ '{it.ten[:45] if it else c.item_id}' thiếu tại ngày {inv.ngay} "
                    f"(cần {c.so_luong:g}, khả dụng {kd:g}) — kiểm tra lại ngày nhập hàng "
                    f"trước khi ghi sổ (bán thứ chưa có đầu vào là sai thuế)"
                )

    out_item_id = body.output_item_id
    if not out_item_id:
        ma = body.output_ma_hang.strip()
        if not ma:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cần mã hàng cho thành phẩm bộ")
        if db.scalars(select(InvItem).where(InvItem.ma_hang == ma)).first():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Mã '{ma}' đã tồn tại")
        it = InvItem(
            ma_hang=ma, ten=ln.ten_raw[:500], ten_norm=normalize_name(ln.ten_raw),
            dvt=ln.dvt or "Bộ",
        )
        db.add(it)
        db.flush()
        out_item_id = it.id
    ln.item_id = out_item_id
    ln.match_kind = "manual"
    ln.fulfil_kind = "sx"

    # SL thanh pham can SX = SL dong HD. body.components la DINH MUC CHO 1 SP;
    # tieu hao LSX = dinh muc x qty (SX N cai thi tieu hao N lan dinh muc).
    qty = ln.so_luong or 1.0
    prod = InvProduction(
        ngay=inv.ngay, status="draft", sale_id=inv.id, sale_line_id=ln.id,
        note=f"Ghép bộ cho HĐ bán {inv.ky_hieu} {inv.so_hd} · {ln.ten_raw[:50]}",
    )
    db.add(prod)
    db.add(InvProductionLine(
        production=prod, chieu="ra", item_id=out_item_id,
        warehouse_id=body.output_warehouse_id, so_luong=qty,
    ))
    for c in body.components:
        db.add(InvProductionLine(
            production=prod, chieu="vao", item_id=c.item_id,
            warehouse_id=c.warehouse_id, so_luong=c.so_luong * qty, note=c.note,
        ))
    db.flush()

    recipe_id = None
    if body.save_recipe:
        # Cong thuc luu theo mo hinh "dinh muc cho 1 san pham" (output_qty=1).
        r = InvRecipe(
            name=(body.recipe_name or ln.ten_raw)[:255], output_item_id=out_item_id,
            output_qty=1, note=f"Từ ghép bộ HĐ bán {inv.ky_hieu} {inv.so_hd}",
        )
        db.add(r)
        for c in body.components:
            db.add(InvRecipeLine(
                recipe=r, item_id=c.item_id, warehouse_id=c.warehouse_id, so_luong=c.so_luong,
            ))
        db.flush()
        recipe_id = r.id

    db.commit()
    _audit(db, user, "inv_sale_assemble", f"HĐ bán #{sid}", f"LSX #{prod.id} · {ln.ten_raw[:60]}")
    return {
        "production_id": prod.id, "output_item_id": out_item_id, "recipe_id": recipe_id,
        "warnings": timing_warnings,
    }


# ---------------------------------------------------------------------------
# Phieu xuat kho
# ---------------------------------------------------------------------------
def _issue_out(db: Session, iss: InvIssue) -> InvIssueOut:
    items = {i.id: i for i in db.scalars(select(InvItem))}
    whs = {w.id: w for w in db.scalars(select(InvWarehouse))}
    moves = {
        m.ref_line_id: m
        for m in db.scalars(
            select(InvMove).where(InvMove.ref_type == "issue", InvMove.ref_id == iss.id)
        )
    }
    # Don gia binh quan hien tai theo cap (item, kho) -> uoc tinh gia von cho draft
    snap_pair: dict[tuple[int, int], list[float]] = {}
    for r in inventory.stock_snapshot(db):
        b = snap_pair.setdefault((r.item_id, r.warehouse_id), [0.0, 0.0])
        b[0] += r.ton
        b[1] += r.gia_tri
    lines = []
    for ln in iss.lines:
        it = items.get(ln.item_id)
        mv = moves.get(ln.id)
        wh = whs.get(ln.warehouse_id)
        # Giu mo hinh binh quan di dong: hien gia von SONG tu so kho (tinh lai khi
        # co HD mua lui ngay). Cot ln.gia_von chi la snapshot luu khi post (in an).
        gia_von = mv.gia_tri if mv is not None else (ln.gia_von or 0)
        b = snap_pair.get((ln.item_id, ln.warehouse_id), [0.0, 0.0])
        bq = (b[1] / b[0]) if b[0] > inventory.EPS else 0.0
        lines.append(InvIssueLineOut(
            id=ln.id, item_id=ln.item_id,
            ma_hang=it.ma_hang if it else "", ten=it.ten if it else "",
            dvt=it.dvt if it else "", warehouse_id=ln.warehouse_id,
            warehouse_code=wh.code if wh else "",
            so_luong=ln.so_luong, don_gia_ban=ln.don_gia_ban,
            thanh_tien_ban=ln.thanh_tien_ban or round(ln.so_luong * (ln.don_gia_ban or 0)),
            gia_von=gia_von,
            gia_von_uoc=round(ln.so_luong * bq),
            don_gia_von_uoc=round(bq, 2),
        ))
    cust = db.get(Customer, iss.customer_id) if iss.customer_id else None
    # Dinh khoan goi y tuc thoi (khi con draft chua luu tk) de FE hien thi
    tk_no, tk_co = iss.tk_no, iss.tk_co
    if not tk_no or not tk_co:
        dn, dc = inventory.dinh_khoan_xuat(iss.muc_dich or "ban")
        tk_no = tk_no or dn
        tk_co = tk_co or dc
    return InvIssueOut(
        id=iss.id, so_ct=iss.so_ct, ngay=iss.ngay, customer_id=iss.customer_id,
        customer_name=cust.name if cust else "", muc_dich=iss.muc_dich or "ban",
        ly_do=iss.ly_do, nguoi_nhan=iss.nguoi_nhan, bo_phan=iss.bo_phan,
        tk_no=tk_no, tk_co=tk_co,
        tong_gia_von=sum(l.gia_von for l in lines),
        tong_gia_von_uoc=sum(l.gia_von_uoc for l in lines),
        note=iss.note, status=iss.status,
        created_at=iss.created_at.isoformat() if iss.created_at else "", lines=lines,
    )


@router.post("/issues", response_model=InvIssueOut)
def issue_create(
    body: InvIssueIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    iss = InvIssue(
        ngay=body.ngay, customer_id=body.customer_id, note=body.note,
        muc_dich=body.muc_dich or "ban", ly_do=body.ly_do,
        nguoi_nhan=body.nguoi_nhan, bo_phan=body.bo_phan,
        tk_no=body.tk_no, tk_co=body.tk_co, created_by=user.id,
    )
    db.add(iss)
    for ln in body.lines:
        db.add(InvIssueLine(
            issue=iss, item_id=ln.item_id, warehouse_id=ln.warehouse_id,
            so_luong=ln.so_luong, don_gia_ban=ln.don_gia_ban,
        ))
    db.commit()
    db.refresh(iss)
    _audit(db, user, "inv_issue_create", f"PX #{iss.id}", body.ngay)
    return _issue_out(db, iss)


@router.get("/issues", response_model=list[InvIssueOut])
def issue_list(
    status_f: str = "",
    tu: str = "",
    den: str = "",
    limit: int = 100,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    stmt = select(InvIssue)
    if status_f:
        stmt = stmt.where(InvIssue.status == status_f)
    if tu:
        stmt = stmt.where(InvIssue.ngay >= tu)
    if den:
        stmt = stmt.where(InvIssue.ngay <= den)
    stmt = stmt.order_by(InvIssue.id.desc()).limit(min(limit, 500))
    return [_issue_out(db, i) for i in db.scalars(stmt)]


@router.get("/issues/export-xlsx")
def issue_export_xlsx(
    tu: str = "",
    den: str = "",
    status_f: str = "",
    ids: str = "",
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    stmt = _export_scope(select(InvIssue), InvIssue, ids, tu, den, status_f)
    stmt = stmt.order_by(InvIssue.ngay, InvIssue.id)
    items = {i.id: i for i in db.scalars(select(InvItem))}
    whs = {w.id: w for w in db.scalars(select(InvWarehouse))}
    customers = {c.id: c for c in db.scalars(select(Customer))}
    px_rows, dong_rows = [], []
    for iss in db.scalars(stmt):
        cust = customers.get(iss.customer_id) if iss.customer_id else None
        tong_gia_von = sum(l.gia_von for l in iss.lines)
        px_rows.append([
            iss.so_ct, iss.ngay, cust.name if cust else "", iss.muc_dich,
            iss.tk_no, iss.tk_co, iss.note, tong_gia_von, _STATUS_VI.get(iss.status, iss.status),
        ])
        for ln in iss.lines:
            it = items.get(ln.item_id)
            wh = whs.get(ln.warehouse_id)
            dong_rows.append([
                iss.so_ct, it.ma_hang if it else "", it.ten if it else "",
                wh.code if wh else "", ln.so_luong, ln.don_gia_ban, ln.gia_von,
            ])
    sheets = [
        ("Phiếu xuất", [
            "Số CT", "Ngày", "Khách hàng", "Mục đích", "TK Nợ", "TK Có", "Ghi chú",
            "Tổng giá vốn", "Trạng thái",
        ], px_rows),
        ("Dòng", ["Số CT", "Mã hàng", "Tên", "Kho", "SL", "Giá bán", "Giá vốn"], dong_rows),
    ]
    return inv_export.xlsx_response(sheets, "phieu-xuat-kho.xlsx")


@router.patch("/issues/{iid}", response_model=InvIssueOut)
def issue_update(
    iid: int,
    body: InvIssueIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    iss = db.get(InvIssue, iid)
    if not iss:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy phiếu xuất")
    if iss.status != "draft":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Chỉ sửa được bản nháp")
    iss.ngay = body.ngay
    iss.customer_id = body.customer_id
    iss.note = body.note
    iss.muc_dich = body.muc_dich or "ban"
    iss.ly_do = body.ly_do
    iss.nguoi_nhan = body.nguoi_nhan
    iss.bo_phan = body.bo_phan
    iss.tk_no = body.tk_no
    iss.tk_co = body.tk_co
    for ln in list(iss.lines):
        db.delete(ln)
    for ln in body.lines:
        db.add(InvIssueLine(
            issue=iss, item_id=ln.item_id, warehouse_id=ln.warehouse_id,
            so_luong=ln.so_luong, don_gia_ban=ln.don_gia_ban,
        ))
    db.commit()
    db.refresh(iss)
    return _issue_out(db, iss)


@router.delete("/issues/{iid}")
def issue_delete(
    iid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    iss = db.get(InvIssue, iid)
    if not iss:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy phiếu xuất")
    if iss.status == "posted":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Phiếu đã ghi sổ — hủy ghi sổ trước")
    db.delete(iss)
    db.commit()
    _audit(db, user, "inv_issue_delete", f"PX #{iid}")
    return {"ok": True}


@router.post("/issues/{iid}/post", response_model=InvIssueOut)
def issue_post(
    iid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    iss = db.get(InvIssue, iid)
    if not iss:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy phiếu xuất")
    try:
        inventory.post_issue(db, iss)
    except PostError as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except NegativeStockError as e:
        db.rollback()
        raise _neg(e)
    _audit(db, user, "inv_issue_post", f"PX #{iid}", iss.ngay)
    return _issue_out(db, iss)


@router.post("/issues/{iid}/void", response_model=InvIssueOut)
def issue_void(
    iid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    iss = db.get(InvIssue, iid)
    if not iss:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy phiếu xuất")
    try:
        inventory.unpost_issue(db, iss)
    except PostError as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except NegativeStockError as e:
        db.rollback()
        raise _neg(e)
    _audit(db, user, "inv_issue_void", f"PX #{iid}")
    return _issue_out(db, iss)


# ---------------------------------------------------------------------------
# San xuat
# ---------------------------------------------------------------------------
def _prod_out(db: Session, prod: InvProduction) -> InvProductionOut:
    items = {i.id: i for i in db.scalars(select(InvItem))}
    moves = {
        m.ref_line_id: m
        for m in db.scalars(
            select(InvMove).where(
                InvMove.ref_type == "production", InvMove.ref_id == prod.id
            )
        )
    }
    # Dinh muc tu cong thuc (neu gan recipe_id): item_id -> so_luong dinh muc,
    # da quy doi theo ti le SL thanh pham cua lenh / SL thanh pham cua cong thuc.
    dinh_muc: dict[int, float] = {}
    if prod.recipe_id:
        rec = db.get(InvRecipe, prod.recipe_id)
        if rec and rec.output_qty:
            out_qty_prod = sum(l.so_luong for l in prod.lines if l.chieu == "ra")
            ratio = (out_qty_prod / rec.output_qty) if rec.output_qty else 1.0
            for rl in rec.lines:
                dinh_muc[rl.item_id] = dinh_muc.get(rl.item_id, 0.0) + rl.so_luong * ratio
    # Don gia binh quan hien tai: snap theo item (dinh muc) + theo cap (item,kho)
    # cho uoc tinh gia von tieu hao dung theo kho.
    snap: dict[int, list[float]] = {}
    snap_pair: dict[tuple[int, int], list[float]] = {}
    for r in inventory.stock_snapshot(db):
        a = snap.setdefault(r.item_id, [0.0, 0.0])
        a[0] += r.ton
        a[1] += r.gia_tri
        b = snap_pair.setdefault((r.item_id, r.warehouse_id), [0.0, 0.0])
        b[0] += r.ton
        b[1] += r.gia_tri
    lines = []
    nvl_uoc = 0.0
    for ln in sorted(prod.lines, key=lambda x: (x.chieu != "vao", x.id)):
        it = items.get(ln.item_id)
        mv = moves.get(ln.id)
        sl_dm = gt_dm = None
        if ln.chieu == "vao" and ln.item_id in dinh_muc:
            sl_dm = round(dinh_muc[ln.item_id], 4)
            a = snap.get(ln.item_id, [0.0, 0.0])
            dg = (a[1] / a[0]) if a[0] > inventory.EPS else (ln.don_gia_tam or 0.0)
            gt_dm = round(sl_dm * dg)
        gia_tri_uoc = 0
        if ln.chieu == "vao":
            b = snap_pair.get((ln.item_id, ln.warehouse_id), [0.0, 0.0])
            bq = (b[1] / b[0]) if b[0] > inventory.EPS else (ln.don_gia_tam or 0.0)
            gia_tri_uoc = round(ln.so_luong * bq)
            nvl_uoc += gia_tri_uoc
        lines.append(InvProductionLineOut(
            id=ln.id, chieu=ln.chieu, item_id=ln.item_id,
            ma_hang=it.ma_hang if it else "", ten=it.ten if it else "",
            dvt=it.dvt if it else "", warehouse_id=ln.warehouse_id,
            so_luong=ln.so_luong, don_gia_tam=ln.don_gia_tam or 0,
            gia_tri=mv.gia_tri if mv else 0, gia_tri_uoc=gia_tri_uoc,
            so_luong_dinh_muc=sl_dm, gia_tri_dinh_muc=gt_dm,
        ))
    out_qty = sum(l.so_luong for l in prod.lines if l.chieu == "ra")
    tong_uoc = nvl_uoc + (prod.cp_nhan_cong or 0) + (prod.cp_sxc or 0)
    return InvProductionOut(
        id=prod.id, so_ct=prod.so_ct, ngay=prod.ngay, note=prod.note,
        description=prod.description, status=prod.status, recipe_id=prod.recipe_id,
        cp_nhan_cong=prod.cp_nhan_cong or 0, cp_sxc=prod.cp_sxc or 0,
        tong_gia_thanh=prod.tong_gia_thanh or 0,
        tong_gia_thanh_uoc=tong_uoc,
        gia_thanh_dv_uoc=round(tong_uoc / out_qty) if out_qty else 0,
        gia_ban_du_kien=prod.gia_ban_du_kien or 0,
        sale_id=prod.sale_id,
        created_at=prod.created_at.isoformat() if prod.created_at else "", lines=lines,
    )


@router.post("/productions", response_model=InvProductionOut)
def production_create(
    body: InvProductionIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    prod = InvProduction(
        ngay=body.ngay, note=body.note, description=body.description,
        recipe_id=body.recipe_id,
        cp_nhan_cong=body.cp_nhan_cong or 0, cp_sxc=body.cp_sxc or 0,
        gia_ban_du_kien=body.gia_ban_du_kien or 0,
    )
    db.add(prod)
    for ln in body.lines:
        if ln.chieu not in ("vao", "ra"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "chieu phải là 'vao' hoặc 'ra'")
        db.add(InvProductionLine(
            production=prod, chieu=ln.chieu, item_id=ln.item_id,
            warehouse_id=ln.warehouse_id, so_luong=ln.so_luong,
            don_gia_tam=ln.don_gia_tam or 0,
        ))
    db.commit()
    db.refresh(prod)
    _audit(db, user, "inv_production_create", f"LSX #{prod.id}", body.ngay)
    return _prod_out(db, prod)


@router.get("/productions", response_model=list[InvProductionOut])
def production_list(
    status_f: str = "",
    tu: str = "",
    den: str = "",
    limit: int = 100,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    stmt = select(InvProduction)
    if status_f:
        stmt = stmt.where(InvProduction.status == status_f)
    if tu:
        stmt = stmt.where(InvProduction.ngay >= tu)
    if den:
        stmt = stmt.where(InvProduction.ngay <= den)
    stmt = stmt.order_by(InvProduction.id.desc()).limit(min(limit, 500))
    return [_prod_out(db, p) for p in db.scalars(stmt)]


@router.get("/productions/export-xlsx")
def production_export_xlsx(
    tu: str = "",
    den: str = "",
    status_f: str = "",
    ids: str = "",
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    stmt = _export_scope(select(InvProduction), InvProduction, ids, tu, den, status_f)
    stmt = stmt.order_by(InvProduction.ngay, InvProduction.id)
    items = {i.id: i for i in db.scalars(select(InvItem))}
    whs = {w.id: w for w in db.scalars(select(InvWarehouse))}
    moves = {
        (m.ref_id, m.ref_line_id): m
        for m in db.scalars(select(InvMove).where(InvMove.ref_type == "production"))
    }
    lsx_rows, dong_rows = [], []
    for prod in db.scalars(stmt):
        out_line = next((l for l in prod.lines if l.chieu == "ra"), None)
        it_out = items.get(out_line.item_id) if out_line else None
        lsx_rows.append([
            prod.so_ct, prod.ngay, it_out.ten if it_out else "",
            prod.tong_gia_thanh, prod.cp_nhan_cong, prod.cp_sxc,
            _STATUS_VI.get(prod.status, prod.status),
        ])
        for ln in sorted(prod.lines, key=lambda x: (x.chieu != "vao", x.id)):
            it = items.get(ln.item_id)
            wh = whs.get(ln.warehouse_id)
            mv = moves.get((prod.id, ln.id))
            dong_rows.append([
                prod.so_ct, ln.chieu, it.ma_hang if it else "", it.ten if it else "",
                wh.code if wh else "", ln.so_luong, mv.gia_tri if mv else 0,
            ])
    sheets = [
        ("Lệnh SX", [
            "Số CT", "Ngày", "Thành phẩm", "Tổng giá thành", "CP NC", "CP SXC", "Trạng thái",
        ], lsx_rows),
        ("Dòng", ["Số CT", "Chiều", "Mã hàng", "Tên", "Kho", "SL", "Giá trị"], dong_rows),
    ]
    return inv_export.xlsx_response(sheets, "lenh-san-xuat.xlsx")


@router.patch("/productions/{pid}", response_model=InvProductionOut)
def production_update(
    pid: int,
    body: InvProductionIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    prod = db.get(InvProduction, pid)
    if not prod:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lệnh sản xuất")
    if prod.status != "draft":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Chỉ sửa được bản nháp")
    prod.ngay = body.ngay
    prod.note = body.note
    prod.description = body.description
    prod.recipe_id = body.recipe_id
    prod.cp_nhan_cong = body.cp_nhan_cong or 0
    prod.cp_sxc = body.cp_sxc or 0
    prod.gia_ban_du_kien = body.gia_ban_du_kien or 0
    for ln in list(prod.lines):
        db.delete(ln)
    for ln in body.lines:
        db.add(InvProductionLine(
            production=prod, chieu=ln.chieu, item_id=ln.item_id,
            warehouse_id=ln.warehouse_id, so_luong=ln.so_luong,
            don_gia_tam=ln.don_gia_tam or 0,
        ))
    db.commit()
    db.refresh(prod)
    return _prod_out(db, prod)


@router.delete("/productions/{pid}")
def production_delete(
    pid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    prod = db.get(InvProduction, pid)
    if not prod:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lệnh sản xuất")
    if prod.status == "posted":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Lệnh đã ghi sổ — hủy ghi sổ trước")
    db.delete(prod)
    db.commit()
    _audit(db, user, "inv_production_delete", f"LSX #{pid}")
    return {"ok": True}


@router.post("/productions/{pid}/post", response_model=InvProductionOut)
def production_post(
    pid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    prod = db.get(InvProduction, pid)
    if not prod:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lệnh sản xuất")
    try:
        inventory.post_production(db, prod)
    except PostError as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except NegativeStockError as e:
        db.rollback()
        raise _neg(e)
    _audit(db, user, "inv_production_post", f"LSX #{pid}", prod.ngay)
    return _prod_out(db, prod)


@router.post("/productions/{pid}/void", response_model=InvProductionOut)
def production_void(
    pid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    prod = db.get(InvProduction, pid)
    if not prod:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lệnh sản xuất")
    try:
        inventory.unpost_production(db, prod)
    except PostError as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except NegativeStockError as e:
        db.rollback()
        raise _neg(e)
    _audit(db, user, "inv_production_void", f"LSX #{pid}")
    return _prod_out(db, prod)


# ---------------------------------------------------------------------------
# Cong thuc san xuat
# ---------------------------------------------------------------------------
def _recipe_out(
    db: Session, r: InvRecipe, snap: dict[int, list[float]] | None = None
) -> InvRecipeOut:
    items = {i.id: i for i in db.scalars(select(InvItem))}
    out_item = items.get(r.output_item_id)
    # Don gia binh quan hien tai (giong _prod_out) de uoc tinh gia thanh cong thuc
    if snap is None:
        snap = {}
        for row in inventory.stock_snapshot(db):
            a = snap.setdefault(row.item_id, [0.0, 0.0])
            a[0] += row.ton
            a[1] += row.gia_tri
    lines = []
    tong_gia_tri = 0.0
    thieu_gia = False
    for ln in r.lines:
        a = snap.get(ln.item_id, [0.0, 0.0])
        don_gia_bq = (a[1] / a[0]) if a[0] > inventory.EPS else 0.0
        gia_tri = round(ln.so_luong * don_gia_bq)
        tong_gia_tri += gia_tri
        if don_gia_bq == 0:
            thieu_gia = True
        lines.append({
            "item_id": ln.item_id,
            "ma_hang": items[ln.item_id].ma_hang if ln.item_id in items else "",
            "ten": items[ln.item_id].ten if ln.item_id in items else "",
            "dvt": items[ln.item_id].dvt if ln.item_id in items else "",
            "warehouse_id": ln.warehouse_id,
            "so_luong": ln.so_luong,
            "don_gia_bq": round(don_gia_bq, 2),
            "gia_tri": gia_tri,
        })
    return InvRecipeOut(
        id=r.id, name=r.name, output_item_id=r.output_item_id,
        output_ten=out_item.ten if out_item else "", output_qty=r.output_qty,
        description=r.description or "",
        tong_gia_tri=tong_gia_tri,
        gia_thanh_dv=round(tong_gia_tri / r.output_qty) if r.output_qty else 0,
        thieu_gia=thieu_gia,
        lines=lines,
    )


@router.get("/recipes", response_model=list[InvRecipeOut])
def recipe_list(
    user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    # Tinh snapshot ton kho 1 lan roi tai dung cho moi cong thuc (tranh O(N x snapshot))
    snap: dict[int, list[float]] = {}
    for row in inventory.stock_snapshot(db):
        a = snap.setdefault(row.item_id, [0.0, 0.0])
        a[0] += row.ton
        a[1] += row.gia_tri
    return [
        _recipe_out(db, r, snap)
        for r in db.scalars(select(InvRecipe).order_by(InvRecipe.name))
    ]


@router.post("/recipes", response_model=InvRecipeOut)
def recipe_create(
    body: InvRecipeIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    r = InvRecipe(
        name=body.name, output_item_id=body.output_item_id,
        output_qty=body.output_qty, description=body.description,
    )
    db.add(r)
    for ln in body.lines:
        db.add(InvRecipeLine(
            recipe=r, item_id=ln.item_id, warehouse_id=ln.warehouse_id, so_luong=ln.so_luong,
        ))
    db.commit()
    db.refresh(r)
    _audit(db, user, "inv_recipe_create", body.name)
    return _recipe_out(db, r)


@router.patch("/recipes/{rid}", response_model=InvRecipeOut)
def recipe_update(
    rid: int,
    body: InvRecipeIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    r = db.get(InvRecipe, rid)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy công thức")
    r.name = body.name
    r.output_item_id = body.output_item_id
    r.output_qty = body.output_qty
    r.description = body.description
    for ln in list(r.lines):
        db.delete(ln)
    for ln in body.lines:
        db.add(InvRecipeLine(
            recipe=r, item_id=ln.item_id, warehouse_id=ln.warehouse_id, so_luong=ln.so_luong,
        ))
    db.commit()
    db.refresh(r)
    _audit(db, user, "inv_recipe_update", body.name)
    return _recipe_out(db, r)


@router.delete("/recipes/{rid}")
def recipe_delete(
    rid: int, user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    r = db.get(InvRecipe, rid)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy công thức")
    db.delete(r)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# AI sinh mo ta NVL + tien ich gia von
# ---------------------------------------------------------------------------
def _ai_describe(settings: Settings, output_ten, output_dvt, output_qty, lines) -> str:
    """Goi AI sinh mo ta; chuyen doi loi AI thanh HTTP 400/502."""
    try:
        return ai.describe_bom(settings, output_ten, lines, output_qty, output_dvt)
    except ai.AINotConfigured as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except ai.AIError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"AI lỗi: {e}")


@router.post("/describe-bom")
def describe_bom_adhoc(
    body: DescribeBomIn,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    """Sinh mo ta tu danh sach NVL truyen truc tiep (form chua luu). Khong luu DB."""
    lines = [
        {"ten": ln.ten, "so_luong": ln.so_luong, "dvt": ln.dvt} for ln in body.lines
    ]
    text = _ai_describe(settings, body.output_ten, body.output_dvt, body.output_qty, lines)
    return {"description": text}


@router.post("/recipes/{rid}/describe", response_model=InvRecipeOut)
def recipe_describe(
    rid: int,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    r = db.get(InvRecipe, rid)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy công thức")
    items = {i.id: i for i in db.scalars(select(InvItem))}
    out_item = items.get(r.output_item_id)
    lines = [
        {
            "ten": items[ln.item_id].ten if ln.item_id in items else "",
            "so_luong": ln.so_luong,
            "dvt": items[ln.item_id].dvt if ln.item_id in items else "",
        }
        for ln in r.lines
    ]
    text = _ai_describe(
        settings, out_item.ten if out_item else "",
        out_item.dvt if out_item else "", r.output_qty, lines,
    )
    r.description = text[:500]
    db.commit()
    db.refresh(r)
    _audit(db, user, "inv_recipe_describe", r.name)
    return _recipe_out(db, r)


@router.post("/productions/{pid}/describe", response_model=InvProductionOut)
def production_describe(
    pid: int,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    prod = db.get(InvProduction, pid)
    if not prod:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lệnh sản xuất")
    items = {i.id: i for i in db.scalars(select(InvItem))}
    outs = [ln for ln in prod.lines if ln.chieu == "ra"]
    out_item = items.get(outs[0].item_id) if outs else None
    out_qty = sum(ln.so_luong for ln in outs) or 1
    lines = [
        {
            "ten": items[ln.item_id].ten if ln.item_id in items else "",
            "so_luong": ln.so_luong,
            "dvt": items[ln.item_id].dvt if ln.item_id in items else "",
        }
        for ln in prod.lines if ln.chieu == "vao"
    ]
    text = _ai_describe(
        settings, out_item.ten if out_item else "",
        out_item.dvt if out_item else "", out_qty, lines,
    )
    prod.description = text[:500]
    db.commit()
    db.refresh(prod)
    _audit(db, user, "inv_production_describe", f"LSX #{pid}")
    return _prod_out(db, prod)


@router.post("/recalc-cost")
def recalc_cost(
    user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    """Tinh lai gia xuat kho (replay) cho toan bo cap (mat hang, kho).

    Gan lai don_gia/gia_tri cac dong xuat theo binh quan gia quyen hien hanh —
    khac phuc phieu treo don gia. Bao am kho neu co (rollback + 400).
    """
    pairs = {(m.item_id, m.warehouse_id) for m in db.scalars(select(InvMove))}
    try:
        inventory.validate_pairs(db, pairs)
    except NegativeStockError as e:
        db.rollback()
        raise _neg(e)
    db.commit()
    _audit(db, user, "inv_recalc_cost", f"{len(pairs)} cặp")
    return {"ok": True, "pairs": len(pairs)}


@router.get("/hanging-value")
def hanging_value(
    user: CurrentUser = Depends(require_admin), db: Session = Depends(get_session)
):
    """Liet ke mat hang co gia tri treo: SL>0 nhung gia tri=0, hoac nguoc lai."""
    items = {i.id: i for i in db.scalars(select(InvItem))}
    whs = {w.id: w for w in db.scalars(select(InvWarehouse))}
    rows = []
    for r in inventory.stock_snapshot(db):
        ton, gt = r.ton, r.gia_tri
        treo = (ton > inventory.EPS and abs(gt) < 1) or (abs(ton) <= inventory.EPS and abs(gt) >= 1)
        if not treo:
            continue
        it = items.get(r.item_id)
        wh = whs.get(r.warehouse_id)
        rows.append({
            "item_id": r.item_id,
            "ma_hang": it.ma_hang if it else "",
            "ten": it.ten if it else "",
            "warehouse_code": wh.code if wh else "",
            "ton": round(ton, 4),
            "gia_tri": round(gt, 2),
        })
    return {"rows": rows}
