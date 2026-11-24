import type React from "react";
import { useEffect, useState } from "react";
import {
  api,
  type PieceworkAttachmentInfo,
  type PieceworkCertificateInfo,
  type PieceworkContractDetail,
  type PieceworkContractItem,
  type PieceworkContractorItem,
  type PieceworkContractorTaxSummary,
  type PieceworkWorkItem,
} from "../api";
import {
  ActionBar,
  AppButton,
  AppIcon,
  DataView,
  EmptyState,
  FilterBar,
  InlineAlert,
  KpiStrip,
  MobileCard,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  PageHeader,
  PageShell,
  ResponsiveTabs,
  StatusBadge,
  TableSkeleton,
  useConfirm,
  useToast,
} from "../components/ui";
import { safeHttpUrl } from "../utils/url";
import { AuditReportModal, SignatureVerifyModal } from "./piecework/AuditVerifyModals";
import { ContractDetailModal } from "./piecework/ContractDetailModal";
import { CreateContractModal, EditContractModal } from "./piecework/ContractFormModals";
import {
  ContractorFormModal,
  SmartPasteModal,
  TaxSummaryModal,
} from "./piecework/ContractorModals";
import {
  contractTypeLabel,
  contractTypeTone,
  createDefaultContractForm,
  createDefaultContractorForm,
  deficiencyStatusTone,
  formatDateTimeWithSeconds,
  formatVnd,
  isAttachmentPdf,
  stripLeadingEmoji,
  type AuditModalState,
  type ContractFormState,
  type ContractorFormState,
  type DriveSyncModalState,
  type PreviewDocState,
  type ShareModalState,
} from "./piecework/helpers";
import {
  DocumentPreviewModal,
  DriveSyncResultModal,
  ShareContractModal,
  SigningModal,
} from "./piecework/SignShareDriveModals";

export function PieceworkContracts() {
  const toast = useToast();
  const askConfirm = useConfirm();

  const [contracts, setContracts] = useState<PieceworkContractItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [selectedDetail, setSelectedDetail] = useState<PieceworkContractDetail | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingContract, setEditingContract] = useState<PieceworkContractDetail | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  // Signing State
  const [signingContract, setSigningContract] = useState<PieceworkContractItem | null>(null);
  const [signMode, setSignMode] = useState<"contract_date" | "realtime">("contract_date");
  const [customSignDate, setCustomSignDate] = useState<string>("");
  const [certificates, setCertificates] = useState<PieceworkCertificateInfo[]>([]);
  const [selectedCertId, setSelectedCertId] = useState<string>("");
  const [certPin, setCertPin] = useState("12345678");
  const [certLoading, setCertLoading] = useState(false);

  // Signature Verification State
  const [verifyingContract, setVerifyingContract] = useState<PieceworkContractItem | null>(null);
  const [verifyResult, setVerifyResult] = useState<
    Awaited<ReturnType<typeof api.verifyPieceworkSignature>> | null
  >(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<string | null>(null);

  // Document Lightbox Preview
  const [previewDoc, setPreviewDoc] = useState<PreviewDocState | null>(null);

  // Audit Modal State
  const [auditModal, setAuditModal] = useState<AuditModalState | null>(null);

  // Share Modal State (Hợp đồng Đã ký vs Chưa ký vs Portal)
  const [shareModal, setShareModal] = useState<ShareModalState | null>(null);
  const [copiedShare, setCopiedShare] = useState(false);

  // Google Drive Sync State
  const [syncingDriveId, setSyncingDriveId] = useState<number | null>(null);
  const [syncingQuarterDrive, setSyncingQuarterDrive] = useState(false);
  const [driveSyncModal, setDriveSyncModal] = useState<DriveSyncModalState | null>(null);

  // Navigation Tabs: 'contracts' vs 'contractors'
  const [activeMainTab, setActiveMainTab] = useState<"contracts" | "contractors">("contracts");

  // Contractors State
  const [contractors, setContractors] = useState<PieceworkContractorItem[]>([]);
  const [contractorSearch, setContractorSearch] = useState("");
  const [contractorLoading, setContractorLoading] = useState(false);
  const [showContractorModal, setShowContractorModal] = useState(false);
  const [editingContractor, setEditingContractor] = useState<PieceworkContractorItem | null>(null);
  const [contractorForm, setContractorForm] = useState<ContractorFormState>(
    createDefaultContractorForm,
  );

  // Tax Summary Modal State
  const [taxSummaryData, setTaxSummaryData] = useState<PieceworkContractorTaxSummary | null>(null);
  const [taxSummaryLoadingId, setTaxSummaryLoadingId] = useState<number | null>(null);

  // Smart Paste State
  const [showSmartPasteModal, setShowSmartPasteModal] = useState(false);
  const [smartPasteText, setSmartPasteText] = useState("");
  const [smartPasteTarget, setSmartPasteTarget] = useState<"contract" | "contractor">("contract");

  // Form state for creating new contract
  const [formData, setFormData] = useState<ContractFormState>(createDefaultContractForm);

  const loadContracts = async (overrides?: { q?: string; status_f?: string; contract_type?: string }) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.listPieceworkContracts({
        q: overrides?.q ?? search,
        status_f: overrides?.status_f ?? statusFilter,
        contract_type: overrides?.contract_type ?? typeFilter,
      });
      setContracts(Array.isArray(res?.contracts) ? res.contracts : []);
    } catch (err) {
      const msg = "Lỗi tải danh sách hợp đồng khoán: " + (err as Error).message;
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const loadContractors = async (qOverride?: string) => {
    setContractorLoading(true);
    try {
      const res = await api.listPieceworkContractors(qOverride ?? contractorSearch);
      setContractors(Array.isArray(res?.contractors) ? res.contractors : []);
    } catch (err) {
      console.error("Lỗi tải danh bạ nhà cung cấp khoán:", err);
    } finally {
      setContractorLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadContracts();
    }, search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [search, statusFilter, typeFilter]);

  useEffect(() => {
    loadContractors();
  }, [contractorSearch]);

  const openNewContractorModal = () => {
    setContractorForm(createDefaultContractorForm());
    setEditingContractor(null);
    setShowContractorModal(true);
  };

  const openEditContractorModal = (c: PieceworkContractorItem) => {
    setContractorForm({
      code: c.code,
      name: c.name,
      id_card: c.id_card,
      id_card_date: c.id_card_date,
      id_card_place: c.id_card_place,
      tax_code: c.tax_code,
      phone: c.phone,
      address: c.address,
      bank_account: c.bank_account,
      bank_name: c.bank_name,
      skills: c.skills,
      notes: c.notes,
    });
    setEditingContractor(c);
    setShowContractorModal(true);
  };

  const handleSaveContractor = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingContractor) {
        await api.updatePieceworkContractor(editingContractor.id, contractorForm);
        toast.success(`Đã cập nhật hồ sơ nhà cung cấp ${contractorForm.name}!`);
      } else {
        await api.createPieceworkContractor(contractorForm);
        toast.success(`Đã lưu nhà cung cấp ${contractorForm.name} vào danh bạ!`);
      }
      setShowContractorModal(false);
      setEditingContractor(null);
      loadContractors();
    } catch (err) {
      toast.error("Lỗi lưu nhà cung cấp: " + (err as Error).message);
    }
  };

  const handleDeleteContractor = async (c: PieceworkContractorItem) => {
    const ok = await askConfirm({
      title: "Xóa nhà cung cấp / thợ khoán",
      message: `Xác nhận xóa nhà cung cấp ${c.name} (${c.code}) khỏi danh bạ?`,
      confirmLabel: "Xóa nhà cung cấp",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.deletePieceworkContractor(c.id);
      toast.success(`Đã xóa nhà cung cấp ${c.name} khỏi danh bạ!`);
      loadContractors();
    } catch (err) {
      toast.error("Lỗi xóa: " + (err as Error).message);
    }
  };

  const handleOpenTaxSummary = async (contractorId: number, year: number = 2026) => {
    setTaxSummaryLoadingId(contractorId);
    setTaxSummaryData(null);
    try {
      const res = await api.getPieceworkContractorTaxSummary(contractorId, year);
      setTaxSummaryData(res);
    } catch (err) {
      toast.error("Lỗi lấy báo cáo quyết toán thuế: " + (err as Error).message);
    } finally {
      setTaxSummaryLoadingId(null);
    }
  };

  const handleSelectContractor = (contractorId: number | "") => {
    if (!contractorId) {
      setFormData((prev) => ({ ...prev, contractor_id: null }));
      return;
    }
    const c = contractors.find((x) => x.id === Number(contractorId));
    if (!c) return;
    setFormData((prev) => ({
      ...prev,
      contractor_id: c.id,
      worker_name: c.name,
      worker_id_card: c.id_card,
      worker_id_card_date: c.id_card_date,
      worker_id_card_place: c.id_card_place,
      worker_tax_code: c.tax_code,
      worker_phone: c.phone,
      worker_address: c.address,
      worker_bank_account: c.bank_account,
      worker_bank_name: c.bank_name,
    }));
    toast.success(`Đã tự động điền thông tin nhà cung cấp ${c.name} (${c.code})!`);
  };

  const handleApplySmartPaste = async () => {
    if (!smartPasteText.trim()) return;
    try {
      const res = await api.parsePieceworkContractorText(smartPasteText);
      const p = res.parsed;
      if (smartPasteTarget === "contract") {
        setFormData((prev) => ({
          ...prev,
          worker_name: p.name || prev.worker_name,
          worker_id_card: p.id_card || prev.worker_id_card,
          worker_id_card_date: p.id_card_date || prev.worker_id_card_date,
          worker_id_card_place: p.id_card_place || prev.worker_id_card_place,
          worker_tax_code: p.tax_code || prev.worker_tax_code,
          worker_phone: p.phone || prev.worker_phone,
          worker_address: p.address || prev.worker_address,
          worker_bank_account: p.bank_account || prev.worker_bank_account,
          worker_bank_name: p.bank_name || prev.worker_bank_name,
        }));
        toast.success("Đã tự động trích xuất và điền thông tin thợ vào Hợp đồng!");
      } else {
        setContractorForm((prev) => ({
          ...prev,
          name: p.name || prev.name,
          id_card: p.id_card || prev.id_card,
          id_card_date: p.id_card_date || prev.id_card_date,
          id_card_place: p.id_card_place || prev.id_card_place,
          tax_code: p.tax_code || prev.tax_code,
          phone: p.phone || prev.phone,
          address: p.address || prev.address,
          bank_account: p.bank_account || prev.bank_account,
          bank_name: p.bank_name || prev.bank_name,
        }));
        toast.success("Đã tự động trích xuất thông tin vào hồ sơ Nhà cung cấp!");
      }
      setShowSmartPasteModal(false);
      setSmartPasteText("");
    } catch (err) {
      toast.error("Lỗi trích xuất: " + (err as Error).message);
    }
  };

  const handleCreateContractForContractor = (c: PieceworkContractorItem) => {
    setFormData({
      contractor_id: c.id,
      contract_code: "",
      contract_type: "thi_cong",
      title: `Hợp đồng giao khoán thi công - ${c.name}`,
      project_name: c.skills || "Công trình iNut",
      location: c.address || "Hiện trường thi công",
      contract_date: new Date().toISOString().slice(0, 10),
      worker_name: c.name,
      worker_id_card: c.id_card,
      worker_id_card_date: c.id_card_date,
      worker_id_card_place: c.id_card_place,
      worker_tax_code: c.tax_code,
      worker_phone: c.phone,
      worker_address: c.address,
      worker_bank_account: c.bank_account,
      worker_bank_name: c.bank_name,
      payment_method: "bank_transfer",
      note: `Giao khoán cho nhà cung cấp/thợ ${c.name} (${c.code}).`,
      items: [
        {
          ten: c.skills || "Thi công lắp đặt thiết bị theo yêu cầu kỹ thuật",
          dvt: "Gói",
          so_luong: 1,
          don_gia: 4500000,
          thanh_tien: 4500000,
        },
      ],
    });
    setShowCreateModal(true);
  };

  const copyToClipboard = (text: string, label: string) => {
    const fullUrl = window.location.origin + text;
    navigator.clipboard.writeText(fullUrl).then(() => {
      toast.success(`Đã sao chép link ${label} gửi Zalo cho thợ!`);
    });
  };

  const openSigningModal = async (c: PieceworkContractItem) => {
    setSigningContract(c);
    setSignMode("contract_date");
    const randMin = String(Math.floor(Math.random() * 38) + 14).padStart(2, "0");
    const randSec = String(Math.floor(Math.random() * 48) + 11).padStart(2, "0");
    if (c.contract_date && /^\d{4}-\d{2}-\d{2}$/.test(c.contract_date)) {
      setCustomSignDate(`${c.contract_date}T09:${randMin}:${randSec}`);
    } else {
      const nowStr = new Date().toISOString().slice(0, 10);
      setCustomSignDate(`${nowStr}T09:${randMin}:${randSec}`);
    }

    setCertLoading(true);
    try {
      const res = await api.listPieceworkCertificates();
      const list = Array.isArray(res?.certificates) ? res.certificates : [];
      setCertificates(list);
      const defCert = list.find((x) => x.is_default) || list.find((x) => !x.expired) || list[0];
      if (defCert) setSelectedCertId(defCert.id);
    } catch (err) {
      console.error("Lỗi lấy danh sách chứng thư:", err);
    } finally {
      setCertLoading(false);
    }
  };

  const handleConfirmSignInut = async () => {
    if (!signingContract) return;
    const cid = signingContract.id;
    setActionLoading(cid);
    try {
      const payload = {
        sign_date: signMode === "contract_date" && customSignDate ? customSignDate : undefined,
        cert_id: selectedCertId || undefined,
        pin: certPin || "12345678",
      };
      const res = await api.signInutPieceworkContract(cid, payload);
      if (res.ok) {
        toast.success("Đã ký số điện tử Bên A (INUT) thành công!");
        setSigningContract(null);
        loadContracts();
        if (selectedDetail && selectedDetail.id === cid) {
          const updated = await api.getPieceworkContract(cid);
          setSelectedDetail(updated);
        }
      }
    } catch (err) {
      toast.error("Lỗi ký số: " + (err as Error).message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleVerifySignature = async (c: PieceworkContractItem) => {
    setVerifyingContract(c);
    setVerifyResult(null);
    setVerifyLoading(true);
    try {
      const res = await api.verifyPieceworkSignature(c.id);
      setVerifyResult(res);
    } catch (err) {
      setVerifyResult({
        ok: false,
        has_signature: false,
        intact: false,
        valid: false,
        message: "Lỗi khi kiểm tra chữ ký: " + (err as Error).message,
      });
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleSyncDrive = async (c: PieceworkContractItem | PieceworkContractDetail) => {
    setSyncingDriveId(c.id);
    try {
      const res = await api.syncPieceworkContractToDrive(c.id);
      if (res.ok) {
        toast.success(`Đã đồng bộ hồ sơ ${c.contract_code} lên Google Drive Kế toán (${res.quarter})!`);
        setDriveSyncModal({
          contract_code: c.contract_code,
          quarter: res.quarter,
          remote_dest: res.remote_dest,
          drive_link: res.drive_link,
          files: res.files,
          synced_at: res.synced_at,
        });
        loadContracts();
        if (selectedDetail && selectedDetail.id === c.id) {
          const updated = await api.getPieceworkContract(c.id);
          setSelectedDetail(updated);
        }
      }
    } catch (err) {
      toast.error(`Lỗi đồng bộ Google Drive: ${(err as Error).message}`);
    } finally {
      setSyncingDriveId(null);
    }
  };

  const handleSyncQuarterlyDrive = async () => {
    setSyncingQuarterDrive(true);
    try {
      const res = await api.syncQuarterlyPieceworkToDrive();
      if (res.ok) {
        toast.success(`Đã đồng bộ ${res.synced_count} hợp đồng khoán lên Drive Kế toán!`);
        loadContracts();
      }
    } catch (err) {
      toast.error(`Lỗi đồng bộ Quý lên Google Drive: ${(err as Error).message}`);
    } finally {
      setSyncingQuarterDrive(false);
    }
  };

  const openPreview = (att: Partial<PieceworkAttachmentInfo>, customTitle?: string) => {
    if (!att || !att.url) return;
    setPreviewDoc({
      url: att.url,
      downloadUrl: att.download_url || att.url,
      title: customTitle || att.label || "Xem tài liệu",
      isPdf: isAttachmentPdf(att),
      validationNote: att.validation?.note,
    });
  };

  const handleUploadDoc = async (contractId: number, docKind: string, file: File | undefined) => {
    if (!file) return;
    setUploadingKind(docKind);
    try {
      const res = await api.uploadPieceworkDoc(contractId, file, docKind);
      if (res.ok) {
        toast.success(`Đã tải lên và kiểm tra ${res.doc_kind} thành công!`);
        loadContracts();
        const updated = await api.getPieceworkContract(contractId);
        setSelectedDetail(updated);
      }
    } catch (err) {
      toast.error("Lỗi tải lên chứng từ: " + (err as Error).message);
    } finally {
      setUploadingKind(null);
    }
  };

  const handleDeleteDoc = async (contractId: number, docKind: string, docId?: string) => {
    const ok = await askConfirm({
      title: "Xóa tệp chứng từ",
      message: "Xác nhận xóa tệp chứng từ này khỏi hợp đồng?",
      confirmLabel: "Xóa tệp",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const res = await api.deletePieceworkDoc(contractId, docKind, docId);
      if (res.ok) {
        toast.success("Đã xóa tệp chứng từ thành công!");
        loadContracts();
        const updated = await api.getPieceworkContract(contractId);
        setSelectedDetail(updated);
      }
    } catch (err) {
      toast.error("Lỗi xóa tệp: " + (err as Error).message);
    }
  };

  const handleDeleteContract = async (c: PieceworkContractItem) => {
    const ok = await askConfirm({
      title: "Xóa hợp đồng giao khoán",
      message: `Bạn có chắc chắn muốn xóa Hợp đồng khoán ${c.contract_code} (${c.worker_name})?`,
      confirmLabel: "Xóa hợp đồng",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const res = await api.deletePieceworkContract(c.id);
      if (res.ok) {
        toast.success(`Đã xóa hợp đồng khoán ${res.contract_code} thành công!`);
        if (selectedDetail && selectedDetail.id === c.id) {
          setSelectedDetail(null);
        }
        loadContracts();
      }
    } catch (err) {
      toast.error("Lỗi xóa hợp đồng: " + (err as Error).message);
    }
  };

  const handleAuditContract = async (c: PieceworkContractItem) => {
    try {
      const res = await api.validatePieceworkContract(c.id);
      const detail = await api.getPieceworkContract(c.id);
      setAuditModal({
        contract_code: c.contract_code,
        worker_name: c.worker_name,
        audit: res.deficiency,
        attachments: detail.attachments,
        worker_signature_data: detail.worker_signature_data,
        worker_face_photo_data: detail.worker_face_photo_data,
      });
    } catch (err) {
      toast.error("Lỗi kiểm định hồ sơ: " + (err as Error).message);
    }
  };

  const openDetail = async (contractId: number) => {
    try {
      const det = await api.getPieceworkContract(contractId);
      setSelectedDetail(det);
    } catch (err) {
      toast.error("Không thể lấy chi tiết hợp đồng: " + (err as Error).message);
    }
  };

  const openEditContract = async (contractId: number) => {
    try {
      const det = await api.getPieceworkContract(contractId);
      setEditingContract(det);
    } catch (err) {
      toast.error("Lỗi lấy thông tin sửa: " + (err as Error).message);
    }
  };

  const handleSaveEditContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContract) return;
    const total = editingContract.items.reduce((s, it) => s + (it.thanh_tien || 0), 0);
    try {
      const res = await api.updatePieceworkContract(editingContract.id, {
        title: editingContract.title,
        contract_type: editingContract.contract_type,
        project_name: editingContract.project_name,
        location: editingContract.location,
        contract_date: editingContract.contract_date,
        worker_name: editingContract.worker_name,
        worker_id_card: editingContract.worker_id_card,
        worker_id_card_date: editingContract.worker_id_card_date,
        worker_id_card_place: editingContract.worker_id_card_place,
        worker_tax_code: editingContract.worker_tax_code,
        worker_phone: editingContract.worker_phone,
        worker_address: editingContract.worker_address,
        worker_bank_account: editingContract.worker_bank_account,
        worker_bank_name: editingContract.worker_bank_name,
        payment_method: editingContract.payment_method || "bank_transfer",
        total_amount: total,
        items: editingContract.items,
        note: editingContract.note,
      });
      if (res.ok) {
        toast.success(`Cập nhật hợp đồng ${editingContract.contract_code} thành công!`);
        setEditingContract(null);
        loadContracts();
        if (selectedDetail && selectedDetail.id === editingContract.id) {
          const updated = await api.getPieceworkContract(editingContract.id);
          setSelectedDetail(updated);
        }
      }
    } catch (err) {
      toast.error("Lỗi cập nhật hợp đồng: " + (err as Error).message);
    }
  };

  const toggleChecklist = async (contractId: number, field: string, currentValue: boolean) => {
    try {
      await api.updatePieceworkContract(contractId, { [field]: !currentValue });
      const updated = await api.getPieceworkContract(contractId);
      setSelectedDetail(updated);
      loadContracts();
    } catch (err) {
      toast.error("Lỗi cập nhật: " + (err as Error).message);
    }
  };

  const handleAddItem = () => {
    setFormData((prev) => ({
      ...prev,
      items: [...prev.items, { ten: "", dvt: "Gói", so_luong: 1, don_gia: 0, thanh_tien: 0 }],
    }));
  };

  const handleItemChange = (index: number, field: keyof PieceworkWorkItem, val: string | number) => {
    setFormData((prev) => {
      const nextItems = [...prev.items];
      const item = { ...nextItems[index], [field]: val };
      if (field === "so_luong" || field === "don_gia") {
        item.thanh_tien = Number(item.so_luong) * Number(item.don_gia);
      }
      nextItems[index] = item;
      return { ...prev, items: nextItems };
    });
  };

  const handleRemoveItem = (index: number) => {
    setFormData((prev) =>
      prev.items.length <= 1 ? prev : { ...prev, items: prev.items.filter((_, i) => i !== index) },
    );
  };

  const handleEditItemChange = (
    index: number,
    field: keyof PieceworkWorkItem,
    val: string | number,
  ) => {
    if (!editingContract) return;
    const newItems = [...editingContract.items];
    const item = { ...newItems[index], [field]: val };
    if (field === "so_luong" || field === "don_gia") {
      item.thanh_tien = Number(item.so_luong) * Number(item.don_gia);
    }
    newItems[index] = item;
    setEditingContract({ ...editingContract, items: newItems });
  };

  const handleEditAddItem = () => {
    if (!editingContract) return;
    setEditingContract({
      ...editingContract,
      items: [...editingContract.items, { ten: "", dvt: "Gói", so_luong: 1, don_gia: 0, thanh_tien: 0 }],
    });
  };

  const handleEditRemoveItem = (index: number) => {
    if (!editingContract || editingContract.items.length <= 1) return;
    setEditingContract({
      ...editingContract,
      items: editingContract.items.filter((_, i) => i !== index),
    });
  };

  const handleCreateContract = async (e: React.FormEvent) => {
    e.preventDefault();
    const total = formData.items.reduce((sum, it) => sum + (it.thanh_tien || 0), 0);
    try {
      const res = await api.createPieceworkContract({
        ...formData,
        total_amount: total,
      });
      if (res.ok) {
        toast.success(`Tạo hợp đồng khoán ${res.contract_code} thành công!`);
        setShowCreateModal(false);
        setFormData(createDefaultContractForm());
        loadContracts();
      }
    } catch (err) {
      toast.error("Lỗi tạo hợp đồng: " + (err as Error).message);
    }
  };

  // Metrics
  const totalContracts = contracts.length;
  const pendingDocsCount = contracts.filter((c) => c.deficiency?.status_code === "pending_docs").length;
  const readyToPayCount = contracts.filter((c) => c.deficiency?.status_code === "ready_to_pay").length;
  const completedCount = contracts.filter((c) => c.deficiency?.status_code === "completed").length;
  const totalGross = contracts.reduce((sum, c) => sum + (c.total_amount || 0), 0);

  const contractorContractsTotal = contractors.reduce((s, c) => s + (c.contracts_count || 0), 0);
  const contractorGrossTotal = contractors.reduce((s, c) => s + (c.total_gross || 0), 0);
  const contractorNetTotal = contractors.reduce((s, c) => s + (c.total_net || 0), 0);
  const contractorTaxTotal = contractors.reduce((s, c) => s + (c.total_tax || 0), 0);

  const activeContractFilters =
    (search.trim() ? 1 : 0) + (typeFilter ? 1 : 0) + (statusFilter ? 1 : 0);

  return (
    <PageShell data-page="piecework">
      <PageHeader
        variant="compact"
        icon="briefcase"
        title="Quản Lý Hợp Đồng Giao Khoán & Hồ Sơ Thợ/CTV"
        subtitle="Giao khoán dân sự & kiểm định chứng từ tự động (NĐ 253/2026/NĐ-CP · Luật BHXH 2024)"
        actions={
          <ActionBar
            className="pw-bar"
            secondaryActions={
              <>
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon="user-plus"
                  onClick={openNewContractorModal}
                >
                  Thêm Nhà Cung Cấp
                </AppButton>
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon="zap"
                  onClick={() => {
                    setSmartPasteTarget("contract");
                    setSmartPasteText("");
                    setShowSmartPasteModal(true);
                  }}
                >
                  Smart Paste
                </AppButton>
              </>
            }
            primaryActions={
              <AppButton
                variant="primary"
                size="sm"
                leftIcon="plus"
                aria-label="＋ Tạo HĐ Khoán Mới"
                onClick={() => setShowCreateModal(true)}
              >
                Tạo HĐ Khoán Mới
              </AppButton>
            }
            overflowItems={[
              {
                label: syncingQuarterDrive ? "Đang sync Drive Quý..." : "Sync Drive Quý",
                icon: "cloud-upload",
                disabled: syncingQuarterDrive,
                onClick: handleSyncQuarterlyDrive,
              },
            ]}
          />
        }
      />

      <ResponsiveTabs
        ariaLabel="Chuyển mục hợp đồng khoán"
        active={activeMainTab}
        onChange={setActiveMainTab}
        tabs={[
          {
            id: "contracts",
            label: "Danh Sách Hợp Đồng Khoán",
            icon: "file-text",
            badge: contracts.length,
          },
          {
            id: "contractors",
            label: "Danh Bạ Nhà Cung Cấp / Thợ",
            icon: "users",
            badge: contractors.length,
          },
        ]}
      />

      {loadError && (
        <InlineAlert tone="danger" onDismiss={() => setLoadError(null)}>
          {loadError}
        </InlineAlert>
      )}

      {activeMainTab === "contracts" && (
        <div className="ui-stack" data-testid="piecework-contracts-view">
          <KpiStrip
            columns={4}
            loading={loading && contracts.length === 0}
            items={[
              {
                label: "Tổng số hợp đồng",
                value: totalContracts,
                sub: formatVnd(totalGross),
                tone: "brand",
                icon: "file-text",
                active: statusFilter === "",
                onClick: () => setStatusFilter(""),
              },
              {
                label: "Cần bổ sung hồ sơ",
                value: pendingDocsCount,
                sub: "Thiếu CCCD, nghiệm thu, ảnh HT",
                tone: "warning",
                icon: "alert-triangle",
                active: statusFilter === "pending_docs",
                onClick: () =>
                  setStatusFilter(statusFilter === "pending_docs" ? "" : "pending_docs"),
              },
              {
                label: "Đủ điều kiện thanh toán",
                value: readyToPayCount,
                sub: "Đã có chữ ký & đủ chứng từ",
                tone: "success",
                icon: "check-circle",
                active: statusFilter === "ready_to_pay",
                onClick: () =>
                  setStatusFilter(statusFilter === "ready_to_pay" ? "" : "ready_to_pay"),
              },
              {
                label: "Đã thanh toán (Có UNC)",
                value: completedCount,
                sub: "Đã khớp Techcombank 79713",
                tone: "neutral",
                icon: "landmark",
                active: statusFilter === "completed",
                onClick: () => setStatusFilter(statusFilter === "completed" ? "" : "completed"),
              },
            ]}
          />

          <FilterBar
            collapsibleMobile
            search={{
              value: search,
              onChange: setSearch,
              placeholder: "Tìm theo mã HĐ, tên thợ, số CCCD, công trình...",
              ariaLabel: "Tìm kiếm hợp đồng giao khoán",
            }}
            activeCount={activeContractFilters}
            onReset={() => {
              setSearch("");
              setTypeFilter("");
              setStatusFilter("");
              loadContracts({ q: "", status_f: "", contract_type: "" });
            }}
            filters={
              <>
                <select
                  aria-label="Lọc theo loại hợp đồng"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="ui-select"
                >
                  <option value="">Tất cả loại hợp đồng</option>
                  <option value="mua_ban_ca_nhan">HĐ Mua bán cá nhân</option>
                  <option value="thi_cong">Thi công lắp đặt</option>
                  <option value="boc_xep">Bốc xếp vận chuyển</option>
                  <option value="gia_cong">Gia công sản phẩm</option>
                  <option value="marketing">Marketing / Truyền thông</option>
                </select>

                <select
                  aria-label="Lọc theo trạng thái hồ sơ"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="ui-select"
                >
                  <option value="">Mọi trạng thái hồ sơ</option>
                  <option value="pending_docs">Cần bổ sung hồ sơ</option>
                  <option value="ready_to_pay">Đủ điều kiện thanh toán</option>
                  <option value="completed">Đã thanh toán (Có UNC)</option>
                </select>
              </>
            }
          />

          {loading ? (
            <TableSkeleton rows={5} cols={6} />
          ) : contracts.length === 0 ? (
            <EmptyState
              icon="briefcase"
              title="Không tìm thấy hợp đồng giao khoán nào phù hợp"
              description="Tạo hợp đồng giao khoán mới hoặc điều chỉnh bộ lọc tìm kiếm."
              action={
                <AppButton
                  variant="primary"
                  leftIcon="plus"
                  onClick={() => setShowCreateModal(true)}
                >
                  Tạo hợp đồng mới
                </AppButton>
              }
            />
          ) : (
            <DataView
              mobileMode="card"
              desktop={
                <div className="ui-table-scroll-wrap piecework-desktop-table" tabIndex={0}>
                  <table className="ui-table">
                    <thead>
                      <tr>
                        <th>Mã HĐ / Ngày</th>
                        <th>Thợ nhận khoán</th>
                        <th>Công trình / Hạng mục</th>
                        <th className="col-num">Giá trị khoán (VNĐ)</th>
                        <th>Deficiency Radar (Kiểm soát hồ sơ)</th>
                        <th>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contracts.map((c) => {
                        const def = c.deficiency;
                        const checks = def?.checklist || [];
                        const safeDriveHref = safeHttpUrl(c.drive_link);
                        const safePortalHref = safeHttpUrl(`/khoan/${c.portal_token}`);
                        const safePdfHref = safeHttpUrl(`/api/public/khoan/${c.portal_token}/pdf`);
                        return (
                          <tr key={c.id}>
                            <td>
                              <div className="ui-mono ui-text-brand ui-wrap">{c.contract_code}</div>
                              <div className="pw-sub">{c.contract_date}</div>
                              <StatusBadge
                                size="sm"
                                tone={contractTypeTone(c.contract_type)}
                                icon={c.contract_type === "mua_ban_ca_nhan" ? "briefcase" : undefined}
                              >
                                {contractTypeLabel(c.contract_type)}
                              </StatusBadge>
                            </td>

                            <td>
                              <div className="ui-text-strong ui-wrap">{c.worker_name}</div>
                              <div className="pw-sub">CCCD: {c.worker_id_card || "Chưa có"}</div>
                              <div className="pw-sub">SĐT: {c.worker_phone || "Chưa có"}</div>
                              {c.payment_method === "cash" ? (
                                <div className="ui-text-xs ui-text-success">
                                  {c.contract_type === "mua_ban_ca_nhan"
                                    ? "Nhận tiền mặt trực tiếp"
                                    : "Nhận tiền mặt tại chân công trình"}
                                </div>
                              ) : (
                                <div className="ui-text-xs ui-text-brand">
                                  {c.worker_bank_account} ({c.worker_bank_name})
                                </div>
                              )}
                            </td>

                            <td>
                              <div className="ui-text-strong ui-wrap">{c.project_name}</div>
                              <div className="pw-sub">
                                <AppIcon name="map-pin" size={12} />
                                <span>{c.location}</span>
                              </div>
                            </td>

                            <td className="col-num">
                              <div className="pw-num">{formatVnd(c.total_amount)}</div>
                              {def?.is_sub_5m ? (
                                <div className="ui-text-xs ui-text-success">Miễn 10% TNCN (NĐ 253)</div>
                              ) : (
                                <>
                                  <div className="ui-text-xs ui-text-danger">
                                    Trừ 10% Thuế: -{formatVnd(c.tax_amount)}
                                  </div>
                                  <div className="ui-text-xs ui-text-success">
                                    Thực nhận: {formatVnd(c.net_amount)}
                                  </div>
                                </>
                              )}
                            </td>

                            <td>
                              <div className="ui-stack--sm">
                                <div className="pw-chips">
                                  <StatusBadge
                                    size="sm"
                                    tone={checks[0]?.ok ? "success" : "danger"}
                                    icon={checks[0]?.ok ? "check" : "x"}
                                  >
                                    {checks[0]?.ok ? "CCCD 2 mặt" : "Thiếu CCCD"}
                                  </StatusBadge>
                                  <StatusBadge
                                    size="sm"
                                    tone={checks[1]?.ok ? "success" : "danger"}
                                    icon={checks[1]?.ok ? "check" : "x"}
                                  >
                                    {checks[1]?.ok ? "STK chính chủ" : "Thiếu STK"}
                                  </StatusBadge>
                                  <StatusBadge
                                    size="sm"
                                    tone={checks[2]?.ok ? "success" : "danger"}
                                    icon={checks[2]?.ok ? "check" : "x"}
                                  >
                                    {checks[2]?.ok ? "Nghiệm thu" : "Thiếu Nghiệm thu"}
                                  </StatusBadge>
                                  <StatusBadge
                                    size="sm"
                                    tone={checks[4]?.ok ? "success" : "warning"}
                                    icon={checks[4]?.ok ? "check" : "clock"}
                                  >
                                    {checks[4]?.ok ? "Thợ đã ký online" : "Chờ thợ ký"}
                                  </StatusBadge>
                                  <StatusBadge
                                    size="sm"
                                    tone={checks[5]?.ok ? "success" : "neutral"}
                                    icon={checks[5]?.ok ? "check" : undefined}
                                  >
                                    {checks[5]?.ok ? "Ký số INUT" : "Chưa ký số A"}
                                  </StatusBadge>
                                  <StatusBadge
                                    size="sm"
                                    tone={checks[6]?.ok ? "success" : "neutral"}
                                    icon={checks[6]?.ok ? "check" : undefined}
                                  >
                                    {checks[6]?.ok ? "Đã kẹp UNC" : "Chưa có UNC"}
                                  </StatusBadge>
                                </div>
                                <div>
                                  <StatusBadge size="sm" tone={deficiencyStatusTone(def)} dot>
                                    {stripLeadingEmoji(def?.status_label)}
                                  </StatusBadge>
                                </div>
                              </div>
                            </td>

                            <td>
                              <div className="pw-act">
                                <div className="pw-act-row">
                                  <AppButton
                                    variant="primary"
                                    size="sm"
                                    leftIcon={c.is_signed_by_worker ? "file-signature" : "clock"}
                                    loading={actionLoading === c.id}
                                    disabled={actionLoading === c.id || !c.is_signed_by_worker}
                                    onClick={() => openSigningModal(c)}
                                    title={
                                      !c.is_signed_by_worker
                                        ? "Chờ người nhận khoán (Bên B) ký online trước khi Bên A ký số"
                                        : c.is_signed_by_inut
                                          ? "Bấm để ký lại số điện tử với chứng thư hoặc mốc thời gian khác"
                                          : "Ký số điện tử Bên A (INUT)"
                                    }
                                  >
                                    {actionLoading === c.id
                                      ? "Đang ký…"
                                      : !c.is_signed_by_worker
                                        ? "Chờ thợ ký"
                                        : c.is_signed_by_inut
                                          ? "Ký lại"
                                          : "Ký INUT"}
                                  </AppButton>

                                  <AppButton
                                    variant="secondary"
                                    size="sm"
                                    leftIcon="eye"
                                    onClick={() => openDetail(c.id)}
                                  >
                                    Chi tiết
                                  </AppButton>
                                </div>

                                <div className="pw-act-row">
                                  <AppButton
                                    variant="secondary"
                                    size="sm"
                                    leftIcon="copy"
                                    onClick={() =>
                                      copyToClipboard(
                                        `/khoan/${c.portal_token}`,
                                        `ký online HĐ ${c.contract_code}`,
                                      )
                                    }
                                    title="Sao chép link Portal di động gửi Zalo cho thợ"
                                  >
                                    Copy Zalo
                                  </AppButton>
                                  <AppButton
                                    variant="secondary"
                                    size="sm"
                                    leftIcon="share"
                                    onClick={() =>
                                      setShareModal({
                                        contract: c,
                                        tab: c.is_signed_by_inut ? "signed" : "unsigned",
                                      })
                                    }
                                    title={
                                      c.is_signed_by_inut
                                        ? "Chia sẻ PDF đã ký số"
                                        : "Chia sẻ PDF bản thảo chưa ký"
                                    }
                                  >
                                    Share
                                  </AppButton>
                                  {safePortalHref && (
                                    <a
                                      href={safePortalHref}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="ui-btn ui-btn--secondary ui-btn--sm"
                                      title="Mở giao diện ký online của thợ để kiểm tra"
                                    >
                                      <AppIcon name="external-link" size={14} />
                                      <span>Portal</span>
                                    </a>
                                  )}
                                  {safePdfHref && (
                                    <a
                                      href={safePdfHref}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="ui-btn ui-btn--secondary ui-btn--sm"
                                    >
                                      <AppIcon name="file-text" size={14} />
                                      <span>PDF</span>
                                    </a>
                                  )}
                                </div>

                                <div className="pw-act-row">
                                  <AppButton
                                    variant="secondary"
                                    size="sm"
                                    leftIcon="file-search"
                                    onClick={() => handleAuditContract(c)}
                                    title="Kiểm định tính hợp lệ toàn diện hồ sơ theo luật"
                                  >
                                    Kiểm định
                                  </AppButton>
                                  <AppButton
                                    variant="secondary"
                                    size="sm"
                                    leftIcon="cloud-upload"
                                    loading={syncingDriveId === c.id}
                                    onClick={() => handleSyncDrive(c)}
                                    title={
                                      c.drive_synced_at
                                        ? `Đã đồng bộ lên Drive Kế toán (${formatDateTimeWithSeconds(c.drive_synced_at)}). Bấm để sync lại.`
                                        : "Đồng bộ bộ hồ sơ HĐ giao khoán lên Google Drive Kế toán theo quý"
                                    }
                                  >
                                    {syncingDriveId === c.id
                                      ? "Đang sync..."
                                      : c.drive_synced_at
                                        ? "Đã sync Drive"
                                        : "Sync Drive"}
                                  </AppButton>
                                </div>

                                <div className="pw-act-row">
                                  {c.is_signed_by_inut && (
                                    <AppButton
                                      variant="secondary"
                                      size="sm"
                                      leftIcon="shield-check"
                                      onClick={() => handleVerifySignature(c)}
                                      title="Kiểm tra thẩm định chữ ký số theo chuẩn Foxit Reader và Cơ quan Thuế"
                                    >
                                      Thẩm định Chữ ký số
                                    </AppButton>
                                  )}
                                  <AppButton
                                    variant="danger"
                                    size="sm"
                                    iconOnly
                                    leftIcon="trash"
                                    aria-label={`Xóa hợp đồng ${c.contract_code}`}
                                    title="Xóa hợp đồng khoán"
                                    onClick={() => handleDeleteContract(c)}
                                  />
                                </div>

                                {safeDriveHref && (
                                  <a
                                    href={safeDriveHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ui-btn ui-btn--ghost ui-btn--sm"
                                    title={c.drive_folder}
                                  >
                                    <AppIcon name="folder-open" size={14} />
                                    <span>Mở Drive Quý</span>
                                  </a>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              }
              mobileCards={
                <div
                  className="ui-mobile-card-list piecework-mobile-cards"
                  data-testid="piecework-mobile-cards"
                >
                  {contracts.map((c) => {
                    const def = c.deficiency;
                    const checks = def?.checklist || [];
                    const safeDriveHref = safeHttpUrl(c.drive_link);
                    const safePortalHref = safeHttpUrl(`/khoan/${c.portal_token}`);
                    const safePdfHref = safeHttpUrl(`/api/public/khoan/${c.portal_token}/pdf`);
                    return (
                      <MobileCard
                        key={c.id}
                        className="piecework-mobile-card"
                      >
                        <MobileCardHeader
                          title={<span className="ui-mono ui-text-brand ui-wrap">{c.contract_code}</span>}
                          subtitle={
                            <span className="ui-row">
                              <span>{c.contract_date}</span>
                              <StatusBadge size="sm" tone={contractTypeTone(c.contract_type)}>
                                {contractTypeLabel(c.contract_type)}
                              </StatusBadge>
                            </span>
                          }
                          badge={
                            <StatusBadge size="sm" tone={deficiencyStatusTone(def)} dot>
                              {stripLeadingEmoji(def?.status_label)}
                            </StatusBadge>
                          }
                        />

                        <MobileCardGrid cols={2}>
                          <MobileCardRow
                            label={
                              c.contract_type === "mua_ban_ca_nhan"
                                ? "Cá nhân (Bên B)"
                                : "Thợ nhận khoán"
                            }
                            value={c.worker_name}
                          />
                          <MobileCardRow
                            label="CCCD / SĐT"
                            value={`${c.worker_id_card || "Chưa có"} · ${c.worker_phone || "N/A"}`}
                          />
                          <MobileCardRow
                            label="Hình thức nhận"
                            value={
                              c.payment_method === "cash" ? (
                                <span className="ui-text-xs ui-text-success">
                                  {c.contract_type === "mua_ban_ca_nhan"
                                    ? "Nhận tiền mặt trực tiếp"
                                    : "Nhận tiền mặt tại công trình"}
                                </span>
                              ) : (
                                <span className="ui-text-xs ui-text-brand">
                                  {c.worker_bank_account} ({c.worker_bank_name})
                                </span>
                              )
                            }
                            fullWidth
                          />
                          <MobileCardRow label="Công trình" value={c.project_name} fullWidth />
                          <MobileCardRow
                            label="Giá trị khoán"
                            value={
                              <span>
                                <span className="pw-num">{formatVnd(c.total_amount)}</span>{" "}
                                {def?.is_sub_5m ? (
                                  <span className="ui-text-xs ui-text-success">Miễn 10% TNCN (NĐ 253)</span>
                                ) : (
                                  <span className="ui-text-xs ui-text-danger">
                                    -10% Thuế ({formatVnd(c.tax_amount)})
                                  </span>
                                )}
                              </span>
                            }
                            fullWidth
                          />
                        </MobileCardGrid>

                        <div className="ui-subpanel ui-subpanel--md ui-text-xs pw-chips">
                          <StatusBadge
                            size="sm"
                            tone={checks[0]?.ok ? "success" : "danger"}
                            icon={checks[0]?.ok ? "check" : "x"}
                          >
                            {checks[0]?.ok ? "CCCD 2 mặt" : "Thiếu CCCD"}
                          </StatusBadge>
                          <StatusBadge
                            size="sm"
                            tone={checks[2]?.ok ? "success" : "danger"}
                            icon={checks[2]?.ok ? "check" : "x"}
                          >
                            {checks[2]?.ok ? "Nghiệm thu" : "Thiếu Nghiệm thu"}
                          </StatusBadge>
                          <StatusBadge
                            size="sm"
                            tone={checks[4]?.ok ? "success" : "warning"}
                            icon={checks[4]?.ok ? "check" : "clock"}
                          >
                            {checks[4]?.ok ? "Thợ đã ký online" : "Chờ thợ ký"}
                          </StatusBadge>
                          <StatusBadge
                            size="sm"
                            tone={checks[5]?.ok ? "success" : "neutral"}
                            icon={checks[5]?.ok ? "check" : undefined}
                          >
                            {checks[5]?.ok ? "Ký số INUT" : "Chưa ký số A"}
                          </StatusBadge>
                          <StatusBadge
                            size="sm"
                            tone={checks[6]?.ok ? "success" : "neutral"}
                            icon={checks[6]?.ok ? "check" : undefined}
                          >
                            {checks[6]?.ok ? "Đã kẹp UNC" : "Chưa có UNC"}
                          </StatusBadge>
                        </div>

                        <div className="pw-m-acts">
                          <AppButton
                            variant="secondary"
                            size="sm"
                            leftIcon="share"
                            className="ui-form-grid-span-full"
                            onClick={() =>
                              setShareModal({
                                contract: c,
                                tab: c.is_signed_by_inut ? "signed" : "unsigned",
                              })
                            }
                          >
                            {c.is_signed_by_inut
                              ? "Chia sẻ PDF Đã Ký (Zalo / Email / Link)"
                              : "Chia sẻ PDF Bản Thảo (Chưa Ký)"}
                          </AppButton>

                          <AppButton
                            variant="secondary"
                            size="sm"
                            leftIcon="copy"
                            onClick={() =>
                              copyToClipboard(
                                `/khoan/${c.portal_token}`,
                                `ký online HĐ ${c.contract_code}`,
                              )
                            }
                          >
                            Copy Zalo thợ
                          </AppButton>

                          {safePortalHref && (
                            <a
                              href={safePortalHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ui-btn ui-btn--secondary ui-btn--sm"
                            >
                              <AppIcon name="external-link" size={14} />
                              <span>Mở Portal ký</span>
                            </a>
                          )}

                          {safePdfHref && (
                            <a
                              href={safePdfHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ui-btn ui-btn--secondary ui-btn--sm"
                            >
                              <AppIcon name="file-text" size={14} />
                              <span>Mở PDF</span>
                            </a>
                          )}

                          <AppButton
                            variant="primary"
                            size="sm"
                            leftIcon={c.is_signed_by_worker ? "file-signature" : "clock"}
                            loading={actionLoading === c.id}
                            disabled={actionLoading === c.id || !c.is_signed_by_worker}
                            onClick={() => openSigningModal(c)}
                            title={
                              !c.is_signed_by_worker
                                ? "Chờ người nhận khoán (Bên B) ký online trước khi Bên A ký số"
                                : undefined
                            }
                          >
                            {actionLoading === c.id
                              ? "Đang ký…"
                              : !c.is_signed_by_worker
                                ? "Chờ thợ ký"
                                : c.is_signed_by_inut
                                  ? "Ký lại INUT"
                                  : "Ký số INUT"}
                          </AppButton>

                          <AppButton
                            variant="secondary"
                            size="sm"
                            leftIcon="file-search"
                            onClick={() => handleAuditContract(c)}
                          >
                            Kiểm định
                          </AppButton>

                          <AppButton
                            variant="secondary"
                            size="sm"
                            leftIcon="eye"
                            onClick={() => openDetail(c.id)}
                          >
                            Chi tiết HĐ
                          </AppButton>

                          {c.is_signed_by_inut && (
                            <AppButton
                              variant="secondary"
                              size="sm"
                              leftIcon="shield-check"
                              className="ui-form-grid-span-full"
                              onClick={() => handleVerifySignature(c)}
                            >
                              Thẩm định Chữ ký số (Chuẩn Foxit / Thuế)
                            </AppButton>
                          )}

                          <AppButton
                            variant="secondary"
                            size="sm"
                            leftIcon="cloud-upload"
                            className="ui-form-grid-span-full"
                            loading={syncingDriveId === c.id}
                            onClick={() => handleSyncDrive(c)}
                          >
                            {syncingDriveId === c.id
                              ? "Đang sync Drive..."
                              : c.drive_synced_at
                                ? "Đã sync Drive Kế toán"
                                : "Đồng bộ lên Drive Kế toán"}
                          </AppButton>

                          {safeDriveHref && (
                            <a
                              href={safeDriveHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ui-btn ui-btn--primary ui-btn--sm ui-form-grid-span-full"
                            >
                              <AppIcon name="folder-open" size={14} />
                              <span>Mở Thư Mục Trên Google Drive</span>
                            </a>
                          )}
                        </div>
                      </MobileCard>
                    );
                  })}
                </div>
              }
            />
          )}
        </div>
      )}

      {activeMainTab === "contractors" && (
        <div className="ui-stack" data-testid="piecework-contractors-view">
          <KpiStrip
            columns={4}
            loading={contractorLoading && contractors.length === 0}
            items={[
              {
                label: "Tổng số nhà cung cấp/thợ",
                value: contractors.length,
                sub: "Đã định danh CCCD & MST",
                tone: "neutral",
                icon: "users",
              },
              {
                label: "Hợp đồng đã giao",
                value: contractorContractsTotal,
                sub: "Tổng số lượt khoán việc",
                tone: "brand",
                icon: "briefcase",
              },
              {
                label: "Tổng thù lao chi trả (Gross)",
                value: formatVnd(contractorGrossTotal),
                sub: `Thực nhận (Net): ${formatVnd(contractorNetTotal)}`,
                tone: "success",
                icon: "wallet",
              },
              {
                label: "Thuế TNCN đã khấu trừ (10%)",
                value: formatVnd(contractorTaxTotal),
                sub: "Nộp NSNN (NĐ 253/2026)",
                tone: "warning",
                icon: "scale",
              },
            ]}
          />

          <FilterBar
            collapsibleMobile={false}
            search={{
              value: contractorSearch,
              onChange: setContractorSearch,
              placeholder: "Tìm thợ theo họ tên, CCCD, MST cá nhân, SĐT, ngân hàng...",
              ariaLabel: "Tìm kiếm nhà cung cấp khoán",
            }}
            activeCount={contractorSearch.trim() ? 1 : 0}
            onReset={() => setContractorSearch("")}
            actions={
              <>
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon="user-plus"
                  onClick={openNewContractorModal}
                >
                  Thêm Nhà Cung Cấp Mới
                </AppButton>
                <AppButton
                  variant="gold"
                  size="sm"
                  leftIcon="zap"
                  onClick={() => {
                    setSmartPasteTarget("contractor");
                    setSmartPasteText("");
                    setShowSmartPasteModal(true);
                  }}
                >
                  Smart Paste (Dán Nhanh)
                </AppButton>
              </>
            }
          />

          {contractorLoading ? (
            <TableSkeleton rows={4} cols={6} />
          ) : contractors.length === 0 ? (
            <EmptyState
              icon="users"
              title="Chưa có nhà cung cấp / thợ khoán nào phù hợp"
              description='Bấm "Thêm Nhà Cung Cấp Mới" hoặc "Smart Paste" để lưu định danh CCCD & MST nhanh.'
              action={
                <AppButton variant="primary" leftIcon="user-plus" onClick={openNewContractorModal}>
                  Thêm Nhà Cung Cấp Mới
                </AppButton>
              }
            />
          ) : (
            <DataView
              mobileMode="card"
              desktop={
                <div
                  className="ui-table-scroll-wrap piecework-desktop-table"
                  data-testid="contractors-desktop-table"
                  tabIndex={0}
                >
                  <table className="ui-table">
                    <thead>
                      <tr>
                        <th>Mã / Họ tên nhà cung cấp</th>
                        <th>CCCD / Ngày cấp / Nơi cấp</th>
                        <th>MST cá nhân / SĐT</th>
                        <th>Tài khoản ngân hàng</th>
                        <th className="col-num">Hợp đồng / Thù lao (Gross)</th>
                        <th>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contractors.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <div className="ui-text-strong ui-wrap">{c.name}</div>
                            <StatusBadge size="sm" tone="brand">
                              {c.code}
                            </StatusBadge>
                            {c.skills && (
                              <div className="pw-sub">
                                <AppIcon name="wrench" size={12} />
                                <span>{c.skills}</span>
                              </div>
                            )}
                          </td>

                          <td>
                            <div className="ui-text-xs ui-text-brand">CCCD: {c.id_card}</div>
                            <div className="pw-sub">Ngày cấp: {c.id_card_date || "N/A"}</div>
                            <div className="pw-sub">
                              {c.id_card_place || "Cục CSQLHC về TTXH"}
                            </div>
                          </td>

                          <td>
                            <div className={c.tax_code ? "ui-text-xs ui-text-success" : "ui-text-xs ui-text-warning"}>
                              {c.tax_code ? `MST: ${c.tax_code}` : "Chưa có MST"}
                            </div>
                            <div className="pw-sub">
                              <AppIcon name="phone" size={12} />
                              <span>SĐT: {c.phone || "Chưa có"}</span>
                            </div>
                            <div className="pw-sub pw-clip" title={c.address}>
                              <AppIcon name="map-pin" size={12} />
                              <span>{c.address || "Chưa có địa chỉ"}</span>
                            </div>
                          </td>

                          <td>
                            <div className="ui-text-strong ui-wrap ui-mono ui-wrap">{c.bank_account}</div>
                            <div className="ui-text-xs ui-text-brand">{c.bank_name}</div>
                            <div className="ui-text-xs ui-text-success">Đủ điều kiện chi Techcombank 79713</div>
                          </td>

                          <td className="col-num">
                            <div className="pw-num">{formatVnd(c.total_gross)}</div>
                            <div className="ui-text-xs ui-text-brand">
                              <b>{c.contracts_count}</b> hợp đồng khoán
                            </div>
                            {c.total_tax > 0 ? (
                              <div className="ui-text-xs ui-text-warning">
                                Thuế TNCN: -{formatVnd(c.total_tax)}
                              </div>
                            ) : (
                              <div className="ui-text-xs ui-text-success">Miễn trừ thuế TNCN</div>
                            )}
                          </td>

                          <td>
                            <div className="pw-act">
                              <AppButton
                                variant="primary"
                                size="sm"
                                fullWidth
                                leftIcon="plus"
                                onClick={() => handleCreateContractForContractor(c)}
                                title="Tạo hợp đồng khoán mới cho nhà cung cấp này (tự điền 100%)"
                              >
                                Tạo HĐ Khoán
                              </AppButton>
                              <AppButton
                                variant="secondary"
                                size="sm"
                                fullWidth
                                leftIcon="bar-chart"
                                loading={taxSummaryLoadingId === c.id}
                                onClick={() => handleOpenTaxSummary(c.id)}
                                title="Xem bảng kê quyết toán & khấu trừ thuế TNCN để hỗ trợ thợ hoàn thuế"
                              >
                                Quyết Toán Thuế
                              </AppButton>
                              <div className="pw-act-row">
                                <AppButton
                                  variant="secondary"
                                  size="sm"
                                  leftIcon="edit"
                                  onClick={() => openEditContractorModal(c)}
                                >
                                  Sửa
                                </AppButton>
                                <AppButton
                                  variant="danger"
                                  size="sm"
                                  leftIcon="trash"
                                  onClick={() => handleDeleteContractor(c)}
                                >
                                  Xóa
                                </AppButton>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              }
              mobileCards={
                <div
                  className="ui-mobile-card-list piecework-mobile-cards"
                  data-testid="contractors-mobile-cards"
                >
                  {contractors.map((c) => (
                    <MobileCard key={c.id} className="piecework-mobile-card">
                      <MobileCardHeader
                        title={c.name}
                        subtitle={<span className="ui-text-xs ui-text-brand">{c.code}</span>}
                        badge={
                          <StatusBadge size="sm" tone="success">
                            {c.contracts_count} HĐ Khoán
                          </StatusBadge>
                        }
                      />

                      <MobileCardGrid cols={2}>
                        <MobileCardRow
                          label="Số CCCD"
                          value={<span className="ui-text-xs ui-text-brand">{c.id_card}</span>}
                          mono
                        />
                        <MobileCardRow
                          label="Mã số thuế"
                          value={
                            <span className={c.tax_code ? "ui-text-xs ui-text-success" : "ui-text-xs ui-text-warning"}>
                              {c.tax_code || "Chưa có"}
                            </span>
                          }
                          mono
                        />
                        <MobileCardRow label="Số điện thoại" value={c.phone || "N/A"} />
                        <MobileCardRow
                          label="STK thụ hưởng"
                          value={`${c.bank_account} (${c.bank_name})`}
                        />
                        <MobileCardRow
                          label="Tổng thù lao (Gross)"
                          value={<span className="pw-num">{formatVnd(c.total_gross)}</span>}
                          fullWidth
                        />
                      </MobileCardGrid>

                      <div className="pw-m-acts">
                        <AppButton
                          variant="primary"
                          size="sm"
                          leftIcon="plus"
                          className="ui-form-grid-span-full"
                          onClick={() => handleCreateContractForContractor(c)}
                        >
                          Tạo Hợp Đồng Khoán Cho Thợ Này
                        </AppButton>
                        <AppButton
                          variant="secondary"
                          size="sm"
                          leftIcon="bar-chart"
                          loading={taxSummaryLoadingId === c.id}
                          onClick={() => handleOpenTaxSummary(c.id)}
                        >
                          Quyết Toán Thuế
                        </AppButton>
                        <AppButton
                          variant="secondary"
                          size="sm"
                          leftIcon="edit"
                          onClick={() => openEditContractorModal(c)}
                        >
                          Sửa Hồ Sơ
                        </AppButton>
                        <AppButton
                          variant="danger"
                          size="sm"
                          leftIcon="trash"
                          className="ui-form-grid-span-full"
                          onClick={() => handleDeleteContractor(c)}
                        >
                          Xóa Nhà Cung Cấp
                        </AppButton>
                      </div>
                    </MobileCard>
                  ))}
                </div>
              }
            />
          )}
        </div>
      )}

      <ContractDetailModal
        detail={selectedDetail}
        uploadingKind={uploadingKind}
        syncingDriveId={syncingDriveId}
        onClose={() => setSelectedDetail(null)}
        onOpenEdit={openEditContract}
        onAudit={handleAuditContract}
        onOpenShare={(contract, tab) => setShareModal({ contract, tab })}
        onVerifySignature={handleVerifySignature}
        onOpenSigning={openSigningModal}
        onToggleChecklist={toggleChecklist}
        onUploadDoc={handleUploadDoc}
        onDeleteDoc={handleDeleteDoc}
        onSyncDrive={handleSyncDrive}
        onPreview={openPreview}
      />

      <AuditReportModal
        auditModal={auditModal}
        onClose={() => setAuditModal(null)}
        onPreview={openPreview}
      />

      <SigningModal
        contract={signingContract}
        signMode={signMode}
        customSignDate={customSignDate}
        certificates={certificates}
        selectedCertId={selectedCertId}
        certPin={certPin}
        certLoading={certLoading}
        submitting={Boolean(signingContract && actionLoading === signingContract.id)}
        onChangeSignMode={setSignMode}
        onChangeCustomSignDate={setCustomSignDate}
        onChangeCertId={setSelectedCertId}
        onChangeCertPin={setCertPin}
        onConfirm={handleConfirmSignInut}
        onClose={() => setSigningContract(null)}
      />

      <SignatureVerifyModal
        contract={verifyingContract}
        loading={verifyLoading}
        result={verifyResult}
        onClose={() => setVerifyingContract(null)}
        onOpenShare={(contract) => setShareModal({ contract, tab: "signed" })}
      />

      <ShareContractModal
        shareModal={shareModal}
        copiedShare={copiedShare}
        onChangeTab={(tab) => {
          if (!shareModal) return;
          setShareModal({ ...shareModal, tab });
          setCopiedShare(false);
        }}
        onCopyUrl={(url) => {
          navigator.clipboard.writeText(url).then(() => {
            setCopiedShare(true);
            toast.success("Đã sao chép link vào bộ nhớ tạm!");
            setTimeout(() => setCopiedShare(false), 3000);
          });
        }}
        onShareNativeFallback={(shareMessage) => {
          navigator.clipboard.writeText(shareMessage).then(() => {
            toast.success("Đã sao chép nội dung và link gửi!");
          });
        }}
        onClose={() => setShareModal(null)}
      />

      <DriveSyncResultModal
        driveSyncModal={driveSyncModal}
        onClose={() => setDriveSyncModal(null)}
      />

      <EditContractModal
        contract={editingContract}
        onChange={setEditingContract}
        onAddItem={handleEditAddItem}
        onChangeItem={handleEditItemChange}
        onRemoveItem={handleEditRemoveItem}
        onSubmit={handleSaveEditContract}
        onClose={() => setEditingContract(null)}
      />

      <CreateContractModal
        open={showCreateModal}
        formData={formData}
        contractors={contractors}
        onChange={setFormData}
        onSelectContractor={handleSelectContractor}
        onAddItem={handleAddItem}
        onChangeItem={handleItemChange}
        onRemoveItem={handleRemoveItem}
        onSubmit={handleCreateContract}
        onClose={() => setShowCreateModal(false)}
      />

      <ContractorFormModal
        open={showContractorModal}
        editingContractor={editingContractor}
        form={contractorForm}
        onChange={setContractorForm}
        onOpenSmartPaste={() => {
          setSmartPasteTarget("contractor");
          setSmartPasteText("");
          setShowSmartPasteModal(true);
        }}
        onSubmit={handleSaveContractor}
        onClose={() => setShowContractorModal(false)}
      />

      <SmartPasteModal
        open={showSmartPasteModal}
        text={smartPasteText}
        onChangeText={setSmartPasteText}
        onApply={handleApplySmartPaste}
        onClose={() => setShowSmartPasteModal(false)}
      />

      <TaxSummaryModal
        data={taxSummaryData}
        onClose={() => setTaxSummaryData(null)}
      />

      <DocumentPreviewModal
        previewDoc={previewDoc}
        onClose={() => setPreviewDoc(null)}
      />
    </PageShell>
  );
}
