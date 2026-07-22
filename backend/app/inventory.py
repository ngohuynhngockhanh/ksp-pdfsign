"""Engine so kho: replay gia binh quan gia quyen + chan am kho.

Nguyen tac: moi lan post/void chung tu -> replay() lai toan bo so cua tung cap
(mat hang, kho) bi anh huong, theo thu tu (ngay, uu tien loai, id):
- Dong NHAP giu nguyen don_gia/gia_tri da ghi (tu chung tu goc).
- Dong XUAT duoc TINH LAI don_gia = gia binh quan tai thoi diem do.
- Bat ky thoi diem nao ton < 0 -> tra ve Violation; caller rollback + bao 400.
Mot thuat toan = tinh gia von + chan am kho + xu ly chung tu nhap lui ngay.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import (
    InvCustomsDecl,
    InvIssue,
    InvIssueLine,
    InvItem,
    InvItemAlias,
    InvMove,
    InvProduction,
    InvProductionLine,
    InvPurchase,
    InvRecipe,
    InvWarehouse,
)

EPS = 1e-6

# Cung ngay: dau_ky -> nhap -> dieu chinh -> xuat ("nhap truoc, xuat sau trong ngay")
LOAI_PRIORITY = {
    "dau_ky": 0,
    "nhap": 1,
    "sx_in": 1,
    "dieu_chinh": 2,
    "sx_out": 3,
    "xuat": 3,
}
IN_TYPES = {"dau_ky", "nhap", "sx_in"}
OUT_TYPES = {"xuat", "sx_out"}

LOAI_LABELS = {
    "dau_ky": "Tồn đầu kỳ",
    "nhap": "Nhập mua",
    "xuat": "Xuất bán",
    "sx_in": "Nhập thành phẩm",
    "sx_out": "Xuất sản xuất",
    "dieu_chinh": "Điều chỉnh",
}

# Dinh khoan goi y theo muc dich xuat kho (TT200/TT133). (No, Co, nhan).
# Chi la GOI Y de hien thi tren chung tu — he thong khong sinh but toan so cai.
DINH_KHOAN_XUAT: dict[str, tuple[str, str, str]] = {
    "ban": ("632", "156", "Xuất bán (giá vốn hàng bán)"),
    "san_xuat": ("621", "152", "Xuất nguyên vật liệu cho sản xuất"),
    "noi_bo": ("642", "152", "Xuất dùng nội bộ"),
    "dieu_chuyen": ("156", "156", "Điều chuyển kho nội bộ"),
    "huy": ("811", "152", "Xuất huỷ/thanh lý"),
}


# Dinh muc nhan cong trung binh de uoc luong loi nhuan (dong / 1 thanh pham SX).
# Chi ap cho dong xuat tu kho TP — hang thuong mai khong co nhan cong.
NHAN_CONG_PER_SP = 300_000


def dinh_khoan_xuat(muc_dich: str) -> tuple[str, str]:
    """Tra ve (tk_no, tk_co) goi y theo muc dich xuat; mac dinh 'ban'."""
    no, co, _ = DINH_KHOAN_XUAT.get(muc_dich, DINH_KHOAN_XUAT["ban"])
    return no, co


@dataclass
class Violation:
    """Mot thoi diem ton kho bi am."""

    item_id: int
    warehouse_id: int
    ngay: str
    thieu: float  # so luong bi am (duong)
    loai: str = ""
    ma_hang: str = ""
    ten: str = ""


class NegativeStockError(Exception):
    """Ghi so se lam am kho — caller phai rollback."""

    def __init__(self, violations: list[Violation]):
        self.violations = violations
        super().__init__("Âm kho")

    def detail(self) -> dict:
        return {
            "message": "Không thể ghi sổ: tồn kho bị âm (bán thứ chưa có đầu vào)",
            "violations": [
                {
                    "item_id": v.item_id,
                    "ma_hang": v.ma_hang,
                    "ten": v.ten,
                    "warehouse_id": v.warehouse_id,
                    "ngay": v.ngay,
                    "thieu": round(v.thieu, 4),
                }
                for v in self.violations
            ],
        }


def sort_key(m: InvMove) -> tuple:
    return (m.ngay, LOAI_PRIORITY.get(m.loai, 2), m.id or 0)


def _is_inbound(m: InvMove) -> bool:
    return m.loai in IN_TYPES or (m.loai == "dieu_chinh" and m.so_luong >= 0)


def _ordered_moves(db: Session, item_id: int, warehouse_id: int) -> list[InvMove]:
    moves = list(
        db.scalars(
            select(InvMove).where(
                InvMove.item_id == item_id, InvMove.warehouse_id == warehouse_id
            )
        )
    )
    moves.sort(key=sort_key)
    return moves


def replay(db: Session, item_id: int, warehouse_id: int) -> list[Violation]:
    """Tinh lai gia xuat binh quan + kiem tra am kho cho 1 cap (mat hang, kho).

    Ghi de don_gia/gia_tri cac dong xuat ngay tren session (chua commit).
    """
    qty = 0.0
    value = 0.0
    violations: list[Violation] = []
    for m in _ordered_moves(db, item_id, warehouse_id):
        if _is_inbound(m):
            q = abs(m.so_luong)
            # Dong nhap: giu gia_tri da ghi tu chung tu (chinh xac theo hoa don);
            # neu chua co thi tinh tu don_gia.
            if not m.gia_tri:
                m.gia_tri = round(q * m.don_gia)
            qty += q
            value += m.gia_tri
        else:
            q = abs(m.so_luong)
            avg = (value / qty) if qty > EPS else 0.0
            m.don_gia = avg
            m.gia_tri = round(q * avg)
            qty -= q
            value -= m.gia_tri
            if -EPS <= qty <= EPS:
                value = 0.0  # xa so du lam tron khi het hang
        if qty < -EPS:
            violations.append(
                Violation(
                    item_id=item_id,
                    warehouse_id=warehouse_id,
                    ngay=m.ngay,
                    thieu=-qty,
                    loai=m.loai,
                )
            )
    return violations


def validate_pairs(db: Session, pairs: set[tuple[int, int]]) -> None:
    """Replay cac cap bi anh huong; neu am kho -> raise NegativeStockError.

    Caller phai bat exception va db.rollback().
    """
    violations: list[Violation] = []
    for item_id, wh_id in sorted(pairs):
        violations.extend(replay(db, item_id, wh_id))
    if violations:
        items = {
            i.id: i
            for i in db.scalars(
                select(InvItem).where(InvItem.id.in_({v.item_id for v in violations}))
            )
        }
        for v in violations:
            it = items.get(v.item_id)
            if it:
                v.ma_hang = it.ma_hang
                v.ten = it.ten
        raise NegativeStockError(violations)


@dataclass
class StockRow:
    item_id: int
    warehouse_id: int
    ton: float = 0.0
    gia_tri: float = 0.0
    kha_dung: float | None = None
    nhap_cuoi: str = ""  # ngay nhap (dau_ky/nhap/sx_in) gan nhat

    @property
    def don_gia_bq(self) -> float:
        return self.gia_tri / self.ton if self.ton > EPS else 0.0


def _all_moves_grouped(
    db: Session, warehouse_id: int | None = None
) -> dict[tuple[int, int], list[InvMove]]:
    q = select(InvMove)
    if warehouse_id:
        q = q.where(InvMove.warehouse_id == warehouse_id)
    grouped: dict[tuple[int, int], list[InvMove]] = {}
    for m in db.scalars(q):
        grouped.setdefault((m.item_id, m.warehouse_id), []).append(m)
    for moves in grouped.values():
        moves.sort(key=sort_key)
    return grouped


def stock_snapshot(
    db: Session, warehouse_id: int | None = None, as_of: str | None = None
) -> list[StockRow]:
    """Ton + gia tri hien tai (hoac tai ngay as_of) cua tung (mat hang, kho)."""
    rows: list[StockRow] = []
    for (item_id, wh_id), moves in _all_moves_grouped(db, warehouse_id).items():
        qty = 0.0
        value = 0.0
        nhap_cuoi = ""
        for m in moves:
            if as_of and m.ngay > as_of:
                break
            if _is_inbound(m):
                qty += abs(m.so_luong)
                value += m.gia_tri
                if m.ngay >= nhap_cuoi:  # moves sap theo ngay -> giu ngay nhap moi nhat
                    nhap_cuoi = m.ngay
            else:
                qty -= abs(m.so_luong)
                value -= m.gia_tri
                if -EPS <= qty <= EPS:
                    value = 0.0
        rows.append(StockRow(item_id=item_id, warehouse_id=wh_id, ton=qty, gia_tri=value, nhap_cuoi=nhap_cuoi))
    return rows


def availability(
    db: Session, ngay: str, warehouse_id: int | None = None
) -> list[StockRow]:
    """Kha dung tai ngay D cho tung (mat hang, kho).

    kha_dung = min(ton tai D, min ton tai moi thoi diem SAU D) — vi xuat them
    tai D se tru vao tat ca so du ve sau (co the da co phieu xuat tuong lai).
    """
    rows: list[StockRow] = []
    for (item_id, wh_id), moves in _all_moves_grouped(db, warehouse_id).items():
        bal = 0.0
        bal_at_d = 0.0
        min_future: float | None = None
        val_at_d = 0.0
        value = 0.0
        for m in moves:
            if _is_inbound(m):
                bal += abs(m.so_luong)
                value += m.gia_tri
            else:
                bal -= abs(m.so_luong)
                value -= m.gia_tri
                if -EPS <= bal <= EPS:
                    value = 0.0
            if m.ngay <= ngay:
                bal_at_d = bal
                val_at_d = value
            else:
                min_future = bal if min_future is None else min(min_future, bal)
        kha_dung = bal_at_d if min_future is None else min(bal_at_d, min_future)
        rows.append(
            StockRow(
                item_id=item_id,
                warehouse_id=wh_id,
                ton=bal_at_d,
                gia_tri=val_at_d,
                kha_dung=max(0.0, kha_dung),
            )
        )
    return rows


def stock_card(
    db: Session,
    item_id: int,
    warehouse_id: int,
    tu: str | None = None,
    den: str | None = None,
) -> list[dict]:
    """The kho: tung dong so + so du luy ke (loc theo khoang ngay sau khi tinh)."""
    qty = 0.0
    value = 0.0
    out: list[dict] = []
    for m in _ordered_moves(db, item_id, warehouse_id):
        inbound = _is_inbound(m)
        q = abs(m.so_luong)
        if inbound:
            qty += q
            value += m.gia_tri
        else:
            qty -= q
            value -= m.gia_tri
            if -EPS <= qty <= EPS:
                value = 0.0
        if tu and m.ngay < tu:
            continue
        if den and m.ngay > den:
            continue
        out.append(
            {
                "id": m.id,
                "ngay": m.ngay,
                "loai": m.loai,
                "loai_label": LOAI_LABELS.get(m.loai, m.loai),
                "nhap": q if inbound else 0.0,
                "xuat": 0.0 if inbound else q,
                "don_gia": m.don_gia,
                "gia_tri": m.gia_tri if inbound else -m.gia_tri,
                "ton": qty,
                "ton_gia_tri": value,
                "ref_type": m.ref_type,
                "ref_id": m.ref_id,
            }
        )
    return out


# ---------------------------------------------------------------------------
# Chuan hoa ten de match hoa don -> mat hang
# ---------------------------------------------------------------------------
def normalize_name(s: str) -> str:
    """Chu thuong, bo dau tieng Viet, gom khoang trang: de so khop ten hang."""
    s = (s or "").strip().lower().replace("đ", "d")
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s)


def normalize_so_hd(s: str) -> str:
    """Bo so 0 dau (00008407 -> 8407): de so sanh so HD giua cac nguon (XML/PDF/bang ke)."""
    s = (s or "").strip()
    if not s:
        return ""
    stripped = s.lstrip("0")
    return stripped or "0"


def get_warehouse_map(db: Session) -> dict[str, InvWarehouse]:
    return {w.code: w for w in db.scalars(select(InvWarehouse))}


# ---------------------------------------------------------------------------
# Ghi so / huy ghi so chung tu (post/unpost)
# ---------------------------------------------------------------------------
class PostError(Exception):
    """Chung tu chua du dieu kien ghi so (loi nghiep vu, tra 400)."""


_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _check_ngay(ngay: str) -> None:
    if not _ISO_RE.match(ngay or ""):
        raise PostError("Ngày chứng từ không hợp lệ (cần YYYY-MM-DD)")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _delete_ref_moves(db: Session, ref_type: str, ref_id: int) -> set[tuple[int, int]]:
    pairs: set[tuple[int, int]] = set()
    for m in db.scalars(
        select(InvMove).where(InvMove.ref_type == ref_type, InvMove.ref_id == ref_id)
    ):
        pairs.add((m.item_id, m.warehouse_id))
        db.delete(m)
    return pairs


def _upsert_purchase_aliases(db: Session, inv: InvPurchase) -> None:
    """Hoc alias tu cac dong da match tay/da hoc: (ten chuan hoa, MST ban) -> mat hang.

    Goi khi ghi so ok, TRUOC commit — de lan import sau tu dong khop, khong phai
    chon tay lai cung 1 ten hang cua cung 1 NCC.
    """
    mst = (inv.mst_ban or "").strip()
    for ln in inv.lines:
        if not ln.item_id or ln.match_kind not in ("manual", "learned"):
            continue
        ten_norm = normalize_name(ln.ten_raw)
        if not ten_norm:
            continue
        existing = db.scalars(
            select(InvItemAlias).where(
                InvItemAlias.ten_norm == ten_norm, InvItemAlias.mst_ban == mst
            )
        ).first()
        if existing is None:
            db.add(InvItemAlias(
                ten_norm=ten_norm, mst_ban=mst,
                item_id=ln.item_id, warehouse_id=ln.warehouse_id,
            ))
        else:
            existing.item_id = ln.item_id
            existing.warehouse_id = ln.warehouse_id


def post_purchase(db: Session, inv: InvPurchase) -> None:
    """Ghi so hoa don mua vao.

    hang_hoa: moi dong -> 1 move 'nhap' (vao kho).
    dich_vu: chi phi/dich vu -> chi danh dau da ghi so, KHONG nhap kho.
    """
    if inv.status != "draft":
        raise PostError(f"Hóa đơn đang ở trạng thái '{inv.status}', chỉ ghi sổ được bản nháp")
    _check_ngay(inv.ngay)
    # Chan ghi so trung (ca hai loai): cung MST ben ban + so HD (bo so 0 dau)
    so_hd_norm = normalize_so_hd(inv.so_hd)
    if inv.mst_ban and so_hd_norm:
        for other in db.scalars(
            select(InvPurchase).where(
                InvPurchase.status == "posted",
                InvPurchase.mst_ban == inv.mst_ban,
                InvPurchase.id != inv.id,
            )
        ):
            if normalize_so_hd(other.so_hd) == so_hd_norm:
                raise PostError(
                    f"Đã có hóa đơn #{other.id} ghi sổ với cùng MST bên bán + số HĐ "
                    f"{inv.so_hd} — coi chừng ghi sổ trùng"
                )

    if inv.loai == "dich_vu":
        # Hoa don dich vu/chi phi: chi luu vet + doi chieu bang ke, khong tao move
        inv.status = "posted"
        inv.posted_at = _utcnow()
        db.commit()
        return

    if not inv.lines:
        raise PostError("Hóa đơn chưa có dòng hàng nào")
    pairs: set[tuple[int, int]] = set()
    for ln in inv.lines:
        if not ln.item_id or not ln.warehouse_id:
            raise PostError(
                f"Dòng {ln.stt} ({ln.ten_raw[:40]}): chưa chọn mặt hàng/kho — phải khớp hết mới ghi sổ được"
            )
        if ln.so_luong <= 0:
            raise PostError(f"Dòng {ln.stt} ({ln.ten_raw[:40]}): số lượng phải > 0")
        # Thanh tien = so luong * don gia (tinh lai, khong tin so parse san)
        gia_tri = round(ln.so_luong * ln.don_gia)
        db.add(InvMove(
            item_id=ln.item_id,
            warehouse_id=ln.warehouse_id,
            ngay=inv.ngay,
            loai="nhap",
            so_luong=ln.so_luong,
            don_gia=ln.don_gia or (gia_tri / ln.so_luong),
            gia_tri=gia_tri,
            ref_type="purchase",
            ref_id=inv.id,
            ref_line_id=ln.id,
        ))
        pairs.add((ln.item_id, ln.warehouse_id))
    db.flush()
    validate_pairs(db, pairs)
    _upsert_purchase_aliases(db, inv)
    inv.status = "posted"
    inv.posted_at = _utcnow()
    db.commit()


def unpost_purchase(db: Session, inv: InvPurchase) -> None:
    """Huy ghi so (ve nhap): xoa moves; chan neu lam am kho phieu xuat sau do."""
    if inv.status != "posted":
        raise PostError("Hóa đơn chưa ghi sổ")
    pairs = _delete_ref_moves(db, "purchase", inv.id)
    db.flush()
    validate_pairs(db, pairs)
    inv.status = "draft"
    inv.posted_at = None
    db.commit()


def post_issue(db: Session, iss: InvIssue, override_reason: str | None = None) -> None:
    """Ghi so phieu xuat: moi dong -> 1 move 'xuat' (gia von do replay tinh).

    Sau khi replay tinh gia von: DONG BANG gia_von len tung dong phieu + luu
    tong_gia_von, sinh so chung tu, dinh khoan goi y (neu chua co).

    override_reason: neu co -> CHAP NHAN am kho (user thua nhan sai, se nhap bu).
    Van chay replay de tinh gia von (replay gan gia_tri truoc khi validate raise),
    chi KHONG chan. Danh dau iss.am_kho_override=True + luu ly do vao iss.ly_do.
    """
    if iss.status != "draft":
        raise PostError(f"Phiếu đang ở trạng thái '{iss.status}'")
    _check_ngay(iss.ngay)
    if not iss.lines:
        raise PostError("Phiếu xuất chưa có dòng hàng nào")
    pairs: set[tuple[int, int]] = set()
    line_moves: dict[int, InvMove] = {}
    for ln in iss.lines:
        if ln.so_luong <= 0:
            raise PostError(f"Dòng mặt hàng #{ln.item_id}: số lượng phải > 0")
        m = InvMove(
            item_id=ln.item_id,
            warehouse_id=ln.warehouse_id,
            ngay=iss.ngay,
            loai="xuat",
            so_luong=ln.so_luong,
            ref_type="issue",
            ref_id=iss.id,
            ref_line_id=ln.id,
        )
        db.add(m)
        line_moves[ln.id] = m
        pairs.add((ln.item_id, ln.warehouse_id))
    db.flush()
    if override_reason:
        # Chap nhan am kho: replay van gan gia_von len move, chi bo qua chan.
        try:
            validate_pairs(db, pairs)
        except NegativeStockError:
            pass
        iss.am_kho_override = True
        iss.ly_do = (override_reason or "")[:255]
    else:
        validate_pairs(db, pairs)  # tinh lai gia von (gan len move objects)
    # Dong bang gia von + thanh tien ban len tung dong; tong hop
    tong = 0.0
    for ln in iss.lines:
        m = line_moves.get(ln.id)
        ln.gia_von = m.gia_tri if m else 0.0
        ln.thanh_tien_ban = round(ln.so_luong * (ln.don_gia_ban or 0.0))
        tong += ln.gia_von
    iss.tong_gia_von = tong
    if not iss.tk_no or not iss.tk_co:
        no, co = dinh_khoan_xuat(iss.muc_dich or "ban")
        iss.tk_no = iss.tk_no or no
        iss.tk_co = iss.tk_co or co
    if not iss.so_ct:
        iss.so_ct = f"PX-{(iss.ngay or '')[:4] or '----'}-{iss.id:04d}"
    iss.status = "posted"
    iss.posted_at = _utcnow()
    db.commit()


def unpost_issue(db: Session, iss: InvIssue) -> None:
    if iss.status != "posted":
        raise PostError("Phiếu chưa ghi sổ")
    pairs = _delete_ref_moves(db, "issue", iss.id)
    db.flush()
    validate_pairs(db, pairs)
    iss.status = "draft"
    iss.posted_at = None
    db.commit()


def post_production(db: Session, prod: InvProduction, override_reason: str | None = None) -> None:
    """Ghi so lenh san xuat: xuat tieu hao truoc -> gia thanh -> nhap thanh pham.

    Gia nhap TP = tong gia tri tieu hao / tong SL dau ra (phan bo dong cuoi nhan
    phan du lam tron de tong khop tuyet doi).

    override_reason: neu co -> CHAP NHAN am kho NVL tieu hao (user thua nhan sai,
    se nhap bu). Chi bo qua chan o buoc xuat NVL; buoc nhap TP van validate binh
    thuong (TP nhap vao khong am). Danh dau prod.am_kho_override + luu ly do note.
    """
    if prod.status != "draft":
        raise PostError(f"Lệnh đang ở trạng thái '{prod.status}'")
    _check_ngay(prod.ngay)
    consumes = [ln for ln in prod.lines if ln.chieu == "vao"]
    outputs = [ln for ln in prod.lines if ln.chieu == "ra"]
    if not consumes or not outputs:
        raise PostError("Lệnh sản xuất cần ít nhất 1 dòng tiêu hao và 1 dòng thành phẩm")
    out_ids = {ln.item_id for ln in outputs}
    if out_ids & {ln.item_id for ln in consumes}:
        raise PostError("Một mặt hàng không thể vừa là nguyên liệu vừa là thành phẩm")
    for ln in prod.lines:
        if ln.so_luong <= 0:
            raise PostError(f"Dòng mặt hàng #{ln.item_id}: số lượng phải > 0")

    # 1) Xuat tieu hao (sx_out) — replay tinh gia von, co the bao am kho
    pairs: set[tuple[int, int]] = set()
    out_moves: list[tuple[InvProductionLine, InvMove]] = []
    for ln in consumes:
        m = InvMove(
            item_id=ln.item_id,
            warehouse_id=ln.warehouse_id,
            ngay=prod.ngay,
            loai="sx_out",
            so_luong=ln.so_luong,
            ref_type="production",
            ref_id=prod.id,
            ref_line_id=ln.id,
        )
        db.add(m)
        out_moves.append((ln, m))
        pairs.add((ln.item_id, ln.warehouse_id))
    db.flush()
    if override_reason:
        try:
            validate_pairs(db, pairs)  # van chay replay de tinh gia von NVL
        except NegativeStockError:
            pass
        prod.am_kho_override = True
        prod.note = (f"[ÂM KHO ĐÃ DUYỆT] {override_reason} · " + (prod.note or ""))[:500]
    else:
        validate_pairs(db, pairs)

    # 1b) Gia tam tinh: NVL nao chua co gia von (gia_tri==0) ma co don_gia_tam
    # -> gan gia tri tam len dong xuat (giu can bang gia tri xuat/nhap TP; se
    # tu dieu chinh khi NVL co gia von that o lan replay sau).
    for ln, m in out_moves:
        if (not m.gia_tri) and (ln.don_gia_tam or 0) > 0:
            m.gia_tri = round(ln.so_luong * ln.don_gia_tam)
            m.don_gia = ln.don_gia_tam

    # 2) Gia thanh = tong gia tri NVL tieu hao + nhan cong (622) + SX chung (627)
    nvl_cost = sum(m.gia_tri for _, m in out_moves)
    total_cost = nvl_cost + (prod.cp_nhan_cong or 0.0) + (prod.cp_sxc or 0.0)
    total_out_qty = sum(ln.so_luong for ln in outputs)
    don_gia_tp = total_cost / total_out_qty if total_out_qty else 0.0

    in_pairs: set[tuple[int, int]] = set()
    allocated = 0.0
    for i, ln in enumerate(outputs):
        if i < len(outputs) - 1:
            gia_tri = round(ln.so_luong * don_gia_tp)
            allocated += gia_tri
        else:
            gia_tri = round(total_cost - allocated)  # dong cuoi nhan phan du
        db.add(InvMove(
            item_id=ln.item_id,
            warehouse_id=ln.warehouse_id,
            ngay=prod.ngay,
            loai="sx_in",
            so_luong=ln.so_luong,
            don_gia=don_gia_tp,
            gia_tri=gia_tri,
            ref_type="production",
            ref_id=prod.id,
            ref_line_id=ln.id,
        ))
        in_pairs.add((ln.item_id, ln.warehouse_id))
    db.flush()
    # Chi validate cap thanh pham (in_pairs): cap NVL (pairs) da validate o buoc 1;
    # replay lai chung se ghi de gia_tri tam tinh vua gan (thanh pham luon khac NVL).
    validate_pairs(db, in_pairs)
    prod.tong_gia_thanh = total_cost
    if not prod.so_ct:
        prod.so_ct = f"LSX-{(prod.ngay or '')[:4] or '----'}-{prod.id:04d}"
    prod.status = "posted"
    prod.posted_at = _utcnow()
    db.commit()


def unpost_production(db: Session, prod: InvProduction) -> None:
    if prod.status != "posted":
        raise PostError("Lệnh chưa ghi sổ")
    pairs = _delete_ref_moves(db, "production", prod.id)
    db.flush()
    validate_pairs(db, pairs)
    prod.status = "draft"
    prod.posted_at = None
    db.commit()


# ---------------------------------------------------------------------------
# To khai nhap khau (customs): nhap kho theo gia von = tri gia tinh thue + thue
# NK + chi phi phat sinh (le phi HQ/TTDB/ngan hang...) phan bo theo ti trong.
# ---------------------------------------------------------------------------
def post_customs(db: Session, decl: InvCustomsDecl) -> None:
    """Ghi so to khai nhap khau: moi dong -> 1 move 'nhap'.

    gia_von dong = tri_gia_tinh_thue (VND, da gom phi ship khai tren to khai)
    + tien_thue_nk + PHAN BO chi phi tu InvCustomsCost theo ti trong tri_gia_tinh_thue
    cua tung dong (dong cuoi nhan phan du lam tron — pattern giong post_production).
    """
    if decl.status != "draft":
        raise PostError(f"Tờ khai đang ở trạng thái '{decl.status}', chỉ ghi sổ được bản nháp")
    _check_ngay(decl.ngay_dang_ky)
    if not decl.lines:
        raise PostError("Tờ khai chưa có dòng hàng nào")
    for ln in decl.lines:
        if not ln.item_id or not ln.warehouse_id:
            raise PostError(
                f"Dòng {ln.stt} ({ln.mo_ta[:40]}): chưa chọn mặt hàng/kho — phải khớp hết mới ghi sổ được"
            )
        if ln.so_luong <= 0:
            raise PostError(f"Dòng {ln.stt} ({ln.mo_ta[:40]}): số lượng phải > 0")

    tong_costs = sum(c.so_tien for c in decl.costs)
    tong_thue_co_so = sum(ln.tri_gia_tinh_thue for ln in decl.lines)
    lines_sorted = sorted(decl.lines, key=lambda x: (x.stt, x.id))

    pairs: set[tuple[int, int]] = set()
    allocated = 0.0
    for i, ln in enumerate(lines_sorted):
        if i < len(lines_sorted) - 1:
            phan_bo = round(tong_costs * (ln.tri_gia_tinh_thue / tong_thue_co_so)) if tong_thue_co_so > EPS else 0.0
            allocated += phan_bo
        else:
            phan_bo = round(tong_costs - allocated)  # dong cuoi nhan phan du lam tron
        gia_von = round(ln.tri_gia_tinh_thue + ln.tien_thue_nk + phan_bo)
        ln.gia_von = gia_von
        db.add(InvMove(
            item_id=ln.item_id,
            warehouse_id=ln.warehouse_id,
            ngay=decl.ngay_dang_ky,
            loai="nhap",
            so_luong=ln.so_luong,
            don_gia=gia_von / ln.so_luong if ln.so_luong else 0.0,
            gia_tri=gia_von,
            ref_type="customs",
            ref_id=decl.id,
            ref_line_id=ln.id,
        ))
        pairs.add((ln.item_id, ln.warehouse_id))
    db.flush()
    validate_pairs(db, pairs)
    decl.status = "posted"
    decl.posted_at = _utcnow()
    db.commit()


def unpost_customs(db: Session, decl: InvCustomsDecl) -> None:
    """Huy ghi so (ve nhap): xoa moves; chan neu lam am kho phieu xuat sau do."""
    if decl.status != "posted":
        raise PostError("Tờ khai chưa ghi sổ")
    pairs = _delete_ref_moves(db, "customs", decl.id)
    db.flush()
    validate_pairs(db, pairs)
    decl.status = "draft"
    decl.posted_at = None
    db.commit()


# ---------------------------------------------------------------------------
# GD2: Sinh phieu xuat + lenh san xuat NHAP (draft) tu hoa don BAN RA
# ---------------------------------------------------------------------------
def _fmt_qty(x: float) -> str:
    return f"{round(x, 4):g}"


def generate_from_sale(db: Session, sale) -> dict:
    """Sinh phieu xuat kho + lenh san xuat (DRAFT) tu 1 HD ban da duyet.

    An toan: KHONG post (khong tao move). User duyet & post tay o tab Xuat kho /
    San xuat — luc do post_issue/post_production se CHAN AM KHO. O day chi de xuat.

    - Dong co ton du tai ngay HD -> gom vao 1 phieu xuat.
    - Dong iNut/thanh pham thieu ton + co cong thuc (InvRecipe) -> tao lenh SX
      (scale theo thieu hut), gan truy vet (sale_id/sale_line_id), roi xuat luon.
    - Kiem thoi gian: NVL phai kha dung tai ngay HD, khong thi CANH BAO do.
    - Thieu cong thuc -> canh bao (tao cong thuc o tab San xuat truoc).
    - Dong DA duoc sinh chung tu tu lan goi truoc (con phieu xuat lien ket sale_id,
      du draft hay posted) -> KHONG sinh lai phan da co, tranh xuat trung 2 lan.
    """
    if sale.is_dieu_chinh:
        raise PostError("Hóa đơn điều chỉnh — không sinh chứng từ kho")
    if not sale.ngay:
        raise PostError("Hóa đơn chưa có ngày — không thể sinh chứng từ (rủi ro thuế)")

    avail = {
        (r.item_id, r.warehouse_id): (r.kha_dung or 0.0)
        for r in availability(db, sale.ngay)
    }
    # SL da xuat cho HD nay o cac phieu xuat truoc (draft hoac posted deu tinh, vi
    # draft cung the hien y dinh da xu ly roi) -> tru bot khoi nhu cau dong nay.
    already_pool: dict[tuple[int, int], float] = {}
    for iss in db.scalars(select(InvIssue).where(InvIssue.sale_id == sale.id)):
        for il in iss.lines:
            k = (il.item_id, il.warehouse_id)
            already_pool[k] = already_pool.get(k, 0.0) + il.so_luong

    created_issues: list[int] = []
    created_prods: list[int] = []
    warnings: list[str] = []
    issue_lines = []  # (item_id, warehouse_id, so_luong, don_gia_ban)

    for ln in sale.lines:
        if ln.fulfil_kind == "doanh_thu" or not ln.item_id or ln.so_luong <= 0:
            continue
        if not ln.warehouse_id:
            warnings.append(f"Dòng '{ln.ten_raw[:40]}': chưa chọn kho — bỏ qua")
            continue
        key = (ln.item_id, ln.warehouse_id)
        already = min(already_pool.get(key, 0.0), ln.so_luong)
        already_pool[key] = already_pool.get(key, 0.0) - already
        need = round(ln.so_luong - already, 6)
        if need <= EPS:
            continue  # da xuat du roi (phieu truoc) -> khong sinh lai

        # LSX rieng cho DUNG dong nay da co san nhung CON NHAP (vd qua Ghep bo thu
        # cong, chua kip ghi so nen chua cong vao ton) -> cong vao kha dung "hieu
        # qua" de KHONG sinh THEM 1 LSX trung (LSX da posted thi da nam trong avail
        # roi qua move that, khong can cong lai o day — chi bu cho phan CON NHAP).
        prior_draft_prod = sum(
            pl.so_luong
            for prod in db.scalars(
                select(InvProduction).where(
                    InvProduction.sale_line_id == ln.id, InvProduction.status == "draft"
                )
            )
            for pl in prod.lines
            if pl.chieu == "ra" and pl.item_id == ln.item_id and pl.warehouse_id == ln.warehouse_id
        )
        kd = avail.get(key, 0.0) + prior_draft_prod
        if kd >= need - EPS:
            issue_lines.append((ln.item_id, ln.warehouse_id, need, ln.don_gia_ban))
            continue

        # Thieu ton -> can san xuat
        shortfall = round(need - max(0.0, kd), 4)
        recipe = db.scalars(
            select(InvRecipe)
            .where(InvRecipe.output_item_id == ln.item_id)
            .order_by(InvRecipe.id.desc())
        ).first()
        if recipe is None:
            # Hang hoa thuong (khong san xuat duoc) ma thieu ton: VAN dua ca 'need' vao
            # phieu xuat LIEN KET sale de trang Ban ra thay day; khi ghi so se thieu
            # -> hien modal duyet am kho (nhap ly do). Khong bo qua nua.
            issue_lines.append((ln.item_id, ln.warehouse_id, need, ln.don_gia_ban))
            warnings.append(
                f"Dòng '{ln.ten_raw[:40]}': thiếu {_fmt_qty(shortfall)} — đã đưa vào phiếu xuất, "
                f"chưa có công thức sản xuất; khi ghi sổ sẽ hỏi lý do duyệt âm kho "
                f"(hoặc tạo công thức/nhập bù trước ngày HĐ)"
            )
            continue

        scale = shortfall / (recipe.output_qty or 1.0)
        prod = InvProduction(
            ngay=sale.ngay, status="draft", sale_id=sale.id, sale_line_id=ln.id,
            note=f"SX cho HĐ bán {sale.ky_hieu} {sale.so_hd} · {ln.ten_raw[:50]}",
        )
        db.add(prod)
        db.add(InvProductionLine(
            production=prod, chieu="ra", item_id=ln.item_id,
            warehouse_id=ln.warehouse_id, so_luong=shortfall,
        ))
        for rl in recipe.lines:
            nvl_need = round(rl.so_luong * scale, 4)
            db.add(InvProductionLine(
                production=prod, chieu="vao", item_id=rl.item_id,
                warehouse_id=rl.warehouse_id, so_luong=nvl_need,
            ))
            nvl_kd = avail.get((rl.item_id, rl.warehouse_id), 0.0)
            if nvl_kd < nvl_need - EPS:
                it = db.get(InvItem, rl.item_id)
                warnings.append(
                    f"⚠️ NVL '{(it.ten[:40] if it else rl.item_id)}' thiếu tại ngày HĐ "
                    f"(cần {_fmt_qty(nvl_need)}, khả dụng {_fmt_qty(nvl_kd)}) — phải NHẬP trước "
                    f"ngày {sale.ngay} hoặc thay hàng tương tự (ghi lý do) trước khi ghi sổ"
                )
        db.flush()
        created_prods.append(prod.id)
        # SX xong co thanh pham -> xuat luon (draft) — chi phan CON THIEU (need),
        # khong phai ln.so_luong (tranh xuat lai phan da xuat o phieu truoc).
        issue_lines.append((ln.item_id, ln.warehouse_id, need, ln.don_gia_ban))

    if issue_lines:
        iss = InvIssue(
            ngay=sale.ngay, customer_id=sale.customer_id, status="draft",
            sale_id=sale.id,
            note=f"Xuất bán theo HĐ {sale.ky_hieu} {sale.so_hd}",
        )
        db.add(iss)
        for item_id, wh_id, sl, dg in issue_lines:
            db.add(InvIssueLine(
                issue=iss, item_id=item_id, warehouse_id=wh_id,
                so_luong=sl, don_gia_ban=dg,
            ))
        db.flush()
        created_issues.append(iss.id)

    db.commit()
    return {
        "issues": created_issues,
        "productions": created_prods,
        "warnings": warnings,
    }
