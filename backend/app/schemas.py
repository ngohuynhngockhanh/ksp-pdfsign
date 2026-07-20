"""Cac model du lieu vao/ra cho API."""
from __future__ import annotations

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class Rect(BaseModel):
    """Vung dat chu ky, toa do theo DIEM PDF (goc duoi-trai)."""
    page: int = Field(ge=0)
    x1: float
    y1: float
    x2: float
    y2: float

    def as_box(self) -> tuple[float, float, float, float]:
        # pyHanko box = (x1, y1, x2, y2) voi (x1,y1) goc duoi-trai.
        lx, rx = sorted((self.x1, self.x2))
        by, ty = sorted((self.y1, self.y2))
        return (lx, by, rx, ty)


class AgentTarget(BaseModel):
    """Thong tin ket noi toi may Windows cam token."""
    ip: str
    admin_password: str
    pin: str


class CertInfo(BaseModel):
    id: str
    subject: str
    issuer: str
    serial: str
    valid_from: str
    valid_to: str


class SignRequest(BaseModel):
    doc_id: str
    rect: Rect
    cert_id: str
    agent: AgentTarget
    reason: str = ""
    location: str = ""
    signer_name: str = ""
    filename: str = ""
    customer_id: int | None = None  # gan luon khi ky (tuy chon)
    doc_type: str = ""  # phan loai (bbbg khi ky BBBG vua sinh)
    order_id: int | None = None  # gan vao don hang (tuy chon)


class SignResponse(BaseModel):
    doc_id: str
    signed: bool
    download_url: str
    document_id: int | None = None  # pk trong bang Document (de mo lai o tab Ho so)


class SignatureReport(BaseModel):
    field_name: str
    signer_name: str
    signing_time: str | None = None
    intact: bool           # byte-range con nguyen ven
    valid: bool            # hop le mat ma
    trusted: bool          # chuoi CA tin cay
    revocation_ok: bool | None = None
    has_timestamp: bool = False
    ltv: str | None = None
    coverage: str          # toan bo tai lieu / co sua sau khi ky
    summary: str           # ket luan ngan gon
    problems: list[str] = Field(default_factory=list)


class VerifyResponse(BaseModel):
    doc_id: str
    signature_count: int
    signatures: list[SignatureReport]


# --- Khach hang / Tai khoan / Ho so ---
class CustomerCreate(BaseModel):
    name: str
    tax_code: str = ""
    contact: str = ""
    note: str = ""
    # Tao luon tai khoan cho khach hang (tuy chon)
    account_username: str | None = None
    account_password: str | None = None


class CustomerUpdate(BaseModel):
    name: str | None = None
    tax_code: str | None = None
    contact: str | None = None
    note: str | None = None


class CustomerMerge(BaseModel):
    """Gop cong ty NGUON vao cong ty DICH: dich giu lai, nguon bien mat."""
    source_id: int
    target_id: int


class AccountCreate(BaseModel):
    username: str
    password: str


class CustomerOut(BaseModel):
    id: int
    name: str
    tax_code: str
    contact: str
    address: str = ""
    email: str = ""
    note: str
    created_at: str
    document_count: int = 0
    account_usernames: list[str] = Field(default_factory=list)
    aliases: list[str] = Field(default_factory=list)


class DocumentOut(BaseModel):
    id: int
    doc_id: str
    filename: str
    signer_name: str
    signed: bool
    note: str
    customer_id: int | None
    customer_name: str | None = None
    created_at: str
    download_url: str
    nas_synced: bool = False
    doc_type: str = ""
    signed_upload_name: str = ""  # rong = chua co ban da ky tai len
    order_id: int | None = None
    order_code: str = ""  # vd "DH-0001 · Ten don hang"


class DocumentRename(BaseModel):
    filename: str


class AssignRequest(BaseModel):
    customer_id: int | None  # None = bo gan (chua phan loai)


class DocumentsPage(BaseModel):
    items: list[DocumentOut]
    total: int
    page: int
    per_page: int


class PasswordChange(BaseModel):
    old_password: str
    new_password: str


class PasswordReset(BaseModel):
    new_password: str


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    customer_id: int | None
    customer_name: str | None = None


class ShareRequest(BaseModel):
    days: int = 7
    include_account: bool = False


class AccountInfo(BaseModel):
    username: str
    password: str


class ShareResponse(BaseModel):
    token: str
    url: str
    filename: str
    expires_at: str
    account: AccountInfo | None = None


class BulkAssign(BaseModel):
    ids: list[int]
    customer_id: int | None


class BulkIds(BaseModel):
    ids: list[int]


# --- BBBG (sinh tu hoa don) ---
class BBBGDate(BaseModel):
    day: int
    month: int
    year: int


class BBBGItem(BaseModel):
    ten: str = ""
    dvt: str = ""
    so_luong: str = ""


class BBBGBenB(BaseModel):
    name: str = ""
    address: str = ""
    mst: str = ""
    email: str = ""
    dai_dien: str = ""
    chuc_vu: str = ""
    nguoi_nhan: str = ""
    dien_thoai: str = ""
    ten_ngan: str = ""  # ten goi tat trong BBNT (vd "PHE VIET NAM")


class BBBGGenerate(BaseModel):
    so_bb: str = ""
    noi_lap: str = "Đắk Lắk"
    ngay: BBBGDate
    ben_b: BBBGBenB
    items: list[BBBGItem] = Field(default_factory=list)
    template_key: str = "bbbg_thiet_bi"
    ben_a: dict | None = None
    filename: str = "bien-ban-ban-giao.pdf"


# --- Bao gia / De nghi thanh toan ---
class QuoteItem(BaseModel):
    ten: str = ""
    dvt: str = ""
    so_luong: float = 0
    don_gia: float = 0
    thue_suat: float = 0  # % (0/5/8/10)


class QuoteGenerate(BaseModel):
    template_key: str = "bao_gia"  # bao_gia | de_nghi_tt
    so: str = ""
    ngay: BBBGDate
    noi_lap: str = ""  # rong = mac dinh theo template (Dak Lak / TP.HCM)
    ben_b: BBBGBenB
    items: list[QuoteItem] = Field(default_factory=list)
    thuyet_minh: str = ""
    hieu_luc: int = 30  # so ngay hieu luc bao gia
    filename: str = "bao-gia.pdf"
    # De nghi thanh toan
    loai_tt: str = "toan_bo"  # toan_bo | co_coc | nhieu_phan
    tien_coc: float = 0
    da_thanh_toan: float = 0  # coc + cac dot truoc (nhieu_phan)
    so_tien_dot_nay: float = 0
    dot_thu: int = 0
    tong_so_dot: int = 0
    han_thanh_toan: str = "05 ngày"
    can_cu: str = ""  # vd "theo hợp đồng số 01/2026/HĐKT"
    # Bien ban nghiem thu (template bbnt)
    bbnt_ghi_chu: str = "Bảo hành 1 năm 1 đổi 1 kể từ ngày nghiệm thu*"
    bbnt_dieu_khoan: str = ""  # rong = dung dieu kien bao hanh mac dinh


class OrderCreate(BaseModel):
    name: str
    customer_id: int | None = None
    note: str = ""


class OrderOut(BaseModel):
    id: int
    code: str
    name: str
    customer_id: int | None
    customer_name: str | None = None
    note: str
    created_at: str
    document_count: int = 0


class OrderAssign(BaseModel):
    order_id: int | None  # None = bo khoi don hang


class ProductOut(BaseModel):
    id: int
    ten: str
    dvt: str
    don_gia: float
    thue_suat: float
    use_count: int


class QuoteNarrativeRequest(BaseModel):
    items: list[QuoteItem] = Field(default_factory=list)
    khach: str = ""
    tong: float = 0
    note: str = ""
    loai: str = "bao_gia"  # bao_gia | de_nghi_tt


class DocTypeUpdate(BaseModel):
    doc_type: str


class AuditOut(BaseModel):
    id: int
    ts: str
    username: str
    role: str
    ip: str
    action: str
    action_label: str
    target: str
    detail: str


class AuditPage(BaseModel):
    items: list[AuditOut]
    total: int
    page: int
    per_page: int


# --- Ton kho ---
class InvWarehouseOut(BaseModel):
    id: int
    code: str
    name: str


class InvItemCreate(BaseModel):
    ma_hang: str
    ten: str
    dvt: str = ""
    note: str = ""


class InvItemUpdate(BaseModel):
    ten: str | None = None
    dvt: str | None = None
    note: str | None = None
    active: bool | None = None
    product_id: int | None = None


class InvItemOut(BaseModel):
    id: int
    ma_hang: str
    ten: str
    dvt: str
    note: str = ""
    active: bool = True
    product_id: int | None = None


class StockRowOut(BaseModel):
    item_id: int
    ma_hang: str
    ten: str
    dvt: str
    warehouse_id: int
    warehouse_code: str
    ton: float
    don_gia_bq: float
    gia_tri: float
    kha_dung: float | None = None
    nhap_cuoi: str = ""


class StockReport(BaseModel):
    rows: list[StockRowOut]
    tong_gia_tri: float
    ngay: str | None = None


class StockCardRow(BaseModel):
    id: int
    ngay: str
    loai: str
    loai_label: str
    nhap: float
    xuat: float
    don_gia: float
    gia_tri: float
    ton: float
    ton_gia_tri: float
    ref_type: str = ""
    ref_id: int | None = None


class OpeningImportResult(BaseModel):
    dry_run: bool
    tong: dict
    warnings: list[dict]
    preview: list[dict] = Field(default_factory=list)  # cac dong se import
    applied: dict | None = None  # ket qua khi commit


class InvPurchaseLineIn(BaseModel):
    stt: int = 0
    ten_raw: str = ""
    dvt: str = ""
    so_luong: float = 0
    don_gia: float = 0
    thanh_tien: float = 0
    thue_suat: float = 0
    item_id: int | None = None
    warehouse_id: int | None = None
    match_kind: str = "none"


class InvImportUrlIn(BaseModel):
    url: str


class InvPurchaseUpdate(BaseModel):
    so_hd: str | None = None
    ky_hieu: str | None = None
    mst_ban: str | None = None
    ten_ban: str | None = None
    ngay: str | None = None
    loai: str | None = None  # hang_hoa | dich_vu
    lines: list[InvPurchaseLineIn] | None = None


class InvPurchaseLineOut(BaseModel):
    id: int
    stt: int
    ten_raw: str
    dvt: str
    so_luong: float
    don_gia: float
    thanh_tien: float
    thue_suat: float
    item_id: int | None
    item_ma_hang: str = ""
    item_ten: str = ""
    warehouse_id: int | None
    match_kind: str
    confidence: float
    warnings: list = Field(default_factory=list)
    suggestions: list[dict] = Field(default_factory=list)


class InvPurchaseOut(BaseModel):
    id: int
    so_hd: str
    ky_hieu: str
    mst_ban: str
    ten_ban: str
    ngay: str
    tong_truoc_thue: float
    tong_thue: float
    tong_tien: float
    source: str
    status: str
    loai: str = "hang_hoa"
    confidence: float
    warnings: list = Field(default_factory=list)
    dup_of: int | None = None
    created_at: str = ""
    doc_url: str = ""
    lines: list[InvPurchaseLineOut] = Field(default_factory=list)


# --- Hoa don BAN RA (iNut = ben ban) ---
class InvSaleLineIn(BaseModel):
    stt: int = 0
    ten_raw: str = ""
    dvt: str = ""
    so_luong: float = 0
    don_gia_ban: float = 0
    thanh_tien: float = 0
    thue_suat: float = 0
    thue_kct: bool = False
    item_id: int | None = None
    warehouse_id: int | None = None
    match_kind: str = "none"
    line_class: str = "other"
    fulfil_kind: str = "none"


class InvSaleUpdate(BaseModel):
    so_hd: str | None = None
    ky_hieu: str | None = None
    mst_mua: str | None = None
    ten_mua: str | None = None
    customer_id: int | None = None
    ngay: str | None = None
    status: str | None = None  # draft | reviewed
    lines: list[InvSaleLineIn] | None = None


class InvSaleLineOut(BaseModel):
    id: int
    stt: int
    ten_raw: str
    dvt: str
    so_luong: float
    don_gia_ban: float
    thanh_tien: float
    thue_suat: float
    thue_kct: bool = False
    item_id: int | None
    item_ma_hang: str = ""
    item_ten: str = ""
    warehouse_id: int | None
    match_kind: str
    line_class: str = "other"
    fulfil_kind: str = "none"
    confidence: float
    warnings: list = Field(default_factory=list)
    suggestions: list[dict] = Field(default_factory=list)
    # doi chieu ton kho tai ngay HD
    ton_hien_co: float = 0
    kha_dung_tai_ngay: float = 0
    de_xuat: str = ""
    warn_am_kho: bool = False
    lech_dong: bool = False  # SL x don gia_ban lech thanh_tien (loi parse PDF/XML)


class InvSaleOut(BaseModel):
    id: int
    so_hd: str
    ky_hieu: str
    mst_mua: str
    ten_mua: str
    customer_id: int | None = None
    ngay: str
    tong_truoc_thue: float
    tong_thue: float
    tong_tien: float
    source: str
    status: str
    is_dieu_chinh: bool = False
    dc_ref: str = ""
    confidence: float
    warnings: list = Field(default_factory=list)
    dup_of: int | None = None
    created_at: str = ""
    doc_url: str = ""
    lines: list[InvSaleLineOut] = Field(default_factory=list)
    # trang thai XUAT KHO (tong hop tu InvIssue/InvProduction lien ket sale_id)
    fulfil_status: str = "na"  # du | mot_phan | chua | na
    fulfil_note: list[str] = Field(default_factory=list)
    # Loi nhuan tu phieu xuat lien ket (None = chua co phieu xuat nao)
    ln_truoc_nc: float | None = None  # doanh thu truoc thue - gia von
    nhan_cong_uoc: float = 0  # 300k x SL thanh pham SX (kho TP)
    ln_sau_nc: float | None = None
    ln_uoc: bool = False  # True = con uoc tinh (phieu nhap/chua xuat het)


# --- Ghep bo (assembly / BOM) tu 1 dong ban ---
class BomExistingIn(BaseModel):
    ten: str
    so_luong: float = 0
    dvt: str = ""


class SuggestBomIn(BaseModel):
    context: str = ""  # ngu canh/huong dan them cua user cho AI (tung keo)
    existing: list[BomExistingIn] = Field(default_factory=list)  # nut "AI goi y THEM"


class BomComponentIn(BaseModel):
    item_id: int
    warehouse_id: int
    so_luong: float
    note: str = ""


class AssembleIn(BaseModel):
    output_item_id: int | None = None  # neu bo da la 1 mat hang; None -> tao moi
    output_ma_hang: str = ""  # ma cho thanh pham bo moi (khi tao moi)
    output_warehouse_id: int
    components: list[BomComponentIn] = Field(default_factory=list)
    save_recipe: bool = False
    recipe_name: str = ""


class InvIssueLineIn(BaseModel):
    item_id: int
    warehouse_id: int
    so_luong: float
    don_gia_ban: float = 0


class InvIssueIn(BaseModel):
    ngay: str
    customer_id: int | None = None
    note: str = ""
    muc_dich: str = "ban"  # ban | san_xuat | noi_bo | dieu_chuyen | huy
    ly_do: str = ""
    nguoi_nhan: str = ""
    bo_phan: str = ""
    tk_no: str = ""  # de trong -> backend tu suy tu muc_dich
    tk_co: str = ""
    lines: list[InvIssueLineIn] = Field(default_factory=list)


class InvIssueLineOut(BaseModel):
    id: int
    item_id: int
    ma_hang: str = ""
    ten: str = ""
    dvt: str = ""
    warehouse_id: int
    warehouse_code: str = ""
    so_luong: float
    don_gia_ban: float = 0
    thanh_tien_ban: float = 0
    gia_von: float = 0  # tu so kho sau khi post (dong bang tren dong)
    gia_von_uoc: float = 0  # uoc tinh theo gia von BQ hien tai (dung cho draft)
    don_gia_von_uoc: float = 0  # gia von BQ / don vi


class InvIssueOut(BaseModel):
    id: int
    so_ct: str = ""
    ngay: str
    customer_id: int | None
    customer_name: str = ""
    muc_dich: str = "ban"
    ly_do: str = ""
    nguoi_nhan: str = ""
    bo_phan: str = ""
    tk_no: str = ""
    tk_co: str = ""
    tong_gia_von: float = 0
    tong_gia_von_uoc: float = 0  # uoc tinh (draft chua ghi so)
    note: str
    status: str
    created_at: str = ""
    lines: list[InvIssueLineOut] = Field(default_factory=list)


class InvProductionLineIn(BaseModel):
    chieu: str  # vao | ra
    item_id: int
    warehouse_id: int
    so_luong: float
    don_gia_tam: float = 0  # gia tam tinh cho NVL chua co gia von (dong 'vao')


class InvProductionIn(BaseModel):
    ngay: str
    note: str = ""
    description: str = ""
    recipe_id: int | None = None
    cp_nhan_cong: float = 0
    cp_sxc: float = 0
    gia_ban_du_kien: float = 0
    lines: list[InvProductionLineIn] = Field(default_factory=list)


class InvProductionLineOut(BaseModel):
    id: int
    chieu: str
    item_id: int
    ma_hang: str = ""
    ten: str = ""
    dvt: str = ""
    warehouse_id: int
    so_luong: float
    don_gia_tam: float = 0
    gia_tri: float = 0  # sau khi post: gia von tieu hao / gia thanh nhap
    gia_tri_uoc: float = 0  # uoc tinh theo gia von BQ hien tai (dung cho draft)
    # so dinh muc (tu recipe_id) de so sanh - chi co khi lenh gan cong thuc
    so_luong_dinh_muc: float | None = None
    gia_tri_dinh_muc: float | None = None


class InvProductionOut(BaseModel):
    id: int
    so_ct: str = ""
    ngay: str
    note: str
    description: str = ""
    status: str
    recipe_id: int | None = None
    cp_nhan_cong: float = 0
    cp_sxc: float = 0
    tong_gia_thanh: float = 0
    tong_gia_thanh_uoc: float = 0  # uoc tinh (draft chua ghi so)
    gia_thanh_dv_uoc: float = 0  # uoc tinh / don vi thanh pham
    gia_ban_du_kien: float = 0
    sale_id: int | None = None  # truy vet: LSX sinh tu HD ban nao (neu co)
    created_at: str = ""
    lines: list[InvProductionLineOut] = Field(default_factory=list)


class InvRecipeLineIn(BaseModel):
    item_id: int
    warehouse_id: int
    so_luong: float


class InvRecipeIn(BaseModel):
    name: str
    output_item_id: int
    output_qty: float = 1
    description: str = ""
    lines: list[InvRecipeLineIn] = Field(default_factory=list)


class InvRecipeOut(BaseModel):
    id: int
    name: str
    output_item_id: int
    output_ten: str = ""
    output_qty: float
    description: str = ""
    tong_gia_tri: float = 0  # gia thanh uoc tinh (theo gia von BQ hien tai)
    gia_thanh_dv: float = 0  # /don vi thanh pham
    thieu_gia: bool = False  # co NVL chua co gia von -> uoc tinh thieu
    lines: list[dict] = Field(default_factory=list)


# --- To khai nhap khau (customs) ---
class InvCustomsLineIn(BaseModel):
    id: int
    item_id: int | None = None
    warehouse_id: int | None = None
    so_luong: float | None = None


class InvCustomsCostIn(BaseModel):
    loai: str = ""
    ten: str = ""
    so_tien: float = 0
    ghi_chu: str = ""


class InvCustomsUpdate(BaseModel):
    note: str | None = None
    lines: list[InvCustomsLineIn] | None = None
    costs: list[InvCustomsCostIn] | None = None


class InvCustomsLineOut(BaseModel):
    id: int
    stt: int
    ma_hs: str = ""
    mo_ta: str = ""
    so_luong: float = 0
    dvt: str = ""
    don_gia_nt: float = 0
    tri_gia_nt: float = 0
    tri_gia_tinh_thue: float = 0
    thue_suat_nk: float = 0
    tien_thue_nk: float = 0
    thue_suat_vat: float = 0
    tien_thue_vat: float = 0
    item_id: int | None = None
    item_ma_hang: str = ""
    item_ten: str = ""
    warehouse_id: int | None = None
    warehouse_code: str = ""
    match_kind: str = "none"
    gia_von: float = 0
    suggestions: list[dict] = Field(default_factory=list)


class InvCustomsCostOut(BaseModel):
    id: int
    loai: str = ""
    ten: str = ""
    so_tien: float = 0
    ghi_chu: str = ""
    doc_url: str = ""


class InvCustomsDeclOut(BaseModel):
    id: int
    so_to_khai: str
    ngay_dang_ky: str = ""
    ma_loai_hinh: str = ""
    phan_luong: str = ""
    co_quan_hq: str = ""
    nguoi_xk: str = ""
    nuoc_xk: str = ""
    so_van_don: str = ""
    so_hoa_don: str = ""
    ngay_hoa_don: str = ""
    phuong_thuc_tt: str = ""
    incoterm: str = ""
    nguyen_te: str = ""
    tri_gia_nt: float = 0
    phi_ship_nt: float = 0
    ti_gia: float = 0
    tri_gia_tinh_thue: float = 0
    tong_thue_nk: float = 0
    tong_thue_vat: float = 0
    status: str = "draft"
    note: str = ""
    created_at: str = ""
    doc_url: str = ""
    tong_costs: float = 0
    lines: list[InvCustomsLineOut] = Field(default_factory=list)
    costs: list[InvCustomsCostOut] = Field(default_factory=list)


class DescribeNvlLine(BaseModel):
    ten: str = ""
    so_luong: float = 0
    dvt: str = ""


class DescribeBomIn(BaseModel):
    """Sinh mo ta NVL: AI nhin tron bo NVL + thanh pham -> giai thich."""

    output_ten: str = ""
    output_dvt: str = ""
    output_qty: float = 1
    lines: list[DescribeNvlLine] = Field(default_factory=list)
