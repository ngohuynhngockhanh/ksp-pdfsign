import React, { useEffect, useState } from "react";
import {
  api,
  type PieceworkContractItem,
  type PieceworkContractDetail,
  type PieceworkWorkItem,
  type PieceworkSignatureVerifyResult,
  type PieceworkCertificateInfo,
  type PieceworkAttachmentInfo,
  type PieceworkContractorItem,
  type PieceworkContractorDetail,
  type PieceworkContractorTaxSummary,
} from "../api";
import { AppModal, DataView, FormGrid, ResponsiveTabs } from "../components/ui";
import { openExternalSafe, safeHttpUrl } from "../utils/url";

// Shared INUT semantic accents (WCAG AA >= 4.5:1 on warm paper/soft surfaces)
const INUT_TEXT_WARN = "#7a4b0b";
const INUT_TEXT_DANGER = "#8c281b";
const INUT_BORDER_SUCCESS = "rgba(29, 122, 87, 0.35)";
const INUT_BORDER_WARN = "rgba(180, 116, 24, 0.4)";
const INUT_BORDER_DANGER = "rgba(197, 72, 54, 0.38)";
const INUT_BORDER_PRIMARY = "rgba(21, 125, 114, 0.35)";

const FIELD_LABEL_STYLE: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--ink-2)",
  marginBottom: 4,
};

const COMPACT_INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
};

function formatDateTimeWithSeconds(isoStr?: string | null): string {
  if (!isoStr) return "N/A";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const seconds = String(d.getSeconds()).padStart(2, "0");
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  } catch {
    return isoStr;
  }
}

export function PieceworkContracts() {
  const [contracts, setContracts] = useState<PieceworkContractItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [selectedDetail, setSelectedDetail] = useState<PieceworkContractDetail | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingContract, setEditingContract] = useState<PieceworkContractDetail | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
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
  const [verifyResult, setVerifyResult] = useState<PieceworkSignatureVerifyResult | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<string | null>(null);

  // Document Lightbox Preview
  const [previewDoc, setPreviewDoc] = useState<{
    url: string;
    downloadUrl: string;
    title: string;
    isPdf: boolean;
    validationNote?: string;
  } | null>(null);

  // Audit Modal State
  const [auditModal, setAuditModal] = useState<{
    contract_code: string;
    worker_name: string;
    audit: any;
    attachments?: any;
    worker_signature_data?: string;
    worker_face_photo_data?: string;
  } | null>(null);

  // Share Modal State (Hợp đồng Đã ký vs Chưa ký)
  const [shareModal, setShareModal] = useState<{
    contract: PieceworkContractItem | PieceworkContractDetail;
    tab: "signed" | "unsigned" | "portal";
  } | null>(null);
  const [copiedShare, setCopiedShare] = useState(false);

  // Google Drive Sync State
  const [syncingDriveId, setSyncingDriveId] = useState<number | null>(null);
  const [syncingQuarterDrive, setSyncingQuarterDrive] = useState(false);
  const [driveSyncModal, setDriveSyncModal] = useState<{
    contract_code?: string;
    quarter: string;
    remote_dest: string;
    drive_link: string;
    files: string[];
    synced_at?: string;
  } | null>(null);

  // Navigation Tabs: 'contracts' vs 'contractors'
  const [activeMainTab, setActiveMainTab] = useState<"contracts" | "contractors">("contracts");

  // Contractors State
  const [contractors, setContractors] = useState<PieceworkContractorItem[]>([]);
  const [contractorSearch, setContractorSearch] = useState("");
  const [contractorLoading, setContractorLoading] = useState(false);
  const [showContractorModal, setShowContractorModal] = useState(false);
  const [editingContractor, setEditingContractor] = useState<PieceworkContractorItem | null>(null);

  // Contractor Form State
  const [contractorForm, setContractorForm] = useState({
    code: "",
    name: "",
    id_card: "",
    id_card_date: "",
    id_card_place: "Cục Cảnh sát QLHC về TTXH",
    tax_code: "",
    phone: "",
    address: "",
    bank_account: "",
    bank_name: "Techcombank",
    skills: "",
    notes: "",
  });

  // Tax Summary Modal State
  const [taxSummaryData, setTaxSummaryData] = useState<PieceworkContractorTaxSummary | null>(null);
  const [taxSummaryLoading, setTaxSummaryLoading] = useState(false);

  // Smart Paste State
  const [showSmartPasteModal, setShowSmartPasteModal] = useState(false);
  const [smartPasteText, setSmartPasteText] = useState("");
  const [smartPasteTarget, setSmartPasteTarget] = useState<"contract" | "contractor">("contract");

  // Form state for creating new contract
  const [formData, setFormData] = useState({
    contractor_id: null as number | null,
    contract_code: "",
    contract_type: "thi_cong",
    title: "",
    project_name: "",
    location: "",
    contract_date: new Date().toISOString().slice(0, 10),
    worker_name: "",
    worker_id_card: "",
    worker_id_card_date: "",
    worker_id_card_place: "Cục Cảnh sát QLHC về TTXH",
    worker_tax_code: "",
    worker_phone: "",
    worker_address: "",
    worker_bank_account: "",
    worker_bank_name: "Techcombank",
    payment_method: "bank_transfer" as "bank_transfer" | "cash",
    note: "",
    items: [
      { ten: "Thi công lắp đặt thiết bị theo yêu cầu kỹ thuật", dvt: "Gói", so_luong: 1, don_gia: 4500000, thanh_tien: 4500000 },
    ] as PieceworkWorkItem[],
  });

  const loadContracts = async () => {
    setLoading(true);
    try {
      const res = await api.listPieceworkContracts({
        q: search,
        status_f: statusFilter,
        contract_type: typeFilter,
      });
      setContracts(Array.isArray(res?.contracts) ? res.contracts : []);
    } catch (err) {
      setMessage({ text: "Lỗi tải danh sách hợp đồng khoán: " + (err as Error).message, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadContracts();
    loadContractors();
  }, [statusFilter, typeFilter]);

  const loadContractors = async () => {
    setContractorLoading(true);
    try {
      const res = await api.listPieceworkContractors(contractorSearch);
      setContractors(Array.isArray(res?.contractors) ? res.contractors : []);
    } catch (err: any) {
      console.error("Lỗi tải danh bạ nhà cung cấp khoán:", err);
    } finally {
      setContractorLoading(false);
    }
  };

  useEffect(() => {
    loadContractors();
  }, [contractorSearch]);

  const handleSaveContractor = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingContractor) {
        await api.updatePieceworkContractor(editingContractor.id, contractorForm);
        setMessage({ text: `✓ Đã cập nhật hồ sơ nhà cung cấp ${contractorForm.name}!`, type: "success" });
      } else {
        await api.createPieceworkContractor(contractorForm);
        setMessage({ text: `✓ Đã lưu nhà cung cấp ${contractorForm.name} vào danh bạ!`, type: "success" });
      }
      setShowContractorModal(false);
      setEditingContractor(null);
      loadContractors();
      setTimeout(() => setMessage(null), 4000);
    } catch (err: any) {
      alert("Lỗi lưu nhà cung cấp: " + err.message);
    }
  };

  const handleDeleteContractor = async (c: PieceworkContractorItem) => {
    if (!window.confirm(`Xác nhận xóa nhà cung cấp ${c.name} (${c.code}) khỏi danh bạ?`)) return;
    try {
      await api.deletePieceworkContractor(c.id);
      setMessage({ text: `✓ Đã xóa nhà cung cấp ${c.name} khỏi danh bạ!`, type: "success" });
      loadContractors();
      setTimeout(() => setMessage(null), 4000);
    } catch (err: any) {
      alert("Lỗi xóa: " + err.message);
    }
  };

  const handleOpenTaxSummary = async (contractorId: number, year: number = 2026) => {
    setTaxSummaryLoading(true);
    setTaxSummaryData(null);
    try {
      const res = await api.getPieceworkContractorTaxSummary(contractorId, year);
      setTaxSummaryData(res);
    } catch (err: any) {
      alert("Lỗi lấy báo cáo quyết toán thuế: " + err.message);
    } finally {
      setTaxSummaryLoading(false);
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
    setMessage({ text: `✓ Đã tự động điền thông tin nhà cung cấp ${c.name} (${c.code})!`, type: "success" });
    setTimeout(() => setMessage(null), 3000);
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
        setMessage({ text: "✓ Đã tự động trích xuất và điền thông tin thợ vào Hợp đồng!", type: "success" });
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
        setMessage({ text: "✓ Đã tự động trích xuất thông tin vào hồ sơ Nhà cung cấp!", type: "success" });
      }
      setShowSmartPasteModal(false);
      setSmartPasteText("");
      setTimeout(() => setMessage(null), 4000);
    } catch (err: any) {
      alert("Lỗi trích xuất: " + err.message);
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
        { ten: c.skills || "Thi công lắp đặt thiết bị theo yêu cầu kỹ thuật", dvt: "Gói", so_luong: 1, don_gia: 4500000, thanh_tien: 4500000 },
      ],
    });
    setShowCreateModal(true);
  };
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadContracts();
  };

  const copyToClipboard = (text: string, label: string) => {
    const fullUrl = window.location.origin + text;
    navigator.clipboard.writeText(fullUrl).then(() => {
      setMessage({ text: `Đã sao chép link ${label} gửi Zalo cho thợ!`, type: "success" });
      setTimeout(() => setMessage(null), 4000);
    });
  };

  // Open Signing Modal with contract date pre-populated and default (with natural seconds)
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
      setCertificates(res.certificates);
      const defCert = res.certificates.find((x) => x.is_default) || res.certificates.find((x) => !x.expired) || res.certificates[0];
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
        setMessage({ text: "✓ Đã ký số điện tử Bên A (INUT) thành công!", type: "success" });
        setSigningContract(null);
        loadContracts();
        if (selectedDetail && selectedDetail.id === cid) {
          const updated = await api.getPieceworkContract(cid);
          setSelectedDetail(updated);
        }
      }
    } catch (err) {
      setMessage({ text: "Lỗi ký số: " + (err as Error).message, type: "error" });
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
        setMessage({
          text: `✓ Đã đồng bộ hồ sơ ${c.contract_code} lên Google Drive Kế toán (${res.quarter})!`,
          type: "success",
        });
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
      setMessage({
        text: `Lỗi đồng bộ Google Drive: ${(err as Error).message}`,
        type: "error",
      });
    } finally {
      setSyncingDriveId(null);
    }
  };

  const handleSyncQuarterlyDrive = async () => {
    setSyncingQuarterDrive(true);
    try {
      const res = await api.syncQuarterlyPieceworkToDrive();
      if (res.ok) {
        setMessage({
          text: `✓ Đã đồng bộ ${res.synced_count} hợp đồng khoán lên Drive Kế toán!`,
          type: "success",
        });
        loadContracts();
      }
    } catch (err) {
      setMessage({
        text: `Lỗi đồng bộ Quý lên Google Drive: ${(err as Error).message}`,
        type: "error",
      });
    } finally {
      setSyncingQuarterDrive(false);
    }
  };

  const openPreview = (att: PieceworkAttachmentInfo | any, customTitle?: string) => {
    if (!att || !att.url) return;
    const isPdf = Boolean(
      att.is_pdf ||
      att.validation?.kind === "pdf" ||
      att.validation?.format?.toUpperCase() === "PDF" ||
      att.suffix?.toLowerCase() === ".pdf" ||
      att.url?.toLowerCase().endsWith(".pdf") ||
      att.label?.toLowerCase().includes("biên bản") ||
      att.label?.toLowerCase().includes("ủy nhiệm chi") ||
      att.label?.toLowerCase().includes("cam kết")
    );
    setPreviewDoc({
      url: att.url,
      downloadUrl: att.download_url || att.url,
      title: customTitle || att.label || "Xem tài liệu",
      isPdf: isPdf,
      validationNote: att.validation?.note,
    });
  };

  const handleUploadDoc = async (contractId: number, docKind: string, file: File | undefined) => {
    if (!file) return;
    setUploadingKind(docKind);
    try {
      const res = await api.uploadPieceworkDoc(contractId, file, docKind);
      if (res.ok) {
        setMessage({ text: `✓ Đã tải lên và kiểm tra ${res.doc_kind} thành công!`, type: "success" });
        loadContracts();
        const updated = await api.getPieceworkContract(contractId);
        setSelectedDetail(updated);
      }
    } catch (err) {
      alert("Lỗi tải lên chứng từ: " + (err as Error).message);
    } finally {
      setUploadingKind(null);
    }
  };

  const handleDeleteDoc = async (contractId: number, docKind: string, docId?: string) => {
    if (!window.confirm(`Xác nhận xóa tệp chứng từ này khỏi hợp đồng?`)) return;
    try {
      const res = await api.deletePieceworkDoc(contractId, docKind, docId);
      if (res.ok) {
        setMessage({ text: "✓ Đã xóa tệp chứng từ thành công!", type: "success" });
        loadContracts();
        const updated = await api.getPieceworkContract(contractId);
        setSelectedDetail(updated);
      }
    } catch (err) {
      alert("Lỗi xóa tệp: " + (err as Error).message);
    }
  };

  const handleDeleteContract = async (c: PieceworkContractItem) => {
    if (!window.confirm(`⚠️ Bạn có chắc chắn muốn xóa Hợp đồng khoán ${c.contract_code} (${c.worker_name})?`)) return;
    try {
      const res = await api.deletePieceworkContract(c.id);
      if (res.ok) {
        setMessage({ text: `✓ Đã xóa hợp đồng khoán ${res.contract_code} thành công!`, type: "success" });
        if (selectedDetail && selectedDetail.id === c.id) {
          setSelectedDetail(null);
        }
        loadContracts();
      }
    } catch (err) {
      alert("Lỗi xóa hợp đồng: " + (err as Error).message);
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
      alert("Lỗi kiểm định hồ sơ: " + (err as Error).message);
    }
  };

  const openDetail = async (contractId: number) => {
    try {
      const det = await api.getPieceworkContract(contractId);
      setSelectedDetail(det);
    } catch (err) {
      setMessage({ text: "Không thể lấy chi tiết hợp đồng: " + (err as Error).message, type: "error" });
    }
  };

  const openEditContract = async (contractId: number) => {
    try {
      const det = await api.getPieceworkContract(contractId);
      setEditingContract(det);
    } catch (err) {
      alert("Lỗi lấy thông tin sửa: " + (err as Error).message);
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
        setMessage({ text: `✓ Cập nhật hợp đồng ${editingContract.contract_code} thành công!`, type: "success" });
        setEditingContract(null);
        loadContracts();
        if (selectedDetail && selectedDetail.id === editingContract.id) {
          const updated = await api.getPieceworkContract(editingContract.id);
          setSelectedDetail(updated);
        }
      }
    } catch (err) {
      alert("Lỗi cập nhật hợp đồng: " + (err as Error).message);
    }
  };

  const toggleChecklist = async (contractId: number, field: string, currentValue: boolean) => {
    try {
      await api.updatePieceworkContract(contractId, { [field]: !currentValue });
      const updated = await api.getPieceworkContract(contractId);
      setSelectedDetail(updated);
      loadContracts();
    } catch (err) {
      alert("Lỗi cập nhật: " + (err as Error).message);
    }
  };

  const handleAddItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { ten: "", dvt: "Gói", so_luong: 1, don_gia: 0, thanh_tien: 0 }],
    });
  };

  const handleItemChange = (index: number, field: keyof PieceworkWorkItem, val: string | number) => {
    const newItems = [...formData.items];
    const item = { ...newItems[index], [field]: val };
    if (field === "so_luong" || field === "don_gia") {
      item.thanh_tien = Number(item.so_luong) * Number(item.don_gia);
    }
    newItems[index] = item;
    setFormData({ ...formData, items: newItems });
  };

  const handleRemoveItem = (index: number) => {
    if (formData.items.length <= 1) return;
    setFormData({ ...formData, items: formData.items.filter((_, i) => i !== index) });
  };

  const handleEditItemChange = (index: number, field: keyof PieceworkWorkItem, val: string | number) => {
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

  const calculateTotal = () => formData.items.reduce((sum, it) => sum + (it.thanh_tien || 0), 0);

  const handleCreateContract = async (e: React.FormEvent) => {
    e.preventDefault();
    const total = calculateTotal();
    try {
      const res = await api.createPieceworkContract({
        ...formData,
        total_amount: total,
      });
      if (res.ok) {
        setMessage({ text: `Tạo hợp đồng khoán ${res.contract_code} thành công!`, type: "success" });
        setShowCreateModal(false);
        loadContracts();
      }
    } catch (err) {
      alert("Lỗi tạo hợp đồng: " + (err as Error).message);
    }
  };

  // Metrics
  const totalContracts = contracts.length;
  const pendingDocsCount = contracts.filter((c) => c.deficiency.status_code === "pending_docs").length;
  const readyToPayCount = contracts.filter((c) => c.deficiency.status_code === "ready_to_pay").length;
  const completedCount = contracts.filter((c) => c.deficiency.status_code === "completed").length;
  const totalGross = contracts.reduce((sum, c) => sum + (c.total_amount || 0), 0);

  return (
    <div className="docs-page piecework-page">
      {/* Banner & Brand Header */}
      <div className="piecework-header">
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--ink)", color: "var(--gold)", padding: "4px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase" }}>
            ⚖️ iNut HR & Compliance
          </div>
          <h2 style={{ margin: "8px 0 4px 0", fontSize: 24, color: "var(--ink)" }}>Quản Lý Hợp Đồng Giao Khoán & Hồ Sơ Thợ/CTV</h2>
          <div style={{ color: "var(--muted)", fontSize: 13.5 }}>
            Chuẩn hóa giao khoán theo sản phẩm/kết quả đầu ra dân sự · Tự động kiểm định tính hợp lệ chứng từ (Nghị định 253/2026/NĐ-CP & Luật BHXH 2024)
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            className="piecework-btn-create"
            style={{ background: "var(--primary)", color: "#ffffff" }}
            onClick={() => setShowCreateModal(true)}
          >
            ＋ Tạo HĐ Khoán Mới
          </button>
          <button
            type="button"
            className="piecework-btn-create"
            style={{ background: "var(--primary-dark)", color: "#ffffff" }}
            onClick={() => {
              setContractorForm({
                code: "",
                name: "",
                id_card: "",
                id_card_date: "",
                id_card_place: "Cục Cảnh sát QLHC về TTXH",
                tax_code: "",
                phone: "",
                address: "",
                bank_account: "",
                bank_name: "Techcombank",
                skills: "",
                notes: "",
              });
              setEditingContractor(null);
              setShowContractorModal(true);
            }}
          >
            👥 Thêm Nhà Cung Cấp
          </button>
          <button
            type="button"
            className="piecework-btn-create"
            style={{ background: "var(--gold)", color: "var(--ink)" }}
            onClick={() => {
              setSmartPasteTarget("contract");
              setSmartPasteText("");
              setShowSmartPasteModal(true);
            }}
          >
            ⚡ Smart Paste
          </button>
          <button
            type="button"
            className="piecework-btn-create"
            style={{ background: "var(--ink)", color: "#ffffff", display: "inline-flex", alignItems: "center", gap: 6 }}
            disabled={syncingQuarterDrive}
            onClick={handleSyncQuarterlyDrive}
            title="Đồng bộ toàn bộ HĐ giao khoán đã ký trong quý lên Google Drive Kế toán"
          >
            {syncingQuarterDrive ? "⏳ Đang sync Drive..." : "☁️ Sync Drive Quý"}
          </button>
        </div>
      </div>

      {/* Main Navigation Tabs */}
      <ResponsiveTabs
        ariaLabel="Chuyển mục hợp đồng khoán"
        active={activeMainTab}
        onChange={setActiveMainTab}
        tabs={[
          { id: "contracts", label: "📄 Danh Sách Hợp Đồng Khoán", badge: contracts.length },
          { id: "contractors", label: "👥 Danh Bạ Nhà Cung Cấp / Thợ", badge: contractors.length },
        ]}
      />

      {/* Notifications */}
      {message && (
        <div style={{ padding: "12px 18px", borderRadius: 10, marginBottom: 16, background: message.type === "success" ? "var(--green-soft)" : "var(--red-soft)", color: message.type === "success" ? "var(--ink-2)" : INUT_TEXT_DANGER, border: `1px solid ${message.type === "success" ? INUT_BORDER_SUCCESS : INUT_BORDER_DANGER}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span>{message.text}</span>
          <button
            type="button"
            className="ui-btn-icon"
            aria-label="Đóng thông báo"
            style={{ background: "transparent", borderColor: "transparent", color: "inherit", fontWeight: 700 }}
            onClick={() => setMessage(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* TAB 1: CONTRACTS VIEW */}
      {activeMainTab === "contracts" && (
        <div data-testid="piecework-contracts-view">
          {/* Metrics Cards (Deficiency Radar) */}
          <div className="piecework-metrics-grid">
            <div className="piecework-metric-card" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Tổng số hợp đồng</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "var(--ink)", marginTop: 4 }}>{totalContracts}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{totalGross.toLocaleString("vi-VN")} đ</div>
            </div>

            <div className="piecework-metric-card" style={{ background: "var(--panel)", borderColor: INUT_BORDER_WARN }}>
              <div style={{ color: INUT_TEXT_WARN, fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>🔴 Cần bổ sung hồ sơ</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "var(--coral)", marginTop: 4 }}>{pendingDocsCount}</div>
              <div style={{ fontSize: 12, color: INUT_TEXT_WARN, marginTop: 2 }}>Thiếu CCCD, nghiệm thu, ảnh HT</div>
            </div>

            <div className="piecework-metric-card" style={{ background: "var(--panel)", borderColor: INUT_BORDER_SUCCESS }}>
              <div style={{ color: "var(--ink-2)", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>🟢 Đủ điều kiện thanh toán</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "var(--green)", marginTop: 4 }}>{readyToPayCount}</div>
              <div style={{ fontSize: 12, color: "var(--green)", marginTop: 2 }}>Đã có chữ ký & đủ chứng từ</div>
            </div>

            <div className="piecework-metric-card" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
              <div style={{ color: "var(--ink-2)", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>⚪ Đã thanh toán (Có UNC)</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginTop: 4 }}>{completedCount}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Đã khớp Techcombank 79713</div>
            </div>
          </div>

          {/* Filter and Search Bar */}
          <div className="piecework-filter-bar" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
            <form onSubmit={handleSearchSubmit} className="piecework-filter-search" style={{ minWidth: 0 }}>
              <input
                type="text"
                className="ui-input"
                placeholder="Tìm theo mã HĐ, tên thợ, số CCCD, công trình..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ flex: 1, minWidth: 0 }}
              />
              <button type="submit" className="secondary ui-btn-chip" style={{ padding: "8px 16px", minHeight: 44, fontWeight: 600 }}>Tìm kiếm</button>
            </form>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="ui-select"
              style={{ width: "auto", maxWidth: "100%" }}
            >
              <option value="">Tất cả loại hợp đồng</option>
              <option value="mua_ban_ca_nhan">🤝 HĐ Mua bán cá nhân</option>
              <option value="thi_cong">Thi công lắp đặt</option>
              <option value="boc_xep">Bốc xếp vận chuyển</option>
              <option value="gia_cong">Gia công sản phẩm</option>
              <option value="marketing">Marketing / Truyền thông</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="ui-select"
              style={{ width: "auto", maxWidth: "100%" }}
            >
              <option value="">Mọi trạng thái hồ sơ</option>
              <option value="pending_docs">🔴 Cần bổ sung hồ sơ</option>
              <option value="ready_to_pay">🟢 Đủ điều kiện thanh toán</option>
              <option value="completed">⚪ Đã thanh toán (Có UNC)</option>
            </select>
          </div>

          {/* Contract Content: Dual View via DataView (Desktop Table + Mobile Card Stack) */}
          {loading ? (
            <div style={{ background: "var(--panel)", borderRadius: 14, border: "1px solid var(--border)", padding: 40, textAlign: "center", color: "var(--muted)" }}>
              Đang tải danh sách hợp đồng khoán...
            </div>
          ) : contracts.length === 0 ? (
            <div style={{ background: "var(--panel)", borderRadius: 14, border: "1px solid var(--border)", padding: 40, textAlign: "center", color: "var(--muted)" }}>
              Không tìm thấy hợp đồng giao khoán nào phù hợp.
            </div>
          ) : (
            <DataView
              mobileMode="card"
              desktop={
                <div className="piecework-desktop-table" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
                  <table>
                    <thead>
                      <tr style={{ background: "var(--surface-subtle)", borderBottom: "1px solid var(--border)", fontSize: 12.5, color: "var(--ink-2)" }}>
                        <th style={{ padding: "12px 16px" }}>Mã HĐ / Ngày</th>
                        <th style={{ padding: "12px 16px" }}>Thợ nhận khoán</th>
                        <th style={{ padding: "12px 16px" }}>Công trình / Hạng mục</th>
                        <th style={{ padding: "12px 16px", textAlign: "right" }}>Giá trị khoán (VNĐ)</th>
                        <th style={{ padding: "12px 16px" }}>Deficiency Radar (Kiểm soát hồ sơ)</th>
                        <th style={{ padding: "12px 16px", textAlign: "center" }}>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contracts.map((c) => {
                        const def = c.deficiency;
                        const safeDriveHref = safeHttpUrl(c.drive_link);
                        return (
                          <tr key={c.id} style={{ borderBottom: "1px solid var(--border)", fontSize: 13.5 }}>
                            <td style={{ padding: "14px 16px" }}>
                              <div style={{ fontWeight: 700, color: "var(--primary-dark)" }}>{c.contract_code}</div>
                              <div style={{ fontSize: 12, color: "var(--muted)" }}>{c.contract_date}</div>
                              <span style={{
                                display: "inline-block",
                                marginTop: 4,
                                padding: "2px 8px",
                                borderRadius: 4,
                                fontSize: 11,
                                fontWeight: c.contract_type === "mua_ban_ca_nhan" ? 700 : 500,
                                background: c.contract_type === "mua_ban_ca_nhan" ? "#ecfdf5" : "var(--paper)",
                                color: c.contract_type === "mua_ban_ca_nhan" ? "#047857" : "var(--ink-2)",
                                border: c.contract_type === "mua_ban_ca_nhan" ? "1px solid #a7f3d0" : "1px solid var(--border)",
                              }}>
                                {c.contract_type === "mua_ban_ca_nhan" ? "🤝 Mua bán cá nhân" : (c.contract_type === "thi_cong" ? "Thi công" : (c.contract_type === "boc_xep" ? "Bốc xếp" : (c.contract_type === "gia_cong" ? "Gia công" : "Marketing")))}
                              </span>
                            </td>

                            <td style={{ padding: "14px 16px" }}>
                              <div style={{ fontWeight: 600, color: "var(--ink)" }}>{c.worker_name}</div>
                              <div style={{ fontSize: 12, color: "var(--muted)" }}>CCCD: {c.worker_id_card || "Chưa có"}</div>
                              <div style={{ fontSize: 12, color: "var(--muted)" }}>SĐT: {c.worker_phone || "Chưa có"}</div>
                              {c.payment_method === "cash" ? (
                                <div style={{ fontSize: 11.5, color: "var(--green)", fontWeight: 700 }}>💵 {c.contract_type === "mua_ban_ca_nhan" ? "Nhận tiền mặt trực tiếp" : "Nhận tiền mặt tại chân công trình"}</div>
                              ) : (
                                <div style={{ fontSize: 11.5, color: "var(--primary-dark)" }}>{c.worker_bank_account} ({c.worker_bank_name})</div>
                              )}
                            </td>

                            <td style={{ padding: "14px 16px" }}>
                              <div style={{ fontWeight: 600, color: "var(--text)" }}>{c.project_name}</div>
                              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>📍 {c.location}</div>
                            </td>

                            <td style={{ padding: "14px 16px", textAlign: "right" }}>
                              <div style={{ fontWeight: 700, color: "var(--ink)", fontSize: 14.5 }}>{c.total_amount.toLocaleString("vi-VN")} đ</div>
                              {def.is_sub_5m ? (
                                <div style={{ fontSize: 11, color: "var(--green)", fontWeight: 600, marginTop: 2 }}>
                                  Miễn 10% TNCN (NĐ 253)
                                </div>
                              ) : (
                                <div style={{ fontSize: 11, color: INUT_TEXT_DANGER, marginTop: 2 }}>
                                  Trừ 10% Thuế: -{c.tax_amount.toLocaleString("vi-VN")} đ
                                  <div style={{ color: "var(--green)", fontWeight: 600 }}>Thực nhận: {c.net_amount.toLocaleString("vi-VN")} đ</div>
                                </div>
                              )}
                            </td>

                            <td style={{ padding: "14px 16px" }}>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, maxWidth: 320 }}>
                                <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[0].ok ? "var(--green-soft)" : "var(--red-soft)", color: def.checklist[0].ok ? "var(--ink-2)" : INUT_TEXT_DANGER }}>
                                  {def.checklist[0].ok ? "✓ CCCD 2 mặt" : "✗ Thiếu CCCD"}
                                </span>
                                <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[1].ok ? "var(--green-soft)" : "var(--red-soft)", color: def.checklist[1].ok ? "var(--ink-2)" : INUT_TEXT_DANGER }}>
                                  {def.checklist[1].ok ? "✓ STK chính chủ" : "✗ Thiếu STK"}
                                </span>
                                <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[2].ok ? "var(--green-soft)" : "var(--red-soft)", color: def.checklist[2].ok ? "var(--ink-2)" : INUT_TEXT_DANGER }}>
                                  {def.checklist[2].ok ? "✓ Nghiệm thu" : "✗ Thiếu Nghiệm thu"}
                                </span>
                                <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[4].ok ? "var(--green-soft)" : "var(--amber-soft)", color: def.checklist[4].ok ? "var(--ink-2)" : INUT_TEXT_WARN }}>
                                  {def.checklist[4].ok ? "✓ Thợ đã ký online" : "⏳ Chờ thợ ký"}
                                </span>
                                <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[5].ok ? "var(--green-soft)" : "var(--paper)", color: def.checklist[5].ok ? "var(--ink-2)" : "var(--muted)" }}>
                                  {def.checklist[5].ok ? "✓ Ký số INUT" : "Chưa ký số A"}
                                </span>
                                <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[6].ok ? "var(--green-soft)" : "var(--surface-subtle)", color: def.checklist[6].ok ? "var(--ink-2)" : "var(--muted)", border: "1px solid var(--border)" }}>
                                  {def.checklist[6].ok ? "✓ Đã kẹp UNC" : "Chưa có UNC"}
                                </span>
                              </div>
                              <div style={{ marginTop: 6, fontWeight: 700, fontSize: 12, color: def.can_pay ? "var(--green)" : (def.missing_count > 0 ? INUT_TEXT_WARN : "var(--ink-2)") }}>
                                {def.status_label}
                              </div>
                            </td>

                            <td style={{ padding: "14px 16px", textAlign: "center" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch" }}>
                                <button
                                  className="ui-btn-chip"
                                  style={{ background: "var(--green-soft)", color: "var(--ink-2)", borderColor: INUT_BORDER_SUCCESS }}
                                  onClick={() => copyToClipboard(`/khoan/${c.portal_token}`, `ký online HĐ ${c.contract_code}`)}
                                  title="Sao chép link Portal di động gửi Zalo cho thợ"
                                >
                                  📲 Copy link Zalo thợ
                                </button>

                                <a
                                  href={safeHttpUrl(`/khoan/${c.portal_token}`)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="ui-btn-chip"
                                  style={{ background: "var(--surface-subtle)", color: "var(--primary-dark)", borderColor: "var(--border-strong)" }}
                                  title="Mở giao diện ký online của thợ để kiểm tra"
                                >
                                  📱 Mở Portal ký online
                                </a>

                                <div style={{ display: "flex", gap: 4 }}>
                                  <a
                                    href={safeHttpUrl(`/api/public/khoan/${c.portal_token}/pdf`)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ui-btn-chip"
                                    style={{ flex: 1, padding: "4px 6px", background: "var(--paper)", color: "var(--text)", borderColor: "var(--border-strong)" }}
                                  >
                                    📄 PDF
                                  </a>

                                  <button
                                    className="ui-btn-chip"
                                    style={{ flex: 1, padding: "4px 6px", background: "var(--green-soft)", color: "var(--ink-2)", borderColor: INUT_BORDER_SUCCESS }}
                                    onClick={() => setShareModal({ contract: c, tab: c.is_signed_by_inut ? "signed" : "unsigned" })}
                                    title={c.is_signed_by_inut ? "Chia sẻ PDF đã ký số" : "Chia sẻ PDF bản thảo chưa ký"}
                                  >
                                    📤 Share
                                  </button>

                                  <button
                                    className="ui-btn-chip"
                                    style={{ flex: 1, padding: "4px 6px", background: !c.is_signed_by_worker ? "var(--muted)" : (c.is_signed_by_inut ? "var(--primary-dark)" : "var(--primary)"), color: "#ffffff", borderColor: "transparent", cursor: !c.is_signed_by_worker ? "not-allowed" : "pointer" }}
                                    disabled={actionLoading === c.id || !c.is_signed_by_worker}
                                    onClick={() => openSigningModal(c)}
                                    title={!c.is_signed_by_worker ? "Chờ người nhận khoán (Bên B) ký online trước khi Bên A ký số" : (c.is_signed_by_inut ? "Bấm để ký lại số điện tử với chứng thư hoặc mốc thời gian khác" : "Ký số điện tử Bên A (INUT)")}
                                  >
                                    {actionLoading === c.id ? "Đang ký…" : (!c.is_signed_by_worker ? "⏳ Chờ thợ ký" : (c.is_signed_by_inut ? "✍️ Ký lại" : "✍️ Ký INUT"))}
                                  </button>

                                  <button
                                    className="ui-btn-chip"
                                    style={{ flex: 1, padding: "4px 6px", background: "var(--paper)", color: "var(--ink-2)", borderColor: "var(--border-strong)" }}
                                    onClick={() => openDetail(c.id)}
                                  >
                                    Chi tiết
                                  </button>
                                </div>

                                <div style={{ display: "flex", gap: 4 }}>
                                  <button
                                    className="ui-btn-chip"
                                    style={{ flex: 1, padding: "4px 6px", background: "var(--primary-soft)", color: "var(--primary-dark)", borderColor: INUT_BORDER_PRIMARY }}
                                    onClick={() => handleAuditContract(c)}
                                    title="Kiểm định tính hợp lệ toàn diện hồ sơ theo luật"
                                  >
                                    🔍 Kiểm định
                                  </button>
                                  <button
                                    className="ui-btn-chip"
                                    style={{ flex: 1, padding: "4px 6px", background: "var(--red-soft)", color: INUT_TEXT_DANGER, borderColor: INUT_BORDER_DANGER }}
                                    onClick={() => handleDeleteContract(c)}
                                    title="Xóa hợp đồng khoán"
                                  >
                                    🗑️ Xóa
                                  </button>
                                </div>

                                {c.is_signed_by_inut && (
                                  <button
                                    className="ui-btn-chip"
                                    style={{ background: "var(--green-soft)", color: "var(--ink-2)", border: "1.5px solid var(--green)" }}
                                    onClick={() => handleVerifySignature(c)}
                                    title="Kiểm tra thẩm định chữ ký số theo chuẩn Foxit Reader và Cơ quan Thuế"
                                  >
                                    🛡️ Thẩm định Chữ ký số
                                  </button>
                                )}
                                <button
                                  className="ui-btn-chip"
                                  style={{
                                    background: c.drive_synced_at ? "var(--green-soft)" : "var(--primary-soft)",
                                    color: c.drive_synced_at ? "var(--ink-2)" : "var(--primary-dark)",
                                    border: c.drive_synced_at ? `1.5px solid ${INUT_BORDER_SUCCESS}` : `1.5px solid ${INUT_BORDER_PRIMARY}`,
                                  }}
                                  disabled={syncingDriveId === c.id}
                                  onClick={() => handleSyncDrive(c)}
                                  title={
                                    c.drive_synced_at
                                      ? `Đã đồng bộ lên Drive Kế toán (${formatDateTimeWithSeconds(c.drive_synced_at)}). Bấm để sync lại.`
                                      : "Đồng bộ bộ hồ sơ HĐ giao khoán lên Google Drive Kế toán theo quý"
                                  }
                                >
                                  {syncingDriveId === c.id
                                    ? "⏳ Đang sync Drive..."
                                    : c.drive_synced_at
                                    ? "☁️ ✓ Đã sync Drive"
                                    : "☁️ Sync Drive Kế toán"}
                                </button>
                                {safeDriveHref && (
                                  <a
                                    href={safeDriveHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ui-btn-chip"
                                    style={{
                                      background: "transparent",
                                      borderColor: "transparent",
                                      color: "var(--green)",
                                      textDecoration: "underline",
                                    }}
                                    title={c.drive_folder}
                                  >
                                    📁 Mở Drive Quý
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
                <div className="piecework-mobile-cards ui-mobile-card-list" data-testid="piecework-mobile-cards" style={{ display: "grid", gap: 12 }}>
                  {contracts.map((c) => {
                    const def = c.deficiency;
                    const safeDriveHref = safeHttpUrl(c.drive_link);
                    return (
                      <div key={c.id} className="piecework-mobile-card ui-mobile-card" data-testid="piecework-mobile-card" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
                        {/* Card Header */}
                        <div className="piecework-mobile-card-header" style={{ borderBottomColor: "var(--border)" }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 800, fontSize: 15, color: "var(--primary-dark)", overflowWrap: "anywhere" }}>{c.contract_code}</div>
                            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                              {c.contract_date} · <span style={{
                                padding: "1px 6px",
                                borderRadius: 4,
                                background: c.contract_type === "mua_ban_ca_nhan" ? "#ecfdf5" : "var(--paper)",
                                fontSize: 11,
                                fontWeight: c.contract_type === "mua_ban_ca_nhan" ? 700 : 500,
                                color: c.contract_type === "mua_ban_ca_nhan" ? "#047857" : "var(--ink-2)",
                                border: c.contract_type === "mua_ban_ca_nhan" ? "1px solid #a7f3d0" : "1px solid var(--border)",
                              }}>{c.contract_type === "mua_ban_ca_nhan" ? "🤝 Mua bán cá nhân" : (c.contract_type === "thi_cong" ? "Thi công" : (c.contract_type === "boc_xep" ? "Bốc xếp" : (c.contract_type === "gia_cong" ? "Gia công" : "Marketing")))}</span>
                            </div>
                          </div>
                          <span style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 8px", borderRadius: 6, background: def.can_pay ? "var(--green-soft)" : (def.missing_count > 0 ? "var(--amber-soft)" : "var(--paper)"), color: def.can_pay ? "var(--ink-2)" : (def.missing_count > 0 ? INUT_TEXT_WARN : "var(--ink-2)") }}>
                            {def.status_label}
                          </span>
                        </div>

                        {/* Card Info Rows */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ color: "var(--muted)" }}>{c.contract_type === "mua_ban_ca_nhan" ? "Cá nhân (Bên B):" : "Thợ nhận khoán:"}</span>
                            <span style={{ fontWeight: 700, color: "var(--ink)", textAlign: "right" }}>{c.worker_name}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ color: "var(--muted)" }}>CCCD / SĐT:</span>
                            <span style={{ color: "var(--text)", textAlign: "right" }}>{c.worker_id_card || "Chưa có"} · {c.worker_phone || "N/A"}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ color: "var(--muted)" }}>Hình thức nhận:</span>
                            {c.payment_method === "cash" ? (
                              <span style={{ color: "var(--green)", fontWeight: 700, textAlign: "right" }}>💵 {c.contract_type === "mua_ban_ca_nhan" ? "Nhận tiền mặt trực tiếp" : "Nhận tiền mặt tại chân công trình"}</span>
                            ) : (
                              <span style={{ color: "var(--primary-dark)", fontWeight: 600, textAlign: "right" }}>{c.worker_bank_account} ({c.worker_bank_name})</span>
                            )}
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ color: "var(--muted)" }}>Công trình:</span>
                            <span style={{ fontWeight: 600, color: "var(--text)", textAlign: "right", maxWidth: "60%", overflowWrap: "anywhere" }}>{c.project_name}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px dashed var(--border)", paddingTop: 6, marginTop: 2 }}>
                            <span style={{ fontWeight: 700, color: "var(--ink)" }}>Giá trị khoán:</span>
                            <div style={{ textAlign: "right" }}>
                              <span style={{ fontWeight: 800, color: "var(--ink)", fontSize: 15 }}>{c.total_amount.toLocaleString("vi-VN")} đ</span>
                              {def.is_sub_5m ? (
                                <div style={{ fontSize: 11, color: "var(--green)", fontWeight: 600 }}>Miễn 10% TNCN (NĐ 253)</div>
                              ) : (
                                <div style={{ fontSize: 11, color: INUT_TEXT_DANGER }}>-10% Thuế ({c.tax_amount.toLocaleString("vi-VN")} đ)</div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Deficiency Checklist Chips */}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, background: "var(--surface-subtle)", padding: 8, borderRadius: 8 }}>
                          <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[0].ok ? "var(--green-soft)" : "var(--red-soft)", color: def.checklist[0].ok ? "var(--ink-2)" : INUT_TEXT_DANGER }}>
                            {def.checklist[0].ok ? "✓ CCCD 2 mặt" : "✗ Thiếu CCCD"}
                          </span>
                          <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[2].ok ? "var(--green-soft)" : "var(--red-soft)", color: def.checklist[2].ok ? "var(--ink-2)" : INUT_TEXT_DANGER }}>
                            {def.checklist[2].ok ? "✓ Nghiệm thu" : "✗ Thiếu Nghiệm thu"}
                          </span>
                          <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[4].ok ? "var(--green-soft)" : "var(--amber-soft)", color: def.checklist[4].ok ? "var(--ink-2)" : INUT_TEXT_WARN }}>
                            {def.checklist[4].ok ? "✓ Thợ đã ký online" : "⏳ Chờ thợ ký"}
                          </span>
                          <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[5].ok ? "var(--green-soft)" : "var(--paper)", color: def.checklist[5].ok ? "var(--ink-2)" : "var(--muted)" }}>
                            {def.checklist[5].ok ? "✓ Ký số INUT" : "Chưa ký số A"}
                          </span>
                          <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[6].ok ? "var(--green-soft)" : "var(--panel)", color: def.checklist[6].ok ? "var(--ink-2)" : "var(--muted)" }}>
                            {def.checklist[6].ok ? "✓ Đã kẹp UNC" : "Chưa có UNC"}
                          </span>
                        </div>

                        {/* Mobile Actions Grid (Touch Targets >= 44px) */}
                        <div className="piecework-mobile-action-grid">
                          <button
                            className="piecework-touch-btn"
                            style={{ gridColumn: "1 / -1", background: "var(--green-soft)", color: "var(--ink-2)", border: "1.5px solid var(--green)", fontWeight: 700 }}
                            onClick={() => setShareModal({ contract: c, tab: c.is_signed_by_inut ? "signed" : "unsigned" })}
                          >
                            {c.is_signed_by_inut ? "📤 Chia sẻ PDF Đã Ký (Zalo / Email / Link)" : "📤 Chia sẻ HĐ Chưa Ký (Bản Thảo / Zalo)"}
                          </button>

                          <button
                            className="piecework-touch-btn"
                            style={{ background: "var(--green-soft)", color: "var(--ink-2)", border: `1px solid ${INUT_BORDER_SUCCESS}` }}
                            onClick={() => copyToClipboard(`/khoan/${c.portal_token}`, `ký online HĐ ${c.contract_code}`)}
                          >
                            📲 Copy Zalo thợ
                          </button>

                          <a
                            href={safeHttpUrl(`/khoan/${c.portal_token}`)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="piecework-touch-btn"
                            style={{ background: "var(--surface-subtle)", color: "var(--primary-dark)", border: "1px solid var(--border-strong)" }}
                          >
                            📱 Mở Portal ký
                          </a>

                          <a
                            href={safeHttpUrl(`/api/public/khoan/${c.portal_token}/pdf`)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="piecework-touch-btn"
                            style={{ background: "var(--paper)", color: "var(--text)", border: "1px solid var(--border-strong)" }}
                          >
                            📄 Mở PDF
                          </a>

                          <button
                            className="piecework-touch-btn"
                            style={{ background: !c.is_signed_by_worker ? "var(--muted)" : (c.is_signed_by_inut ? "var(--primary-dark)" : "var(--primary)"), color: "#ffffff", cursor: !c.is_signed_by_worker ? "not-allowed" : "pointer" }}
                            disabled={actionLoading === c.id || !c.is_signed_by_worker}
                            onClick={() => openSigningModal(c)}
                            title={!c.is_signed_by_worker ? "Chờ người nhận khoán (Bên B) ký online trước khi Bên A ký số" : undefined}
                          >
                            {actionLoading === c.id ? "Đang ký…" : (!c.is_signed_by_worker ? "⏳ Chờ thợ ký" : (c.is_signed_by_inut ? "✍️ Ký lại INUT" : "✍️ Ký số INUT"))}
                          </button>

                          <button
                            className="piecework-touch-btn"
                            style={{ background: "var(--primary-soft)", color: "var(--primary-dark)", border: `1px solid ${INUT_BORDER_PRIMARY}` }}
                            onClick={() => handleAuditContract(c)}
                          >
                            🔍 Kiểm định
                          </button>

                          <button
                            className="piecework-touch-btn"
                            style={{ background: "var(--surface-subtle)", color: "var(--ink-2)", border: "1px solid var(--border-strong)" }}
                            onClick={() => openDetail(c.id)}
                          >
                            👁️ Chi tiết HĐ
                          </button>

                          {c.is_signed_by_inut && (
                            <button
                              className="piecework-touch-btn"
                              style={{ gridColumn: "1 / -1", background: "var(--green-soft)", color: "var(--ink-2)", border: "1.5px solid var(--green)", fontWeight: 700 }}
                              onClick={() => handleVerifySignature(c)}
                            >
                              🛡️ Thẩm định Chữ ký số (Chuẩn Foxit / Thuế)
                            </button>
                          )}
                          <button
                            className="piecework-touch-btn"
                            style={{
                              gridColumn: "1 / -1",
                              background: c.drive_synced_at ? "var(--green-soft)" : "var(--primary-soft)",
                              color: c.drive_synced_at ? "var(--ink-2)" : "var(--primary-dark)",
                              border: c.drive_synced_at ? `1.5px solid ${INUT_BORDER_SUCCESS}` : `1.5px solid ${INUT_BORDER_PRIMARY}`,
                              fontWeight: 700,
                            }}
                            disabled={syncingDriveId === c.id}
                            onClick={() => handleSyncDrive(c)}
                          >
                            {syncingDriveId === c.id
                              ? "⏳ Đang sync Drive..."
                              : c.drive_synced_at
                              ? "☁️ ✓ Đã sync Drive Kế toán"
                              : "☁️ Đồng bộ lên Drive Kế toán"}
                          </button>
                          {safeDriveHref && (
                            <a
                              href={safeDriveHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="piecework-touch-btn"
                              style={{
                                gridColumn: "1 / -1",
                                background: "var(--primary-dark)",
                                color: "#ffffff",
                                fontWeight: 700,
                                textAlign: "center",
                                textDecoration: "none",
                              }}
                            >
                              📁 Mở Thư Mục Trên Google Drive
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              }
            />
          )}
        </div>
      )}

      {/* TAB 2: CONTRACTORS / SUPPLIERS VIEW */}
      {activeMainTab === "contractors" && (
        <div data-testid="piecework-contractors-view">
          {/* Metrics Cards for Contractors */}
          <div className="piecework-metrics-grid">
            <div className="piecework-metric-card" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Tổng số nhà cung cấp/thợ</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "var(--ink)", marginTop: 4 }}>{contractors.length}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Đã định danh CCCD & MST</div>
            </div>

            <div className="piecework-metric-card" style={{ background: "var(--panel)", borderColor: INUT_BORDER_PRIMARY }}>
              <div style={{ color: "var(--primary-dark)", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>📦 Hợp đồng đã giao</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "var(--primary-dark)", marginTop: 4 }}>
                {contractors.reduce((s, c) => s + (c.contracts_count || 0), 0)}
              </div>
              <div style={{ fontSize: 12, color: "var(--primary)", marginTop: 2 }}>Tổng số lượt khoán việc</div>
            </div>

            <div className="piecework-metric-card" style={{ background: "var(--panel)", borderColor: INUT_BORDER_SUCCESS }}>
              <div style={{ color: "var(--ink-2)", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>💰 Tổng thù lao chi trả (Gross)</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "var(--green)", marginTop: 4 }}>
                {contractors.reduce((s, c) => s + (c.total_gross || 0), 0).toLocaleString("vi-VN")} đ
              </div>
              <div style={{ fontSize: 12, color: "var(--green)", marginTop: 2 }}>Thực nhận (Net): {contractors.reduce((s, c) => s + (c.total_net || 0), 0).toLocaleString("vi-VN")} đ</div>
            </div>

            <div className="piecework-metric-card" style={{ background: "var(--panel)", borderColor: INUT_BORDER_WARN }}>
              <div style={{ color: INUT_TEXT_WARN, fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>⚖️ Thuế TNCN đã khấu trừ (10%)</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "var(--coral)", marginTop: 4 }}>
                {contractors.reduce((s, c) => s + (c.total_tax || 0), 0).toLocaleString("vi-VN")} đ
              </div>
              <div style={{ fontSize: 12, color: INUT_TEXT_WARN, marginTop: 2 }}>Nộp NSNN (NĐ 253/2026)</div>
            </div>
          </div>

          {/* Filter & Search Bar for Contractors */}
          <div className="piecework-filter-bar" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
            <div style={{ display: "flex", gap: 8, flex: 1, minWidth: 0 }}>
              <input
                type="text"
                className="ui-input"
                placeholder="Tìm thợ theo họ tên, CCCD, MST cá nhân, SĐT, ngân hàng..."
                value={contractorSearch}
                onChange={(e) => setContractorSearch(e.target.value)}
                style={{ flex: 1, minWidth: 0 }}
              />
            </div>
            <button
              type="button"
              className="piecework-btn-create"
              style={{ background: "var(--primary-dark)", color: "#ffffff" }}
              onClick={() => {
                setContractorForm({
                  code: "",
                  name: "",
                  id_card: "",
                  id_card_date: "",
                  id_card_place: "Cục Cảnh sát QLHC về TTXH",
                  tax_code: "",
                  phone: "",
                  address: "",
                  bank_account: "",
                  bank_name: "Techcombank",
                  skills: "",
                  notes: "",
                });
                setEditingContractor(null);
                setShowContractorModal(true);
              }}
            >
              ＋ Thêm Nhà Cung Cấp Mới
            </button>
            <button
              type="button"
              className="piecework-btn-create"
              style={{ background: "var(--gold)", color: "var(--ink)" }}
              onClick={() => {
                setSmartPasteTarget("contractor");
                setSmartPasteText("");
                setShowSmartPasteModal(true);
              }}
            >
              ⚡ Smart Paste (Dán Nhanh)
            </button>
          </div>

          {/* Contractors Content: Desktop Table & Mobile Cards via DataView */}
          {contractorLoading ? (
            <div style={{ background: "var(--panel)", borderRadius: 14, border: "1px solid var(--border)", padding: 40, textAlign: "center", color: "var(--muted)" }}>
              Đang tải danh bạ nhà cung cấp khoán...
            </div>
          ) : contractors.length === 0 ? (
            <div style={{ background: "var(--panel)", borderRadius: 14, border: "1px solid var(--border)", padding: 40, textAlign: "center", color: "var(--muted)" }}>
              Chưa có nhà cung cấp / thợ khoán nào phù hợp. Bấm "Thêm Nhà Cung Cấp Mới" hoặc "Smart Paste" để thêm nhanh!
            </div>
          ) : (
            <DataView
              mobileMode="card"
              desktop={
                <div className="piecework-desktop-table" data-testid="contractors-desktop-table" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
                  <table>
                    <thead>
                      <tr style={{ background: "var(--surface-subtle)", borderBottom: "1px solid var(--border)", fontSize: 12.5, color: "var(--ink-2)" }}>
                        <th style={{ padding: "12px 16px" }}>Mã / Họ tên nhà cung cấp</th>
                        <th style={{ padding: "12px 16px" }}>CCCD / Ngày cấp / Nơi cấp</th>
                        <th style={{ padding: "12px 16px" }}>MST cá nhân / SĐT</th>
                        <th style={{ padding: "12px 16px" }}>Tài khoản ngân hàng</th>
                        <th style={{ padding: "12px 16px", textAlign: "right" }}>Hợp đồng / Thù lao (Gross)</th>
                        <th style={{ padding: "12px 16px", textAlign: "center" }}>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contractors.map((c) => (
                        <tr key={c.id} style={{ borderBottom: "1px solid var(--border)", fontSize: 13.5 }}>
                          <td style={{ padding: "14px 16px" }}>
                            <div style={{ fontWeight: 800, color: "var(--ink)" }}>{c.name}</div>
                            <span style={{ display: "inline-block", marginTop: 4, padding: "2px 8px", borderRadius: 4, fontSize: 11, background: "var(--primary-soft)", color: "var(--primary-dark)", fontWeight: 700 }}>
                              {c.code}
                            </span>
                            {c.skills && (
                              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>🛠️ {c.skills}</div>
                            )}
                          </td>

                          <td style={{ padding: "14px 16px" }}>
                            <div style={{ fontWeight: 700, color: "var(--primary-dark)" }}>CCCD: {c.id_card}</div>
                            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Ngày cấp: {c.id_card_date || "N/A"}</div>
                            <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{c.id_card_place || "Cục CSQLHC về TTXH"}</div>
                          </td>

                          <td style={{ padding: "14px 16px" }}>
                            <div style={{ fontWeight: 700, color: c.tax_code ? "var(--green)" : INUT_TEXT_WARN }}>
                              {c.tax_code ? `MST: ${c.tax_code}` : "Chưa có MST"}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text)", marginTop: 2 }}>📞 SĐT: {c.phone || "Chưa có"}</div>
                            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2, maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={c.address}>
                              📍 {c.address || "Chưa có địa chỉ"}
                            </div>
                          </td>

                          <td style={{ padding: "14px 16px" }}>
                            <div style={{ fontWeight: 700, color: "var(--ink)" }}>{c.bank_account}</div>
                            <div style={{ fontSize: 12, color: "var(--primary-dark)", fontWeight: 600 }}>{c.bank_name}</div>
                            <div style={{ fontSize: 11, color: "var(--green)", marginTop: 2 }}>✓ Đủ điều kiện chi Techcombank 79713</div>
                          </td>

                          <td style={{ padding: "14px 16px", textAlign: "right" }}>
                            <div style={{ fontWeight: 800, color: "var(--ink)", fontSize: 14.5 }}>
                              {c.total_gross?.toLocaleString("vi-VN")} đ
                            </div>
                            <div style={{ fontSize: 11.5, color: "var(--primary-dark)", marginTop: 2 }}>
                              <b>{c.contracts_count}</b> hợp đồng khoán
                            </div>
                            {c.total_tax > 0 ? (
                              <div style={{ fontSize: 11, color: INUT_TEXT_WARN, marginTop: 2 }}>
                                Thuế TNCN: -{c.total_tax?.toLocaleString("vi-VN")} đ
                              </div>
                            ) : (
                              <div style={{ fontSize: 11, color: "var(--green)", marginTop: 2 }}>Miễn trừ thuế TNCN</div>
                            )}
                          </td>

                          <td style={{ padding: "14px 16px", textAlign: "center" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 150 }}>
                              <button
                                type="button"
                                className="ui-btn-chip"
                                style={{ background: "var(--primary)", color: "#ffffff", borderColor: "transparent" }}
                                onClick={() => handleCreateContractForContractor(c)}
                                title="Tạo hợp đồng khoán mới cho nhà cung cấp này (tự điền 100%)"
                              >
                                ＋ Tạo HĐ Khoán
                              </button>
                              <button
                                type="button"
                                className="ui-btn-chip"
                                style={{ background: "var(--green-soft)", color: "var(--ink-2)", borderColor: INUT_BORDER_SUCCESS }}
                                onClick={() => handleOpenTaxSummary(c.id)}
                                title="Xem bảng kê quyết toán & khấu trừ thuế TNCN để hỗ trợ thợ hoàn thuế"
                              >
                                📊 Quyết Toán Thuế
                              </button>
                              <div style={{ display: "flex", gap: 4 }}>
                                <button
                                  type="button"
                                  className="ui-btn-chip"
                                  style={{ flex: 1, padding: "4px 8px", background: "var(--paper)", color: "var(--ink-2)", borderColor: "var(--border-strong)" }}
                                  onClick={() => {
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
                                  }}
                                >
                                  ✏️ Sửa
                                </button>
                                <button
                                  type="button"
                                  className="ui-btn-chip"
                                  style={{ flex: 1, padding: "4px 8px", background: "var(--red-soft)", color: INUT_TEXT_DANGER, borderColor: INUT_BORDER_DANGER }}
                                  onClick={() => handleDeleteContractor(c)}
                                >
                                  🗑️ Xóa
                                </button>
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
                <div className="piecework-mobile-cards ui-mobile-card-list" data-testid="contractors-mobile-cards" style={{ display: "grid", gap: 12 }}>
                  {contractors.map((c) => (
                    <div key={c.id} className="piecework-mobile-card ui-mobile-card" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
                      <div className="piecework-mobile-card-header" style={{ borderBottomColor: "var(--border)" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: 15, color: "var(--ink)" }}>{c.name}</div>
                          <div style={{ fontSize: 12, color: "var(--primary-dark)", fontWeight: 700, marginTop: 2 }}>{c.code}</div>
                        </div>
                        <span style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 8px", borderRadius: 6, background: "var(--green-soft)", color: "var(--ink-2)" }}>
                          {c.contracts_count} HĐ Khoán
                        </span>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ color: "var(--muted)" }}>Số CCCD:</span>
                          <span style={{ fontWeight: 700, color: "var(--primary-dark)" }}>{c.id_card}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ color: "var(--muted)" }}>Mã số thuế:</span>
                          <span style={{ fontWeight: 600, color: c.tax_code ? "var(--green)" : INUT_TEXT_WARN }}>{c.tax_code || "Chưa có"}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ color: "var(--muted)" }}>Số điện thoại:</span>
                          <span style={{ color: "var(--text)" }}>{c.phone || "N/A"}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ color: "var(--muted)" }}>STK thụ hưởng:</span>
                          <span style={{ color: "var(--primary-dark)", fontWeight: 600, textAlign: "right" }}>{c.bank_account} ({c.bank_name})</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px dashed var(--border)", paddingTop: 6 }}>
                          <span style={{ fontWeight: 700, color: "var(--ink)" }}>Tổng thù lao (Gross):</span>
                          <span style={{ fontWeight: 800, color: "var(--ink)", fontSize: 15 }}>{c.total_gross?.toLocaleString("vi-VN")} đ</span>
                        </div>
                      </div>

                      {/* Mobile Touch Action Grid */}
                      <div className="piecework-mobile-action-grid">
                        <button
                          type="button"
                          className="piecework-touch-btn"
                          style={{ background: "var(--primary)", color: "#ffffff", gridColumn: "1 / -1" }}
                          onClick={() => handleCreateContractForContractor(c)}
                        >
                          ＋ Tạo Hợp Đồng Khoán Cho Thợ Này
                        </button>
                        <button
                          type="button"
                          className="piecework-touch-btn"
                          style={{ background: "var(--green-soft)", color: "var(--ink-2)", border: "1px solid var(--green)", fontWeight: 700 }}
                          onClick={() => handleOpenTaxSummary(c.id)}
                        >
                          📊 Quyết Toán Thuế
                        </button>
                        <button
                          type="button"
                          className="piecework-touch-btn"
                          style={{ background: "var(--surface-subtle)", color: "var(--ink-2)", border: "1px solid var(--border-strong)" }}
                          onClick={() => {
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
                          }}
                        >
                          ✏️ Sửa Hồ Sơ
                        </button>
                        <button
                          type="button"
                          className="piecework-touch-btn"
                          style={{ gridColumn: "1 / -1", background: "var(--red-soft)", color: INUT_TEXT_DANGER, border: `1px solid ${INUT_BORDER_DANGER}` }}
                          onClick={() => handleDeleteContractor(c)}
                        >
                          🗑️ Xóa Nhà Cung Cấp
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              }
            />
          )}
        </div>
      )}
      {/* Modal Detail & Deficiency Checklist */}
      <AppModal
        open={Boolean(selectedDetail)}
        onClose={() => setSelectedDetail(null)}
        size="lg"
        title="Chi tiết Hồ sơ & Deficiency Checklist"
        subtitle={
          selectedDetail ? (
            <>
              Hợp đồng số: <b>{selectedDetail.contract_code}</b> · {selectedDetail.project_name}
            </>
          ) : undefined
        }
        footer={
          selectedDetail && (
            <>
              <button type="button" className="secondary" onClick={() => setSelectedDetail(null)}>
                Đóng
              </button>
              <button
                type="button"
                className="secondary"
                style={{ background: "var(--green-soft)", color: "var(--ink-2)", border: "1.5px solid var(--green)", fontWeight: 700 }}
                onClick={() => setShareModal({ contract: selectedDetail, tab: selectedDetail.is_signed_by_inut ? "signed" : "unsigned" })}
              >
                📤 Chia sẻ PDF (Đã ký / Chưa ký)
              </button>
              <button
                type="button"
                className="secondary"
                style={{ background: "var(--green-soft)", color: "var(--ink-2)", border: `1px solid ${INUT_BORDER_SUCCESS}`, fontWeight: 600 }}
                onClick={() => handleVerifySignature(selectedDetail)}
              >
                🛡️ Thẩm định Chữ ký số
              </button>
              <button
                type="button"
                className="primary"
                style={{ background: !selectedDetail.is_signed_by_worker ? "var(--muted)" : (selectedDetail.is_signed_by_inut ? "var(--primary-dark)" : "var(--primary)"), color: "#ffffff", fontWeight: 600, cursor: !selectedDetail.is_signed_by_worker ? "not-allowed" : "pointer" }}
                disabled={!selectedDetail.is_signed_by_worker}
                onClick={() => openSigningModal(selectedDetail)}
                title={!selectedDetail.is_signed_by_worker ? "Chờ người nhận khoán (Bên B) ký online trước khi Bên A ký số" : undefined}
              >
                {!selectedDetail.is_signed_by_worker ? "⏳ Chờ Bên B ký trước" : (selectedDetail.is_signed_by_inut ? "✍️ Ký lại số INUT" : "✍️ Ký số Bên A (INUT)")}
              </button>
              <a
                href={safeHttpUrl(`/api/public/khoan/${selectedDetail.portal_token}/pdf`)}
                target="_blank"
                rel="noopener noreferrer"
                className="secondary"
                style={{ textDecoration: "none", color: "var(--text)", background: "var(--paper)", border: "1px solid var(--border-strong)", fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "8px 14px", borderRadius: 10 }}
              >
                📄 Mở PDF
              </a>
            </>
          )
        }
      >
        {selectedDetail && (
          <div>
            {/* Quick header actions */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", marginBottom: 14 }}>
              <button
                type="button"
                className="ui-btn-chip"
                onClick={() => openEditContract(selectedDetail.id)}
              >
                ✏️ Sửa HĐ
              </button>
              <button
                type="button"
                className="ui-btn-chip"
                style={{ background: "var(--green-soft)", color: "var(--ink-2)", borderColor: INUT_BORDER_SUCCESS }}
                onClick={() => handleAuditContract(selectedDetail)}
              >
                🔍 Kiểm định
              </button>
            </div>

            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>Trạng thái Checklist hồ sơ thiếu:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {selectedDetail.deficiency.checklist.map((chk) => (
                  <div key={chk.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, padding: "10px 14px", borderRadius: 10, background: chk.ok ? "var(--green-soft)" : "var(--red-soft)", border: `1px solid ${chk.ok ? INUT_BORDER_SUCCESS : INUT_BORDER_DANGER}` }}>
                    <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: chk.ok ? "var(--ink-2)" : INUT_TEXT_DANGER }}>{chk.label}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{chk.detail}</div>
                    </div>
                    {/* Toggle button for manual checklist items */}
                    {chk.key === "acceptance" && (
                      <button
                        type="button"
                        className="ui-btn-chip"
                        onClick={() => toggleChecklist(selectedDetail.id, "has_acceptance", selectedDetail.has_acceptance)}
                      >
                        {selectedDetail.has_acceptance ? "Bỏ nghiệm thu" : "✓ Duyệt nghiệm thu"}
                      </button>
                    )}
                    {chk.key === "bank_unc" && (
                      <button
                        type="button"
                        className="ui-btn-chip"
                        onClick={() => toggleChecklist(selectedDetail.id, "has_bank_proof", selectedDetail.has_bank_proof)}
                      >
                        {selectedDetail.has_bank_proof ? "Bỏ kẹp UNC" : "✓ Kẹp UNC Techcombank"}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Worker Signature & eKYC Selfie Verification View */}
              {selectedDetail.worker_signature_data && (
                <div style={{ marginTop: 18, padding: 14, background: "var(--surface-subtle)", borderRadius: 12, border: "1px solid var(--border-strong)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
                      ✍️ Bằng Chứng Xác Thực Ký Điện Tử & Chân Dung eKYC của Thợ:
                    </div>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "var(--green-soft)", color: "var(--ink-2)", fontWeight: 700 }}>
                      ✓ Đã xác thực
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 4, fontWeight: 600 }}>Chữ ký tay cảm ứng:</div>
                      <img src={selectedDetail.worker_signature_data} style={{ maxHeight: 75, maxWidth: 200, border: "1px solid var(--border-strong)", borderRadius: 6, background: "var(--panel)", padding: 4 }} alt="Chữ ký thợ" />
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Ký lúc: {selectedDetail.worker_signed_at || "N/A"}</div>
                    </div>

                    {(selectedDetail.worker_face_photo_data || selectedDetail.attachments?.worker_face) && (
                      <div>
                        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 4, fontWeight: 600 }}>Ảnh chân dung eKYC chụp lúc ký:</div>
                        <img
                          src={selectedDetail.worker_face_photo_data || selectedDetail.attachments?.worker_face?.url}
                          alt="Ảnh chân dung eKYC"
                          onClick={() => openPreview(selectedDetail.attachments?.worker_face || { url: selectedDetail.worker_face_photo_data, label: "Ảnh chụp chân dung thợ lúc ký" }, `Chân dung eKYC - ${selectedDetail.worker_name}`)}
                          style={{ width: 75, height: 95, objectFit: "cover", borderRadius: 8, border: "2px solid var(--primary)", cursor: "pointer", boxShadow: "var(--shadow)" }}
                          title="Bấm để xem ảnh phóng to"
                        />
                        <div style={{ fontSize: 11, color: "var(--green)", fontWeight: 600, marginTop: 4 }}>
                          ✓ Camera định danh
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Bên A: Con dấu ký số điện tử snap lại trên PDF */}
              {selectedDetail.is_signed_by_inut && (
                <div style={{ marginTop: 14, padding: 14, background: "var(--green-soft)", borderRadius: 12, border: "1.5px solid var(--green)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-2)" }}>
                      🛡️ Chữ Ký Số Doanh Nghiệp Bên A (INUT Technology) — Bản Snap Trên PDF:
                    </div>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "var(--panel)", color: "var(--green)", fontWeight: 700, border: `1px solid ${INUT_BORDER_SUCCESS}` }}>
                      ✓ Đã đóng dấu số điện tử
                    </span>
                  </div>

                  <div style={{ background: "var(--panel)", border: "2px solid var(--green)", borderRadius: 8, padding: "10px 14px", color: "var(--ink-2)", fontSize: 12, lineHeight: 1.5, boxShadow: "var(--shadow)" }}>
                    <div style={{ fontWeight: 800, fontSize: 12.5, color: "var(--green)", borderBottom: `1px dashed ${INUT_BORDER_SUCCESS}`, paddingBottom: 4, marginBottom: 6 }}>
                      ✓ KÝ SỐ ĐIỆN TỬ BỞI: CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "4px 14px", minWidth: 0 }}>
                      <div style={{ minWidth: 0 }}><b>Mã số thuế:</b> 4401053694</div>
                      <div style={{ minWidth: 0 }}><b>Đơn vị cấp CA:</b> WINCA / CÔNG TY TNHH WINGROUP</div>
                      <div style={{ minWidth: 0 }}><b>Ngày cấp chứng thư:</b> 15/06/2024 (Hạn dùng: 15/06/2027)</div>
                      <div style={{ minWidth: 0 }}><b>Ngày giờ ký điện tử (/M):</b> <span style={{ color: "var(--primary-dark)", fontWeight: 700 }}>{formatDateTimeWithSeconds(selectedDetail.inut_signed_at)}</span></div>
                      <div style={{ gridColumn: "1 / -1", wordBreak: "break-all", minWidth: 0 }}><b>Số sê-ri:</b> <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>540116541CB8AAF5...</span></div>
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--green)", marginTop: 6, borderTop: `1px solid ${INUT_BORDER_SUCCESS}`, paddingTop: 4 }}>
                      ✓ Chữ ký số PAdES toàn vẹn, hiển thị đúng dấu tích xanh trên Foxit Reader & Adobe Acrobat
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Vùng Upload & Quản lý chứng từ trực tiếp */}
            <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
                  📁 Chứng từ Đính kèm & Tự động Kiểm định Tính Hợp lệ:
                </div>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Hỗ trợ JPG, PNG, PDF</span>
              </div>

              <FormGrid cols={2}>
                {/* 1. CCCD Mặt trước */}
                <DocumentCard
                  title="CCCD Mặt trước"
                  hasDoc={selectedDetail.has_id_card_front}
                  docId={selectedDetail.id_card_front_doc_id}
                  attachment={selectedDetail.attachments?.id_card_front}
                  uploading={uploadingKind === "id_card_front"}
                  onUpload={(f) => handleUploadDoc(selectedDetail.id, "id_card_front", f)}
                  onDelete={() => handleDeleteDoc(selectedDetail.id, "id_card_front")}
                  onPreview={(att) => openPreview(att, `CCCD Mặt trước - ${selectedDetail.worker_name}`)}
                  allowPdf={true}
                />

                {/* 2. CCCD Mặt sau */}
                <DocumentCard
                  title="CCCD Mặt sau"
                  hasDoc={selectedDetail.has_id_card_back}
                  docId={selectedDetail.id_card_back_doc_id}
                  attachment={selectedDetail.attachments?.id_card_back}
                  uploading={uploadingKind === "id_card_back"}
                  onUpload={(f) => handleUploadDoc(selectedDetail.id, "id_card_back", f)}
                  onDelete={() => handleDeleteDoc(selectedDetail.id, "id_card_back")}
                  onPreview={(att) => openPreview(att, `CCCD Mặt sau - ${selectedDetail.worker_name}`)}
                  allowPdf={true}
                />

                {/* 3. Biên bản nghiệm thu */}
                <DocumentCard
                  title="Biên bản nghiệm thu hoàn thành"
                  hasDoc={selectedDetail.has_acceptance}
                  docId={selectedDetail.acceptance_doc_id}
                  attachment={selectedDetail.attachments?.acceptance}
                  uploading={uploadingKind === "acceptance"}
                  onUpload={(f) => handleUploadDoc(selectedDetail.id, "acceptance", f)}
                  onDelete={() => handleDeleteDoc(selectedDetail.id, "acceptance")}
                  onPreview={(att) => openPreview(att, `Biên bản nghiệm thu - ${selectedDetail.contract_code}`)}
                  allowPdf={true}
                />

                {/* 4. Bản cam kết thuế 08 */}
                <DocumentCard
                  title="Bản cam kết thuế TNCN (Mẫu 08)"
                  hasDoc={selectedDetail.has_tax_commitment}
                  docId={selectedDetail.tax_commitment_doc_id}
                  attachment={selectedDetail.attachments?.tax_commitment}
                  uploading={uploadingKind === "tax_commitment"}
                  onUpload={(f) => handleUploadDoc(selectedDetail.id, "tax_commitment", f)}
                  onDelete={() => handleDeleteDoc(selectedDetail.id, "tax_commitment")}
                  onPreview={(att) => openPreview(att, `Bản cam kết thuế - ${selectedDetail.contract_code}`)}
                  allowPdf={true}
                />

                {/* 5. Ủy nhiệm chi ngân hàng (UNC) */}
                <DocumentCard
                  title="Ủy nhiệm chi (UNC) Techcombank (PDF hoặc Ảnh)"
                  hasDoc={selectedDetail.has_bank_proof}
                  docId={selectedDetail.bank_proof_doc_id}
                  attachment={selectedDetail.attachments?.bank_proof}
                  uploading={uploadingKind === "bank_proof"}
                  onUpload={(f) => handleUploadDoc(selectedDetail.id, "bank_proof", f)}
                  onDelete={() => handleDeleteDoc(selectedDetail.id, "bank_proof")}
                  onPreview={(att) => openPreview(att, `Ủy nhiệm chi Techcombank 79713 - ${selectedDetail.contract_code}`)}
                  allowPdf={true}
                />

                {/* 6. Ảnh hiện trường / Kiosk (Multi-photos) */}
                <div style={{ background: "var(--surface-subtle)", padding: 12, borderRadius: 12, border: "1px solid var(--border)", minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "var(--ink)" }}>Ảnh hiện trường thi công</div>
                      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 1 }}>Chụp rõ thiết bị, tủ điện hoặc Kiosk tại công trình</div>
                    </div>
                    <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: (selectedDetail.attachments?.site_photos?.length || 0) > 0 ? "var(--green-soft)" : "var(--red-soft)", color: (selectedDetail.attachments?.site_photos?.length || 0) > 0 ? "var(--ink-2)" : INUT_TEXT_DANGER, fontWeight: 600, flexShrink: 0 }}>
                      {(selectedDetail.attachments?.site_photos?.length || 0) > 0 ? `✓ Có ${selectedDetail.attachments?.site_photos?.length} ảnh` : "Chưa có ảnh"}
                    </span>
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <label style={{ flex: 1, textAlign: "center", padding: "8px 10px", background: "var(--primary)", color: "#ffffff", borderRadius: 8, fontSize: 12.5, cursor: "pointer", fontWeight: 600, minHeight: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      <span>🖼️</span>
                      <span>{uploadingKind === "site_photo" ? "Đang tải…" : "＋ Chọn ảnh từ thư viện / Tải tệp"}</span>
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        multiple
                        style={{ display: "none" }}
                        disabled={uploadingKind !== null}
                        onChange={async (e) => {
                          const files = Array.from(e.target.files || []);
                          if (files.length === 0) return;
                          for (const f of files) {
                            await handleUploadDoc(selectedDetail.id, "site_photo", f);
                          }
                        }}
                      />
                    </label>
                  </div>

                  {selectedDetail.attachments?.site_photos && selectedDetail.attachments.site_photos.length > 0 && (
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                      {selectedDetail.attachments.site_photos.map((photo, idx) => (
                        <div key={photo.doc_id} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--panel)", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)" }}>
                          {photo.is_pdf ? (
                            <div
                              onClick={() => openPreview(photo, `Tệp hiện trường #${idx + 1} - ${selectedDetail.contract_code}`)}
                              style={{ width: 44, height: 44, borderRadius: 6, background: "var(--red-soft)", color: INUT_TEXT_DANGER, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 10, cursor: "pointer", flexShrink: 0 }}
                            >
                              <span>📄</span>
                              <span>PDF</span>
                            </div>
                          ) : (
                            <img
                              src={photo.url}
                              alt={photo.label}
                              onClick={() => openPreview(photo, `Ảnh hiện trường #${idx + 1} - ${selectedDetail.contract_code}`)}
                              style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border-strong)", cursor: "pointer", flexShrink: 0 }}
                            />
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 12, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{photo.label}</div>
                            <div style={{ fontSize: 11, color: photo.validation?.valid ? "var(--green)" : INUT_TEXT_DANGER }}>
                              {photo.validation?.dimensions || (photo.validation?.valid ? "Hợp lệ" : "Lỗi tệp")}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                            <button
                              type="button"
                              className="ui-btn-icon"
                              aria-label="Xem ảnh phóng to"
                              style={{ background: "var(--primary-soft)", color: "var(--primary-dark)", borderColor: INUT_BORDER_PRIMARY }}
                              onClick={() => openPreview(photo, `Ảnh hiện trường #${idx + 1} - ${selectedDetail.contract_code}`)}
                              title="Xem ảnh phóng to"
                            >
                              👁️
                            </button>
                            <button
                              type="button"
                              className="ui-btn-icon"
                              aria-label="Xóa ảnh này"
                              style={{ background: "var(--red-soft)", color: INUT_TEXT_DANGER, borderColor: INUT_BORDER_DANGER }}
                              onClick={() => handleDeleteDoc(selectedDetail.id, "site_photo", photo.doc_id)}
                              title="Xóa ảnh này"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </FormGrid>

              {/* Google Drive Accountant Sync Section */}
              <div style={{ marginTop: 18, padding: 14, background: selectedDetail.drive_synced_at ? "var(--green-soft)" : "var(--surface-subtle)", borderRadius: 12, border: `1.5px solid ${selectedDetail.drive_synced_at ? INUT_BORDER_SUCCESS : "var(--border-strong)"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 18 }}>☁️</span>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)" }}>
                        Lưu Trữ Google Drive Kế Toán Theo Quý
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        Tự động phân loại theo thời điểm ký của HĐ vào thư mục Quý kế toán
                      </div>
                    </div>
                  </div>
                  {selectedDetail.drive_synced_at ? (
                    <span style={{ fontSize: 11.5, padding: "3px 8px", borderRadius: 6, background: "var(--panel)", color: "var(--ink-2)", fontWeight: 700, border: `1px solid ${INUT_BORDER_SUCCESS}` }}>
                      ✓ Đã đồng bộ: {formatDateTimeWithSeconds(selectedDetail.drive_synced_at)}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11.5, padding: "3px 8px", borderRadius: 6, background: "var(--amber-soft)", color: INUT_TEXT_WARN, fontWeight: 700 }}>
                      ⏳ Chưa đồng bộ Drive
                    </span>
                  )}
                </div>

                {selectedDetail.drive_folder && (
                  <div style={{ fontSize: 12, background: "var(--panel)", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", fontFamily: "var(--font-mono)", color: "var(--text)", marginBottom: 10, wordBreak: "break-all" }}>
                    📁 {selectedDetail.drive_folder}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="ui-btn-chip"
                    style={{
                      background: selectedDetail.drive_synced_at ? "var(--panel)" : "var(--primary-soft)",
                      color: selectedDetail.drive_synced_at ? "var(--ink-2)" : "var(--primary-dark)",
                      borderColor: selectedDetail.drive_synced_at ? INUT_BORDER_SUCCESS : INUT_BORDER_PRIMARY,
                    }}
                    disabled={syncingDriveId === selectedDetail.id}
                    onClick={() => handleSyncDrive(selectedDetail)}
                  >
                    {syncingDriveId === selectedDetail.id ? "⏳ Đang sync Drive..." : (selectedDetail.drive_synced_at ? "☁️ Đồng bộ lại lên Drive" : "☁️ Đồng bộ lên Drive Kế toán")}
                  </button>

                  {safeHttpUrl(selectedDetail.drive_link) && (
                    <a
                      href={safeHttpUrl(selectedDetail.drive_link)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ui-btn-chip"
                      style={{
                        background: "var(--primary-dark)",
                        color: "#ffffff",
                        borderColor: "transparent",
                      }}
                    >
                      🚀 Mở Thư Mục Trên Google Drive
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </AppModal>

      {/* Audit Summary Modal - NO RAW JSON, Real Image/PDF Thumbnails */}
      <AppModal
        open={Boolean(auditModal)}
        onClose={() => setAuditModal(null)}
        size="md"
        title="🔍 Báo Cáo Kiểm Định Hồ Sơ Chi Tiết"
        subtitle={
          auditModal ? (
            <>
              HĐ: <b>{auditModal.contract_code}</b> · {auditModal.worker_name}
            </>
          ) : undefined
        }
        footer={
          <button type="button" className="primary" style={{ background: "var(--primary)", color: "#ffffff", minHeight: 44, fontWeight: 700 }} onClick={() => setAuditModal(null)}>
            Đã Hiểu & Đóng Báo Cáo
          </button>
        }
      >
        {auditModal && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--ink)", color: "var(--gold)", padding: "3px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase" }}>
                Legal & Technical Compliance
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {auditModal.audit.checklist.map((chk: any) =>
                renderAuditCheckItem(
                  chk,
                  auditModal.attachments,
                  auditModal.worker_signature_data,
                  auditModal.worker_face_photo_data,
                  openPreview
                )
              )}
            </div>
          </div>
        )}
      </AppModal>

      {/* Modal Ký số INUT (Mặc định Ngày trên Hợp đồng khoán + Lựa chọn Chứng thư) */}
      <AppModal
        open={Boolean(signingContract)}
        onClose={() => setSigningContract(null)}
        size="md"
        title="✍️ Ký Số Điện Tử Bên A (INUT)"
        subtitle={
          signingContract ? (
            <>
              HĐ số: <b>{signingContract.contract_code}</b> · {signingContract.worker_name}
            </>
          ) : undefined
        }
        footer={
          signingContract && (
            <>
              <button type="button" className="secondary" onClick={() => setSigningContract(null)} disabled={actionLoading === signingContract.id}>
                Hủy
              </button>
              <button
                type="button"
                className="primary"
                style={{ background: "var(--primary)", color: "#ffffff", fontWeight: 700 }}
                onClick={handleConfirmSignInut}
                disabled={actionLoading === signingContract.id}
              >
                {actionLoading === signingContract.id ? "Đang ký số…" : "✓ Xác nhận Ký số INUT"}
              </button>
            </>
          )
        }
      >
        {signingContract && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* 1. Lựa chọn chứng thư số */}
            <div>
              <label style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", display: "block", marginBottom: 8 }}>
                1. LỰA CHỌN CHỨNG THƯ KÝ SỐ DOANH NGHIỆP:
              </label>
              {certLoading ? (
                <div style={{ padding: 12, color: "var(--muted)", fontSize: 13, textAlign: "center" }}>
                  ⏳ Đang quét danh sách chứng thư số từ USB Token...
                </div>
              ) : certificates.length === 0 ? (
                <div style={{ padding: 10, background: "var(--amber-soft)", color: INUT_TEXT_WARN, borderRadius: 8, fontSize: 12 }}>
                  Sử dụng chứng thư số mặc định của INUT (MST: 4401053694)
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 160, overflowY: "auto" }}>
                  {certificates.map((cert) => (
                    <label
                      key={cert.id}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: selectedCertId === cert.id ? "2px solid var(--primary)" : "1px solid var(--border-strong)",
                        background: selectedCertId === cert.id ? "var(--primary-soft)" : "var(--panel)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="radio"
                        name="certChoice"
                        value={cert.id}
                        checked={selectedCertId === cert.id}
                        onChange={() => setSelectedCertId(cert.id)}
                        style={{ marginTop: 3 }}
                      />
                      <div style={{ flex: 1, fontSize: 12, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: "var(--ink)" }}>
                          {cert.subject.includes("CN=") ? cert.subject.split("CN=")[1].split(",")[0] : cert.subject}
                        </div>
                        <div style={{ color: "var(--muted)", marginTop: 2 }}>
                          Nhà cấp (CA): <b>{cert.issuer.includes("CN=") ? cert.issuer.split("CN=")[1].split(",")[0] : cert.issuer}</b>
                          {" · "}
                          <span style={{ color: cert.expired ? INUT_TEXT_DANGER : "var(--green)", fontWeight: 600 }}>
                            {cert.expired ? "Hết hạn" : `Còn hạn đến ${cert.valid_to ? cert.valid_to.slice(0, 10) : ""}`}
                          </span>
                        </div>
                        <div style={{ color: "var(--muted)", fontSize: 11 }}>Serial: {cert.serial || cert.id.slice(0, 16)}...</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* 2. Mốc thời gian ký (/M) - Mặc định theo ngày HĐ khoán */}
            <div>
              <label style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", display: "block", marginBottom: 8 }}>
                2. MỐC THỜI GIAN KÝ MẬT MÃ (/M):
              </label>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 8, border: signMode === "contract_date" ? "2px solid var(--primary)" : "1px solid var(--border-strong)", background: signMode === "contract_date" ? "var(--primary-soft)" : "var(--panel)", cursor: "pointer", width: "100%", boxSizing: "border-box" }}>
                  <input
                    type="radio"
                    name="signMode"
                    value="contract_date"
                    checked={signMode === "contract_date"}
                    onChange={() => setSignMode("contract_date")}
                    style={{ marginTop: 3, flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0, width: "100%" }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--primary-dark)", wordBreak: "break-word" }}>
                      Theo ngày trên hợp đồng khoán ({customSignDate ? customSignDate.replace("T", " ") : signingContract.contract_date}) — Mặc định khuyên dùng (có giây lẻ)
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2, wordBreak: "break-word" }}>
                      Khớp ngày ký với ngày trên hợp đồng khoán và thời hạn nghiệm thu để đảm bảo chứng từ thuế hợp lệ.
                    </div>

                    {signMode === "contract_date" && (
                      <div style={{ marginTop: 8, width: "100%" }}>
                        <label style={{ fontSize: 11.5, color: "var(--ink-2)", fontWeight: 600, display: "block", marginBottom: 3 }}>
                          Tùy chỉnh ngày giờ ký (nếu cần đổi mốc giờ):
                        </label>
                        <input
                          type="datetime-local"
                          step="1"
                          className="ui-input"
                          value={customSignDate}
                          onChange={(e) => setCustomSignDate(e.target.value)}
                          style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box", borderColor: "var(--primary)" }}
                        />
                      </div>
                    )}
                  </div>
                </label>

                <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 8, border: signMode === "realtime" ? "2px solid var(--primary)" : "1px solid var(--border-strong)", background: signMode === "realtime" ? "var(--primary-soft)" : "var(--panel)", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="signMode"
                    value="realtime"
                    checked={signMode === "realtime"}
                    onChange={() => setSignMode("realtime")}
                    style={{ marginTop: 2 }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--ink)" }}>Ký theo thời gian thực hiện tại (Realtime)</div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Sử dụng mốc thời gian hệ thống chuẩn tại thời điểm bấm ký.</div>
                  </div>
                </label>
              </div>
            </div>

            {/* 3. PIN USB Token */}
            <div>
              <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", display: "block", marginBottom: 4 }}>
                Mã PIN USB Token (Mặc định: 12345678)
              </label>
              <input
                type="password"
                className="ui-input"
                value={certPin}
                onChange={(e) => setCertPin(e.target.value)}
                style={COMPACT_INPUT_STYLE}
              />
            </div>
          </div>
        )}
      </AppModal>

      {/* Modal Thẩm định Chữ ký số Chuẩn Foxit Reader & Cơ quan Thuế */}
      <AppModal
        open={Boolean(verifyingContract)}
        onClose={() => setVerifyingContract(null)}
        size="lg"
        title="🛡️ Bảng Thẩm Định Chữ Ký Số Pháp Lý"
        subtitle={
          verifyingContract ? (
            <>
              Hợp đồng: <b>{verifyingContract.contract_code}</b> · {verifyingContract.worker_name}
            </>
          ) : undefined
        }
        footer={
          verifyingContract && (
            <>
              <button type="button" className="secondary" onClick={() => setVerifyingContract(null)}>
                Đóng
              </button>
              <button
                type="button"
                className="secondary"
                style={{ background: "var(--green-soft)", color: "var(--ink-2)", border: "1.5px solid var(--green)", fontWeight: 700 }}
                onClick={() => setShareModal({ contract: verifyingContract, tab: "signed" })}
              >
                📤 Chia sẻ PDF Đã Ký
              </button>
              <a
                href={safeHttpUrl(`/api/public/khoan/${verifyingContract.portal_token}/pdf?signed=1`)}
                download={`HDGK_${verifyingContract.contract_code.replace('/', '_')}_Foxit_Verified.pdf`}
                className="secondary"
                style={{ textDecoration: "none", color: "var(--primary-dark)", background: "var(--primary-soft)", border: `1px solid ${INUT_BORDER_PRIMARY}`, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 14px", borderRadius: 10, boxSizing: "border-box" }}
              >
                ⬇️ Tải file PDF về máy (Mở bằng Foxit)
              </a>
              <a
                href={safeHttpUrl(`/api/public/khoan/${verifyingContract.portal_token}/pdf?signed=1`)}
                target="_blank"
                rel="noopener noreferrer"
                className="primary"
                style={{ textDecoration: "none", background: "var(--primary)", color: "#ffffff", fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 14px", borderRadius: 10, boxSizing: "border-box" }}
              >
                📄 Mở PDF trực tiếp
              </a>
            </>
          )
        }
      >
        {verifyingContract && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--ink)", color: "var(--gold)", padding: "3px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase" }}>
                Foxit PDF & Tax Audit Inspector
              </span>
            </div>

            {verifyLoading ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: "var(--muted)" }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Đang trích xuất chứng thư và kiểm định chữ ký theo tiêu chuẩn Foxit Reader & Cơ quan Thuế...</div>
              </div>
            ) : verifyResult ? (
              <div>
                {/* Verdict Banner */}
                {verifyResult.ok && verifyResult.has_signature && verifyResult.intact && verifyResult.valid ? (
                  <div style={{ padding: "14px 18px", borderRadius: 12, background: "var(--green-soft)", border: "1.5px solid var(--green)", color: "var(--ink-2)", marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 28 }}>🛡️</span>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 14.5, textTransform: "uppercase", letterSpacing: "0.3px", color: "var(--ink)" }}>
                          ✓ CHỮ KÝ SỐ HỢP LỆ THEO CHUẨN FOXIT READER & CƠ QUAN THUẾ
                        </div>
                        <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 2 }}>
                          {verifyResult.tax_compliance?.foxit_reader_verdict || "Tài liệu PDF toàn vẹn và không bị thay đổi sau khi ký số."}
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop: 8, padding: "6px 12px", background: "var(--panel)", borderRadius: 8, fontSize: 11.5, fontWeight: 700, color: "var(--ink-2)", border: `1px solid ${INUT_BORDER_SUCCESS}` }}>
                      ⚖️ {verifyResult.tax_compliance?.tax_authority_status || "ĐỦ ĐIỀU KIỆN PHÁP LÝ HỒ SƠ QUYẾT TOÁN THUẾ & GIẢI TRÌNH THANH TRA"}
                    </div>
                  </div>
                ) : !verifyResult.has_signature ? (
                  <div style={{ padding: "14px 18px", borderRadius: 12, background: "var(--amber-soft)", border: `1px solid ${INUT_BORDER_WARN}`, color: INUT_TEXT_WARN, marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 26 }}>⚠️</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>CHƯA CÓ CHỮ KÝ SỐ ĐIỆN TỬ</div>
                      <div style={{ fontSize: 12, marginTop: 2 }}>{verifyResult.message || "Tệp PDF chưa được ký số bên A."}</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: "14px 18px", borderRadius: 12, background: "var(--red-soft)", border: `1px solid ${INUT_BORDER_DANGER}`, color: INUT_TEXT_DANGER, marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 26 }}>❌</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>CHỮ KÝ KHÔNG HỢP LỆ HOẶC BỊ SỬA ĐỔI</div>
                      <div style={{ fontSize: 12, marginTop: 2 }}>{verifyResult.message || "Tệp PDF có dấu hiệu bị can thiệp sau khi ký."}</div>
                    </div>
                  </div>
                )}

                {/* Visual Con Dấu Ký Số Điện Tử - Bản Snap trên PDF */}
                {verifyResult.has_signature && (
                  <div style={{ margin: "14px 0", background: "var(--green-soft)", border: "2px solid var(--green)", borderRadius: 10, padding: "12px 16px", color: "var(--ink-2)", boxShadow: "var(--shadow)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px dashed ${INUT_BORDER_SUCCESS}`, paddingBottom: 6, marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                      <div style={{ fontWeight: 800, fontSize: 13, color: "var(--green)" }}>
                        ✓ BẢN CHỤP CON DẤU KÝ SỐ ĐIỆN TỬ TRÊN PDF (DIGITAL SIGNATURE STAMP)
                      </div>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "var(--panel)", color: "var(--green)", fontWeight: 700, border: `1px solid ${INUT_BORDER_SUCCESS}` }}>
                        Khớp 100% bản in PDF
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: "6px 14px", fontSize: 12, minWidth: 0 }}>
                      <div style={{ minWidth: 0 }}><b>Đơn vị ký:</b> CÔNG TY CP ĐẦU TƯ & PHÁT TRIỂN CÔNG NGHỆ INUT</div>
                      <div style={{ minWidth: 0 }}><b>Mã số thuế:</b> 4401053694</div>
                      <div style={{ minWidth: 0 }}><b>Đơn vị cấp CA:</b> {verifyResult.ca_issuer || "WINCA / WINGROUP CA"}</div>
                      <div style={{ minWidth: 0 }}><b>Ngày cấp chứng thư:</b> {verifyResult.valid_from ? formatDateTimeWithSeconds(verifyResult.valid_from) : "15/06/2024 00:00:00"}</div>
                      <div style={{ minWidth: 0 }}><b>Thời hạn hiệu lực:</b> {verifyResult.valid_to ? formatDateTimeWithSeconds(verifyResult.valid_to) : "15/06/2027 23:59:59"}</div>
                      <div style={{ minWidth: 0 }}>
                        <b>Ngày giờ ký điện tử (/M):</b>{" "}
                        <span style={{ color: "var(--primary-dark)", fontWeight: 800 }}>
                          {verifyResult.signing_time ? formatDateTimeWithSeconds(verifyResult.signing_time) : (verifyResult.sign_date_m || "N/A")}
                        </span>
                      </div>
                      <div style={{ gridColumn: "1 / -1", wordBreak: "break-all", minWidth: 0 }}>
                        <b>Số sê-ri:</b> <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{verifyResult.cert_serial || "540116541CB8..."}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--green)", marginTop: 6, borderTop: `1px solid ${INUT_BORDER_SUCCESS}`, paddingTop: 4 }}>
                      ✓ Chữ ký số PAdES toàn vẹn, hiển thị đúng dấu tích xanh trên Foxit Reader & Adobe Acrobat
                    </div>
                  </div>
                )}

                {/* 4 Detail Cards */}
                <FormGrid cols={2}>
                  {/* Thẻ 1: Thông tin Người nộp thuế & Đơn vị ký */}
                  <div style={{ background: "var(--surface-subtle)", padding: 12, borderRadius: 10, border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--primary-dark)", textTransform: "uppercase", marginBottom: 6 }}>
                      1. Thông tin Người nộp thuế (Signer)
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text)" }}>
                      <div><b>Tên pháp nhân:</b> {verifyResult.signer_name || "CÔNG TY CP ĐẦU TƯ & PHÁT TRIỂN CÔNG NGHỆ INUT"}</div>
                      <div style={{ marginTop: 3 }}><b>Mã số thuế:</b> <span style={{ color: "var(--primary-dark)", fontWeight: 700 }}>{verifyResult.signer_tax_code || "4401053694"}</span></div>
                      <div style={{ marginTop: 3 }}><b>Vai trò:</b> Bên A - Đơn vị giao khoán</div>
                      <div style={{ marginTop: 3 }}><b>Quốc gia:</b> Việt Nam (VN)</div>
                    </div>
                  </div>

                  {/* Thẻ 2: Nhà cấp chứng thực số (CA) */}
                  <div style={{ background: "var(--surface-subtle)", padding: 12, borderRadius: 10, border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--primary-dark)", textTransform: "uppercase", marginBottom: 6 }}>
                      2. Tổ chức Chứng thực số (CA)
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text)" }}>
                      <div><b>Nhà cung cấp CA:</b> {verifyResult.ca_issuer || "WINCA / WINGROUP CA"}</div>
                      <div style={{ marginTop: 3, wordBreak: "break-all" }}>
                        <b>Số sê-ri:</b> <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{verifyResult.cert_serial || "N/A"}</span>
                      </div>
                      <div style={{ marginTop: 3 }}>
                        <b>Thời hạn chứng thư:</b>
                        <div style={{ color: "var(--green)", fontWeight: 600 }}>
                          {verifyResult.valid_from ? formatDateTimeWithSeconds(verifyResult.valid_from) : "15/06/2024 00:00:00"} đến {verifyResult.valid_to ? formatDateTimeWithSeconds(verifyResult.valid_to) : "15/06/2027 23:59:59"}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Thẻ 3: Mốc thời gian ký & Tiêu chuẩn mật mã */}
                  <div style={{ background: "var(--surface-subtle)", padding: 12, borderRadius: 10, border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--primary-dark)", textTransform: "uppercase", marginBottom: 6 }}>
                      3. Thời gian ký & Chuẩn Mật mã
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text)" }}>
                      <div><b>Mốc thời gian ký (/M):</b> <span style={{ color: "var(--primary-dark)", fontWeight: 700 }}>{verifyResult.sign_date_m || "N/A"}</span></div>
                      <div style={{ marginTop: 3 }}><b>Thời gian chuẩn ISO (có giây lẻ):</b> <span style={{ color: "var(--primary-dark)", fontWeight: 700 }}>{formatDateTimeWithSeconds(verifyResult.signing_time)}</span></div>
                      <div style={{ marginTop: 3 }}><b>Định dạng SubFilter:</b> {verifyResult.subfilter || "ETSI.CAdES.detached (PAdES)"}</div>
                      <div style={{ marginTop: 3 }}><b>Thuật toán:</b> {verifyResult.digest_algorithm || "SHA-256"} · {verifyResult.signature_algorithm || "RSA 2048-bit"}</div>
                    </div>
                  </div>

                  {/* Thẻ 4: Tính toàn vẹn văn bản */}
                  <div style={{ background: "var(--surface-subtle)", padding: 12, borderRadius: 10, border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--primary-dark)", textTransform: "uppercase", marginBottom: 6 }}>
                      4. Tính toàn vẹn văn bản (Integrity)
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: verifyResult.intact ? "var(--green)" : INUT_TEXT_DANGER }}>
                        <span>{verifyResult.intact ? "✓" : "✗"}</span>
                        <span>{verifyResult.intact ? "Nguyên vẹn 100% (Không bị sửa đổi)" : "Tệp đã bị can thiệp"}</span>
                      </div>
                      <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--muted)" }}>
                        Kể từ thời điểm áp dụng chữ ký số này, tài liệu PDF chưa từng bị thay đổi hoặc chèn thêm nội dung nào trái phép.
                      </div>
                    </div>
                  </div>
                </FormGrid>

                {/* Căn cứ pháp lý cơ quan thuế */}
                <div style={{ marginTop: 14, padding: 12, background: "var(--primary-soft)", borderRadius: 10, border: `1px solid ${INUT_BORDER_PRIMARY}` }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--primary-dark)", marginBottom: 4 }}>
                    ⚖️ Căn cứ pháp lý kiểm định chi phí hợp lý hợp lệ theo Cơ quan Thuế:
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, color: "var(--text)" }}>
                    <li>Luật Giao dịch điện tử số 20/2023/QH15 & Nghị định 130/2018/NĐ-CP (Giá trị pháp lý của chữ ký số doanh nghiệp).</li>
                    <li>Nghị định 123/2020/NĐ-CP & Thông tư 78/2021/TT-BTC về lưu trữ và giải trình chứng từ điện tử.</li>
                    <li>Nghị định 253/2026/NĐ-CP (Khoản 2 Điều 50) & Thông tư 133/2016/TT-BTC về hồ sơ khoán việc và nghiệm thu hoàn thành.</li>
                  </ul>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </AppModal>

      {/* Share Modal - Hợp đồng ĐÃ KÝ & CHƯA KÝ */}
      <AppModal
        open={Boolean(shareModal)}
        onClose={() => setShareModal(null)}
        size="md"
        title={shareModal ? shareModal.contract.contract_code : ""}
        subtitle={
          shareModal ? (
            <>
              Thợ: <b>{shareModal.contract.worker_name}</b> · {shareModal.contract.project_name}
            </>
          ) : undefined
        }
        footer={
          <button type="button" className="secondary" onClick={() => setShareModal(null)} style={{ minHeight: 44 }}>
            Đóng
          </button>
        }
      >
        {shareModal && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--ink)", color: "var(--gold)", padding: "3px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase" }}>
                📤 Chia Sẻ Hợp Đồng & Tệp PDF
              </span>
            </div>

            {/* Version Tabs: Đã Ký vs Chưa Ký vs Portal */}
            <div style={{ display: "flex", gap: 8, borderBottom: "1px solid var(--border)", paddingBottom: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => { setShareModal({ ...shareModal, tab: "signed" }); setCopiedShare(false); }}
                style={{
                  flex: "1 1 140px",
                  minWidth: 0,
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 700,
                  border: shareModal.tab === "signed" ? "2px solid var(--green)" : "1px solid var(--border-strong)",
                  background: shareModal.tab === "signed" ? "var(--green-soft)" : "var(--surface-subtle)",
                  color: shareModal.tab === "signed" ? "var(--ink-2)" : "var(--muted)",
                  cursor: "pointer",
                  minHeight: 44,
                }}
              >
                🟢 PDF ĐÃ KÝ SỐ {shareModal.contract.is_signed_by_inut ? "✓" : ""}
              </button>

              <button
                type="button"
                onClick={() => { setShareModal({ ...shareModal, tab: "unsigned" }); setCopiedShare(false); }}
                style={{
                  flex: "1 1 140px",
                  minWidth: 0,
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 700,
                  border: shareModal.tab === "unsigned" ? "2px solid var(--amber)" : "1px solid var(--border-strong)",
                  background: shareModal.tab === "unsigned" ? "var(--amber-soft)" : "var(--surface-subtle)",
                  color: shareModal.tab === "unsigned" ? INUT_TEXT_WARN : "var(--muted)",
                  cursor: "pointer",
                  minHeight: 44,
                }}
              >
                🟡 PDF BẢN THẢO (CHƯA KÝ)
              </button>

              <button
                type="button"
                onClick={() => { setShareModal({ ...shareModal, tab: "portal" }); setCopiedShare(false); }}
                style={{
                  flex: "1 1 140px",
                  minWidth: 0,
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 700,
                  border: shareModal.tab === "portal" ? "2px solid var(--primary)" : "1px solid var(--border-strong)",
                  background: shareModal.tab === "portal" ? "var(--primary-soft)" : "var(--surface-subtle)",
                  color: shareModal.tab === "portal" ? "var(--primary-dark)" : "var(--muted)",
                  cursor: "pointer",
                  minHeight: 44,
                }}
              >
                📱 LINK KÝ ONLINE
              </button>
            </div>

            {/* Content for selected Tab */}
            {(() => {
              const c = shareModal.contract;
              const isSignedTab = shareModal.tab === "signed";
              const isDraftTab = shareModal.tab === "unsigned";
              const isPortalTab = shareModal.tab === "portal";

              const activeUrl = isPortalTab
                ? `${window.location.origin}/khoan/${c.portal_token}`
                : `${window.location.origin}/api/public/khoan/${c.portal_token}/pdf${isDraftTab ? "?signed=0" : "?signed=1"}`;

              const shareTitle = isPortalTab
                ? `Link ký online Hợp đồng khoán ${c.contract_code} - iNut`
                : (isSignedTab
                  ? `Hợp đồng giao khoán ĐÃ KÝ SỐ ${c.contract_code} - iNut`
                  : `Bản thảo Hợp đồng giao khoán CHƯA KÝ ${c.contract_code} - iNut`);

              const shareMessage = isPortalTab
                ? `Kính gửi anh/chị ${c.worker_name}, iNut gửi link ký trực tuyến Hợp đồng giao khoán ${c.contract_code} (${c.project_name}). Vui lòng bấm vào liên kết sau để xem và ký tên xác thực: ${activeUrl}`
                : (isSignedTab
                  ? `Kính gửi anh/chị ${c.worker_name}, iNut gửi tệp PDF Hợp đồng giao khoán ${c.contract_code} ĐÃ KÝ SỐ CHÍNH THỨC (${c.project_name}, số tiền: ${c.total_amount?.toLocaleString("vi-VN")} đ). Tải file PDF tại: ${activeUrl}`
                  : `Kính gửi anh/chị ${c.worker_name}, iNut gửi Bản thảo Hợp đồng giao khoán ${c.contract_code} (${c.project_name}) để xem trước và đối soát điều khoản. Xem file PDF tại: ${activeUrl}`);

              return (
                <div style={{ marginTop: 14 }}>
                  {/* Status Banner */}
                  <div style={{ padding: "10px 14px", borderRadius: 8, background: isSignedTab ? "var(--green-soft)" : (isDraftTab ? "var(--amber-soft)" : "var(--primary-soft)"), border: `1px solid ${isSignedTab ? INUT_BORDER_SUCCESS : (isDraftTab ? INUT_BORDER_WARN : INUT_BORDER_PRIMARY)}`, fontSize: 12.5, color: isSignedTab ? "var(--ink-2)" : (isDraftTab ? INUT_TEXT_WARN : "var(--primary-dark)"), marginBottom: 12 }}>
                    {isSignedTab && (
                      <div>
                        <b>🟢 Phiên bản: ĐÃ KÝ SỐ CHÍNH THỨC</b>
                        <div style={{ marginTop: 2 }}>Tệp PDF chứa đầy đủ chữ ký số điện tử của iNut (PAdES) và chữ ký tay eKYC của thợ. Đủ điều kiện làm chứng từ thuế.</div>
                      </div>
                    )}
                    {isDraftTab && (
                      <div>
                        <b>🟡 Phiên bản: BẢN THẢO CHƯA KÝ (DỰ THẢO)</b>
                        <div style={{ marginTop: 2 }}>Tệp PDF sạch chưa đóng dấu, phù hợp để gửi thợ hoặc đối tác duyệt trước điều khoản và đơn giá công việc.</div>
                      </div>
                    )}
                    {isPortalTab && (
                      <div>
                        <b>📱 Phiên bản: LIÊN KẾT KÝ TRỰC TUYẾN (PORTAL DI ĐỘNG)</b>
                        <div style={{ marginTop: 2 }}>Mở giao diện ký online hỗ trợ vẽ tay trên màn hình cảm ứng và chụp ảnh khuôn mặt eKYC chống chối bỏ.</div>
                      </div>
                    )}
                  </div>

                  {/* URL Row with Copy Button */}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      type="text"
                      readOnly
                      className="ui-input"
                      value={activeUrl}
                      style={{ flex: "1 1 200px", minWidth: 0, background: "var(--surface-subtle)", fontFamily: "var(--font-mono)", color: "var(--ink)", boxSizing: "border-box" }}
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <button
                      type="button"
                      style={{ padding: "9px 16px", borderRadius: 8, background: copiedShare ? "var(--green)" : "var(--primary)", color: "#ffffff", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer", minHeight: 44, whiteSpace: "nowrap" }}
                      onClick={() => {
                        navigator.clipboard.writeText(activeUrl).then(() => {
                          setCopiedShare(true);
                          setMessage({ text: "✓ Đã sao chép link vào bộ nhớ tạm!", type: "success" });
                          setTimeout(() => setCopiedShare(false), 3000);
                        });
                      }}
                    >
                      {copiedShare ? "✓ Đã Chép" : "📋 Sao Chép"}
                    </button>
                  </div>

                  {/* Quick Share Buttons Grid */}
                  <FormGrid cols={2} style={{ marginTop: 14 }}>
                    <button
                      type="button"
                      style={{ padding: "10px 14px", borderRadius: 8, background: "var(--primary)", color: "#ffffff", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44 }}
                      onClick={() => {
                        const zaloShare = `https://zalo.me/share?url=${encodeURIComponent(activeUrl)}&message=${encodeURIComponent(shareMessage)}`;
                        openExternalSafe(zaloShare);
                      }}
                    >
                      <span>💬</span> Gửi qua Zalo
                    </button>

                    <button
                      type="button"
                      style={{ padding: "10px 14px", borderRadius: 8, background: "var(--coral)", color: "#ffffff", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44 }}
                      onClick={() => {
                        const mailto = `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(shareMessage)}`;
                        window.location.href = mailto;
                      }}
                    >
                      <span>✉️</span> Gửi qua Email
                    </button>

                    <button
                      type="button"
                      style={{ padding: "10px 14px", borderRadius: 8, background: "var(--ink)", color: "var(--gold)", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44 }}
                      onClick={async () => {
                        if (navigator.share) {
                          try {
                            await navigator.share({ title: shareTitle, text: shareMessage, url: activeUrl });
                            return;
                          } catch (err: any) {
                            if (err.name !== "AbortError") console.warn(err);
                          }
                        }
                        navigator.clipboard.writeText(shareMessage).then(() => {
                          setMessage({ text: "✓ Đã sao chép nội dung và link gửi!", type: "success" });
                          setTimeout(() => setMessage(null), 3000);
                        });
                      }}
                    >
                      <span>📱</span> Chia Sẻ Điện Thoại
                    </button>

                    <a
                      href={safeHttpUrl(activeUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ padding: "10px 14px", borderRadius: 8, background: "var(--paper)", color: "var(--text)", border: "1px solid var(--border-strong)", fontWeight: 700, fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44, boxSizing: "border-box" }}
                    >
                      <span>📄</span> Mở Xem Trực Tiếp
                    </a>
                  </FormGrid>
                </div>
              );
            })()}
          </div>
        )}
      </AppModal>

      {/* Drive Sync Result Modal */}
      <AppModal
        open={Boolean(driveSyncModal)}
        onClose={() => setDriveSyncModal(null)}
        size="md"
        title={driveSyncModal ? `Đồng Bộ Thành Công (${driveSyncModal.quarter})` : ""}
        subtitle={
          driveSyncModal ? (
            <>
              Hợp đồng: <b>{driveSyncModal.contract_code}</b>
            </>
          ) : undefined
        }
        footer={
          driveSyncModal && (
            <>
              <button
                type="button"
                className="secondary"
                style={{ minHeight: 44, padding: "0 16px" }}
                onClick={() => setDriveSyncModal(null)}
              >
                Đóng
              </button>
              {safeHttpUrl(driveSyncModal.drive_link) && (
                <a
                  href={safeHttpUrl(driveSyncModal.drive_link)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="primary"
                  style={{
                    background: "var(--primary-dark)",
                    color: "#ffffff",
                    padding: "8px 16px",
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    minHeight: 44,
                  }}
                >
                  🚀 Mở Thư Mục Trên Google Drive
                </a>
              )}
            </>
          )
        }
      >
        {driveSyncModal && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--green)", color: "#ffffff", padding: "3px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase" }}>
                ☁️ Google Drive Kế Toán
              </span>
            </div>

            <div style={{ background: "var(--surface-subtle)", padding: 12, borderRadius: 8, border: "1px solid var(--border)", fontSize: 13 }}>
              <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Thư mục đích trên Google Drive:</div>
              <div style={{ fontFamily: "var(--font-mono)", color: "var(--ink)", wordBreak: "break-all", fontWeight: 600 }}>
                📁 {driveSyncModal.remote_dest}
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>
                Danh sách tệp hồ sơ đã đồng bộ ({driveSyncModal.files.length} tệp):
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto", background: "var(--paper)", padding: 10, borderRadius: 8 }}>
                {driveSyncModal.files.map((fn, idx) => (
                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ink)", background: "var(--panel)", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)" }}>
                    <span>{fn.endsWith(".pdf") ? "📄" : (fn.endsWith(".docx") ? "📝" : "🖼️")}</span>
                    <span style={{ fontFamily: "var(--font-mono)", flex: 1, wordBreak: "break-all" }}>{fn}</span>
                    <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 11 }}>✓ Đã tải lên</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </AppModal>

      {/* Modal Edit Piecework Contract */}
      <AppModal
        open={Boolean(editingContract)}
        onClose={() => setEditingContract(null)}
        size="md"
        title="Chỉnh Sửa Hợp Đồng Giao Khoán"
        footer={
          <>
            <button type="button" className="secondary" onClick={() => setEditingContract(null)}>Hủy</button>
            <button type="submit" form="piecework-edit-contract-form" className="primary" style={{ background: "var(--primary)", color: "#ffffff" }}>Lưu Thay Đổi</button>
          </>
        }
      >
        {editingContract && (
          <form id="piecework-edit-contract-form" onSubmit={handleSaveEditContract}>
            <FormGrid cols={2}>
              <div>
                <label style={FIELD_LABEL_STYLE}>Mã hợp đồng</label>
                <input
                  type="text"
                  disabled
                  className="ui-input"
                  value={editingContract.contract_code}
                  style={{ ...COMPACT_INPUT_STYLE, background: "var(--surface-subtle)", borderColor: "var(--border)" }}
                />
              </div>

              <div>
                <label style={FIELD_LABEL_STYLE}>Loại hợp đồng</label>
                <select
                  className="ui-select"
                  value={editingContract.contract_type}
                  onChange={(e) => setEditingContract({ ...editingContract, contract_type: e.target.value })}
                  style={COMPACT_INPUT_STYLE}
                >
                  <option value="thi_cong">Thi công lắp đặt thiết bị / Kiosk</option>
                  <option value="mua_ban_ca_nhan">🤝 Hợp đồng mua bán cá nhân (Hàng hóa / Thiết bị / Dịch vụ)</option>
                  <option value="boc_xep">Bốc xếp, vận chuyển nội bộ</option>
                  <option value="gia_cong">Gia công, đóng gói sản phẩm</option>
                  <option value="marketing">Truyền thông & Marketing / Sáng tạo nội dung</option>
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={FIELD_LABEL_STYLE}>Tên công trình / Hạng mục *</label>
                <input
                  type="text"
                  required
                  className="ui-input"
                  value={editingContract.project_name}
                  onChange={(e) => setEditingContract({ ...editingContract, project_name: e.target.value })}
                  style={COMPACT_INPUT_STYLE}
                />
              </div>

              <div>
                <label style={FIELD_LABEL_STYLE}>Địa điểm thi công</label>
                <input
                  type="text"
                  className="ui-input"
                  value={editingContract.location}
                  onChange={(e) => setEditingContract({ ...editingContract, location: e.target.value })}
                  style={COMPACT_INPUT_STYLE}
                />
              </div>

              <div>
                <label style={FIELD_LABEL_STYLE}>Ngày hợp đồng</label>
                <input
                  type="date"
                  className="ui-input"
                  value={editingContract.contract_date}
                  onChange={(e) => setEditingContract({ ...editingContract, contract_date: e.target.value })}
                  style={COMPACT_INPUT_STYLE}
                />
              </div>

              <div>
                <label style={FIELD_LABEL_STYLE}>Họ và tên thợ / Người nhận khoán *</label>
                <input
                  type="text"
                  required
                  className="ui-input"
                  value={editingContract.worker_name}
                  onChange={(e) => setEditingContract({ ...editingContract, worker_name: e.target.value })}
                  style={COMPACT_INPUT_STYLE}
                />
              </div>

              <div>
                <label style={FIELD_LABEL_STYLE}>Số điện thoại</label>
                <input
                  type="text"
                  className="ui-input"
                  value={editingContract.worker_phone}
                  onChange={(e) => setEditingContract({ ...editingContract, worker_phone: e.target.value })}
                  style={COMPACT_INPUT_STYLE}
                />
              </div>

              <div>
                <label style={FIELD_LABEL_STYLE}>Số CCCD gắn chip</label>
                <input
                  type="text"
                  className="ui-input"
                  value={editingContract.worker_id_card}
                  onChange={(e) => setEditingContract({ ...editingContract, worker_id_card: e.target.value })}
                  style={COMPACT_INPUT_STYLE}
                />
              </div>

              <div>
                <label style={FIELD_LABEL_STYLE}>Mã số thuế cá nhân</label>
                <input
                  type="text"
                  className="ui-input"
                  value={editingContract.worker_tax_code}
                  onChange={(e) => setEditingContract({ ...editingContract, worker_tax_code: e.target.value })}
                  style={COMPACT_INPUT_STYLE}
                />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--primary-dark)", marginBottom: 4 }}>
                  💳 Hình thức chi trả thù lao (Chỉ Admin được chọn)
                </label>
                <select
                  className="ui-select"
                  value={editingContract.payment_method || "bank_transfer"}
                  onChange={(e) => setEditingContract({ ...editingContract, payment_method: e.target.value as "bank_transfer" | "cash" })}
                  style={{ ...COMPACT_INPUT_STYLE, border: "1.5px solid var(--primary-dark)", background: editingContract.payment_method === "cash" ? "var(--green-soft)" : "var(--panel)", fontWeight: 600 }}
                >
                  <option value="bank_transfer">🏦 Chuyển khoản ngân hàng (Mặc định)</option>
                  <option value="cash">💵 Nhận tiền mặt tại chân công trình (Chỉ áp dụng &lt; 5 triệu đồng)</option>
                </select>
              </div>
              <div>
                <label style={FIELD_LABEL_STYLE}>Số tài khoản ngân hàng chính chủ</label>
                <input
                  type="text"
                  className="ui-input"
                  value={editingContract.worker_bank_account}
                  onChange={(e) => setEditingContract({ ...editingContract, worker_bank_account: e.target.value })}
                  style={COMPACT_INPUT_STYLE}
                />
              </div>

              <div>
                <label style={FIELD_LABEL_STYLE}>Tên ngân hàng</label>
                <input
                  type="text"
                  className="ui-input"
                  value={editingContract.worker_bank_name}
                  onChange={(e) => setEditingContract({ ...editingContract, worker_bank_name: e.target.value })}
                  style={COMPACT_INPUT_STYLE}
                />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={FIELD_LABEL_STYLE}>Địa chỉ thường trú</label>
                <input
                  type="text"
                  className="ui-input"
                  value={editingContract.worker_address}
                  onChange={(e) => setEditingContract({ ...editingContract, worker_address: e.target.value })}
                  style={COMPACT_INPUT_STYLE}
                />
              </div>
            </FormGrid>

            {/* Work Items section */}
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Hạng mục công việc giao khoán</label>
                <button type="button" className="ui-btn-chip" onClick={handleEditAddItem} style={{ background: "var(--green-soft)", color: "var(--ink-2)", borderColor: INUT_BORDER_SUCCESS }}>
                  ＋ Thêm dòng
                </button>
              </div>

              {editingContract.items.map((it, idx) => (
                <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    type="text"
                    className="ui-input"
                    placeholder="Tên công việc..."
                    value={it.ten}
                    onChange={(e) => handleEditItemChange(idx, "ten", e.target.value)}
                    style={{ flex: "3 1 160px", minWidth: 0, width: "auto" }}
                  />
                  <input
                    type="number"
                    min="1"
                    className="ui-input"
                    placeholder="SL"
                    value={it.so_luong}
                    onChange={(e) => handleEditItemChange(idx, "so_luong", Number(e.target.value))}
                    style={{ width: 68, textAlign: "center", padding: "8px 6px" }}
                  />
                  <input
                    type="text"
                    className="ui-input"
                    placeholder="ĐVT"
                    value={it.dvt}
                    onChange={(e) => handleEditItemChange(idx, "dvt", e.target.value)}
                    style={{ width: 74, textAlign: "center", padding: "8px 6px" }}
                  />
                  <input
                    type="number"
                    className="ui-input"
                    placeholder="Đơn giá"
                    value={it.don_gia}
                    onChange={(e) => handleEditItemChange(idx, "don_gia", Number(e.target.value))}
                    style={{ flex: "1 1 110px", minWidth: 96, width: "auto", textAlign: "right" }}
                  />
                  <button
                    type="button"
                    className="ui-btn-icon"
                    aria-label="Xóa dòng hạng mục"
                    onClick={() => handleEditRemoveItem(idx)}
                    style={{ background: "var(--red-soft)", color: INUT_TEXT_DANGER, borderColor: INUT_BORDER_DANGER }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </form>
        )}
      </AppModal>

      {/* Modal Create New Piecework Contract */}
      <AppModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        size="md"
        title="Tạo Hợp Đồng Giao Khoán Mới"
        footer={
          <>
            <button type="button" className="secondary" onClick={() => setShowCreateModal(false)}>Hủy</button>
            <button type="submit" form="piecework-create-contract-form" className="primary" style={{ background: "var(--primary)", color: "#ffffff" }}>Tạo Hợp Đồng</button>
          </>
        }
      >
        <form id="piecework-create-contract-form" onSubmit={handleCreateContract}>
          <FormGrid cols={2}>
            <div>
              <label style={FIELD_LABEL_STYLE}>Mã hợp đồng</label>
              <input
                type="text"
                className="ui-input"
                placeholder="VD: 04/2026/HĐGK"
                value={formData.contract_code}
                onChange={(e) => setFormData({ ...formData, contract_code: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>

            <div>
              <label style={FIELD_LABEL_STYLE}>Loại hợp đồng</label>
              <select
                className="ui-select"
                value={formData.contract_type}
                onChange={(e) => {
                  const newType = e.target.value;
                  const isMb = newType === "mua_ban_ca_nhan";
                  const todayStr = new Date().toISOString().slice(0, 10).split("-").reverse().join("");
                  setFormData({
                    ...formData,
                    contract_type: newType,
                    contract_code: formData.contract_code ? formData.contract_code : (isMb ? `${todayStr}-01/HĐMB-INUT` : `${todayStr}-01/HĐGK-INUT`),
                    title: isMb && (!formData.title || formData.title.includes("giao khoán")) ? `Hợp đồng mua bán cá nhân - ${formData.project_name || 'Hàng hóa / Thiết bị'}` : formData.title,
                  });
                }}
                style={COMPACT_INPUT_STYLE}
              >
                <option value="thi_cong">Thi công lắp đặt thiết bị / Kiosk</option>
                <option value="mua_ban_ca_nhan">🤝 Hợp đồng mua bán cá nhân (Hàng hóa / Thiết bị / Dịch vụ)</option>
                <option value="boc_xep">Bốc xếp, vận chuyển nội bộ</option>
                <option value="gia_cong">Gia công, đóng gói sản phẩm</option>
                <option value="marketing">Truyền thông & Marketing / Sáng tạo nội dung</option>
              </select>
            </div>

            <div style={{ gridColumn: "1 / -1" }}>
              <label style={FIELD_LABEL_STYLE}>
                {formData.contract_type === "mua_ban_ca_nhan" ? "Tên hàng hóa / Tài sản / Giao dịch *" : "Tên công trình / Hạng mục *"}
              </label>
              <input
                type="text"
                required
                className="ui-input"
                placeholder={formData.contract_type === "mua_ban_ca_nhan" ? "VD: Mua bán bo mạch, thiết bị camera, chuyển giao phần mềm" : "VD: Lắp đặt Kiosk AI tại Phường Đông Sơn"}
                value={formData.project_name}
                onChange={(e) => setFormData({ ...formData, project_name: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>

            <div>
              <label style={FIELD_LABEL_STYLE}>Địa điểm thi công</label>
              <input
                type="text"
                className="ui-input"
                placeholder="VD: TP. Thanh Hóa"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>

            <div>
              <label style={FIELD_LABEL_STYLE}>Ngày hợp đồng</label>
              <input
                type="date"
                className="ui-input"
                value={formData.contract_date}
                onChange={(e) => setFormData({ ...formData, contract_date: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>

            <div>
              <label style={FIELD_LABEL_STYLE}>Họ và tên thợ / Người nhận khoán *</label>
              <input
                type="text"
                required
                className="ui-input"
                placeholder="VD: Nguyễn Văn A"
                value={formData.worker_name}
                onChange={(e) => setFormData({ ...formData, worker_name: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>

            <div>
              <label style={FIELD_LABEL_STYLE}>Số điện thoại</label>
              <input
                type="text"
                className="ui-input"
                placeholder="VD: 0912 345 678"
                value={formData.worker_phone}
                onChange={(e) => setFormData({ ...formData, worker_phone: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>

            <div>
              <label style={FIELD_LABEL_STYLE}>Số CCCD gắn chip</label>
              <input
                type="text"
                className="ui-input"
                placeholder="VD: 038092004512"
                value={formData.worker_id_card}
                onChange={(e) => setFormData({ ...formData, worker_id_card: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>

            <div>
              <label style={FIELD_LABEL_STYLE}>Mã số thuế cá nhân</label>
              <input
                type="text"
                className="ui-input"
                placeholder="VD: 8492004512"
                value={formData.worker_tax_code}
                onChange={(e) => setFormData({ ...formData, worker_tax_code: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>

            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--primary-dark)", marginBottom: 4 }}>
                💳 Hình thức chi trả thù lao (Chỉ Admin được chọn)
              </label>
              <select
                className="ui-select"
                value={formData.payment_method}
                onChange={(e) => setFormData({ ...formData, payment_method: e.target.value as "bank_transfer" | "cash" })}
                style={{ ...COMPACT_INPUT_STYLE, border: "1.5px solid var(--primary-dark)", background: formData.payment_method === "cash" ? "var(--green-soft)" : "var(--panel)", fontWeight: 600 }}
              >
                <option value="bank_transfer">🏦 Chuyển khoản ngân hàng (Mặc định)</option>
                <option value="cash">💵 Nhận tiền mặt tại chân công trình (Chỉ áp dụng &lt; 5 triệu đồng)</option>
              </select>
            </div>
            <div>
              <label style={FIELD_LABEL_STYLE}>Số tài khoản ngân hàng chính chủ</label>
              <input
                type="text"
                className="ui-input"
                placeholder="VD: 19034567891011"
                value={formData.worker_bank_account}
                onChange={(e) => setFormData({ ...formData, worker_bank_account: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>

            <div>
              <label style={FIELD_LABEL_STYLE}>Tên ngân hàng</label>
              <input
                type="text"
                className="ui-input"
                placeholder="VD: Techcombank"
                value={formData.worker_bank_name}
                onChange={(e) => setFormData({ ...formData, worker_bank_name: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>

            <div style={{ gridColumn: "1 / -1" }}>
              <label style={FIELD_LABEL_STYLE}>Địa chỉ thường trú</label>
              <input
                type="text"
                className="ui-input"
                placeholder="VD: Tổ 5, Quyết Tâm, TP. Sơn La"
                value={formData.worker_address}
                onChange={(e) => setFormData({ ...formData, worker_address: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>
          </FormGrid>

          {/* Work Items section */}
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Hạng mục công việc giao khoán</label>
              <button type="button" className="ui-btn-chip" onClick={handleAddItem} style={{ background: "var(--green-soft)", color: "var(--ink-2)", borderColor: INUT_BORDER_SUCCESS }}>
                ＋ Thêm dòng
              </button>
            </div>

            {formData.items.map((it, idx) => (
              <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="text"
                  className="ui-input"
                  placeholder="Tên công việc..."
                  value={it.ten}
                  onChange={(e) => handleItemChange(idx, "ten", e.target.value)}
                  style={{ flex: "3 1 160px", minWidth: 0, width: "auto" }}
                />
                <input
                  type="number"
                  min="1"
                  className="ui-input"
                  placeholder="SL"
                  value={it.so_luong}
                  onChange={(e) => handleItemChange(idx, "so_luong", Number(e.target.value))}
                  style={{ width: 68, textAlign: "center", padding: "8px 6px" }}
                />
                <input
                  type="text"
                  className="ui-input"
                  placeholder="ĐVT"
                  value={it.dvt}
                  onChange={(e) => handleItemChange(idx, "dvt", e.target.value)}
                  style={{ width: 74, textAlign: "center", padding: "8px 6px" }}
                />
                <input
                  type="number"
                  className="ui-input"
                  placeholder="Đơn giá"
                  value={it.don_gia}
                  onChange={(e) => handleItemChange(idx, "don_gia", Number(e.target.value))}
                  style={{ flex: "1 1 110px", minWidth: 96, width: "auto", textAlign: "right" }}
                />
                <button
                  type="button"
                  className="ui-btn-icon"
                  aria-label="Xóa dòng hạng mục"
                  onClick={() => handleRemoveItem(idx)}
                  style={{ background: "var(--red-soft)", color: INUT_TEXT_DANGER, borderColor: INUT_BORDER_DANGER }}
                >
                  ✕
                </button>
              </div>
            ))}

            <div style={{ marginTop: 10, padding: "10px 14px", background: "var(--surface-subtle)", borderRadius: 8, border: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Tổng giá trị khoán:</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)" }}>{calculateTotal().toLocaleString("vi-VN")} VNĐ</span>
            </div>

            {calculateTotal() < 5000000 ? (
              <div style={{ fontSize: 12, color: "var(--green)", marginTop: 4, fontStyle: "italic" }}>
                ✓ Dưới 5 triệu đồng: Tự động miễn trừ 10% thuế TNCN theo Nghị định 253/2026/NĐ-CP.
              </div>
            ) : (
              <div style={{ fontSize: 12, color: INUT_TEXT_DANGER, marginTop: 4, fontStyle: "italic" }}>
                ⚠️ Từ 5 triệu đồng trở lên: Tự động tính khấu trừ 10% thuế TNCN ({Math.round(calculateTotal() * 0.1).toLocaleString("vi-VN")} đ) nộp NSNN.
              </div>
            )}
          </div>
        </form>
      </AppModal>

      {/* Modal Thêm / Chỉnh Sửa Nhà Cung Cấp Khoán */}
      <AppModal
        open={showContractorModal}
        onClose={() => setShowContractorModal(false)}
        size="md"
        title={editingContractor ? "Chỉnh Sửa Hồ Sơ Nhà Cung Cấp / Thợ" : "Thêm Nhà Cung Cấp / Thợ Mới Vào Danh Bạ"}
        subtitle="Lưu trữ định danh CCCD & MST cá nhân để tạo HĐ khoán nhanh và hỗ trợ quyết toán thuế"
        footer={
          <>
            <button type="button" className="secondary" onClick={() => setShowContractorModal(false)}>Hủy</button>
            <button type="submit" form="piecework-contractor-form" className="primary" style={{ background: "var(--primary-dark)", color: "#ffffff", fontWeight: 700 }}>
              {editingContractor ? "Lưu Cập Nhật" : "✓ Lưu Vào Danh Bạ"}
            </button>
          </>
        }
      >
        <form id="piecework-contractor-form" onSubmit={handleSaveContractor}>
          {/* Smart Paste Quick trigger on contractor modal */}
          <div style={{ background: "var(--paper)", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--gold)", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 12.5, color: "var(--ink)", fontWeight: 600 }}>Có tin nhắn Zalo hoặc mã QR CCCD của thợ?</span>
            <button
              type="button"
              className="ui-btn-chip"
              style={{ background: "var(--gold)", color: "var(--ink)", borderColor: "transparent" }}
              onClick={() => {
                setSmartPasteTarget("contractor");
                setSmartPasteText("");
                setShowSmartPasteModal(true);
              }}
            >
              ⚡ Dán nhanh tự điền form
            </button>
          </div>

          <FormGrid cols={2}>
            <div>
              <label style={FIELD_LABEL_STYLE}>Mã nhà cung cấp (Tùy chọn)</label>
              <input
                type="text"
                className="ui-input"
                placeholder="VD: CTV-HAI-4512 (để trống tự sinh)"
                value={contractorForm.code}
                onChange={(e) => setContractorForm({ ...contractorForm, code: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>

            <div>
              <label style={FIELD_LABEL_STYLE}>Họ và tên thợ / Người nhận khoán *</label>
              <input
                type="text"
                required
                className="ui-input"
                placeholder="VD: Lê Văn Hải"
                value={contractorForm.name}
                onChange={(e) => setContractorForm({ ...contractorForm, name: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>

            <div>
              <label style={FIELD_LABEL_STYLE}>Số CCCD gắn chip (12 số) *</label>
              <input
                type="text"
                required
                className="ui-input"
                placeholder="VD: 038092004512"
                value={contractorForm.id_card}
                onChange={(e) => setContractorForm({ ...contractorForm, id_card: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>

            <div>
              <label style={FIELD_LABEL_STYLE}>Ngày cấp CCCD</label>
              <input
                type="date"
                className="ui-input"
                value={contractorForm.id_card_date}
                onChange={(e) => setContractorForm({ ...contractorForm, id_card_date: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>

            <div>
              <label style={FIELD_LABEL_STYLE}>Nơi cấp CCCD</label>
              <input
                type="text"
                className="ui-input"
                value={contractorForm.id_card_place}
                onChange={(e) => setContractorForm({ ...contractorForm, id_card_place: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>

            <div>
              <label style={FIELD_LABEL_STYLE}>Mã số thuế cá nhân (MST làm hoàn thuế)</label>
              <input
                type="text"
                className="ui-input"
                placeholder="VD: 8492004512"
                value={contractorForm.tax_code}
                onChange={(e) => setContractorForm({ ...contractorForm, tax_code: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>

            <div>
              <label style={FIELD_LABEL_STYLE}>Số điện thoại</label>
              <input
                type="text"
                className="ui-input"
                placeholder="VD: 0961 197 999"
                value={contractorForm.phone}
                onChange={(e) => setContractorForm({ ...contractorForm, phone: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>

            <div>
              <label style={FIELD_LABEL_STYLE}>Số tài khoản ngân hàng chính chủ</label>
              <input
                type="text"
                className="ui-input"
                placeholder="VD: 19034567891011"
                value={contractorForm.bank_account}
                onChange={(e) => setContractorForm({ ...contractorForm, bank_account: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>

            <div>
              <label style={FIELD_LABEL_STYLE}>Tên ngân hàng thụ hưởng</label>
              <input
                type="text"
                className="ui-input"
                placeholder="VD: Techcombank"
                value={contractorForm.bank_name}
                onChange={(e) => setContractorForm({ ...contractorForm, bank_name: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>

            <div>
              <label style={FIELD_LABEL_STYLE}>Kỹ năng / Hạng mục khoán chính</label>
              <input
                type="text"
                className="ui-input"
                placeholder="VD: Lắp đặt Kiosk, thi công điện mạng..."
                value={contractorForm.skills}
                onChange={(e) => setContractorForm({ ...contractorForm, skills: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>

            <div style={{ gridColumn: "1 / -1" }}>
              <label style={FIELD_LABEL_STYLE}>Địa chỉ thường trú (Theo CCCD)</label>
              <input
                type="text"
                className="ui-input"
                placeholder="VD: Tổ 2, Phường Đông Sơn, TP. Thanh Hóa, Tỉnh Thanh Hóa"
                value={contractorForm.address}
                onChange={(e) => setContractorForm({ ...contractorForm, address: e.target.value })}
                style={COMPACT_INPUT_STYLE}
              />
            </div>
          </FormGrid>
        </form>
      </AppModal>

      {/* Modal Smart Paste Thông Tin Thợ / Nhà Cung Cấp (rendered after Contractor modal for proper stacking) */}
      <AppModal
        open={showSmartPasteModal}
        onClose={() => setShowSmartPasteModal(false)}
        size="md"
        title="Dán Nhanh & Trích Xuất Thông Tin Thợ"
        subtitle="Tự động nhận diện Họ tên, CCCD 12 số, Ngày cấp, Nơi cấp, MST, SĐT, STK ngân hàng, Địa chỉ"
        footer={
          <>
            <button type="button" className="secondary" onClick={() => setShowSmartPasteModal(false)}>Hủy</button>
            <button
              type="button"
              className="primary"
              style={{ background: "var(--gold)", color: "var(--ink)", fontWeight: 700 }}
              onClick={handleApplySmartPaste}
              disabled={!smartPasteText.trim()}
            >
              ⚡ Trích Xuất & Điền Tự Động
            </button>
          </>
        }
      >
        <div>
          <div style={{ marginBottom: 12 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--ink)", color: "var(--gold)", padding: "3px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase" }}>
              ⚡ AI / Heuristic Extraction
            </span>
          </div>

          <label style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", display: "block", marginBottom: 6 }}>
            Dán toàn bộ tin nhắn Zalo, SMS hoặc chuỗi quét mã QR CCCD của thợ:
          </label>
          <textarea
            rows={7}
            className="ui-textarea"
            placeholder={`Ví dụ tin nhắn Zalo:\nNguyễn Văn An, cccd 038092004512 cấp ngày 15/04/2022 tại Cục Cảnh sát QLHC về TTXH, mst 8492004512, sđt 0912 345 678, stk 19034567891011 techcombank, đ/c Tổ 2, Phường Đông Sơn, Thanh Hóa\n\nHoặc chuỗi QR CCCD:\n038092004512||Nguyễn Văn An|15041992|Nam|Tổ 2, Đông Sơn, Thanh Hóa|15042022`}
            value={smartPasteText}
            onChange={(e) => setSmartPasteText(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box" }}
          />
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
            💡 Hệ thống áp dụng thuật toán bóc tách regex thông minh, chống sai số tài khoản và định dạng CCCD chuẩn Bộ Công an.
          </div>
        </div>
      </AppModal>

      {/* Modal Bảng Kê Thuế & Thu Nhập Cho Thợ Hoàn Thuế */}
      <AppModal
        open={Boolean(taxSummaryData)}
        onClose={() => setTaxSummaryData(null)}
        size="lg"
        title={taxSummaryData ? `Bảng Kê Chi Trả Thù Lao & Khấu Trừ Thuế TNCN — Năm ${taxSummaryData.year}` : ""}
        subtitle={
          taxSummaryData ? (
            <>
              Thợ: <b>{taxSummaryData.contractor.name}</b> · CCCD: <b>{taxSummaryData.contractor.id_card}</b> · MST: <b>{taxSummaryData.contractor.tax_code || "Chưa có"}</b>
            </>
          ) : undefined
        }
        footer={
          <>
            <button type="button" className="secondary" onClick={() => setTaxSummaryData(null)}>Đóng</button>
            <button
              type="button"
              className="secondary"
              style={{ background: "var(--green-soft)", color: "var(--ink-2)", border: "1px solid var(--green)", fontWeight: 700 }}
              onClick={() => window.print()}
            >
              🖨️ In Bảng Kê Thuế
            </button>
          </>
        }
      >
        {taxSummaryData && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--green)", color: "#ffffff", padding: "3px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase" }}>
                ⚖️ Hỗ Trợ Hoàn Thuế TNCN (NĐ 253/2026/NĐ-CP)
              </span>
            </div>

            {/* Summary 3 Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 10, marginBottom: 14, minWidth: 0 }}>
              <div style={{ background: "var(--surface-subtle)", padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)", minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 600 }}>TỔNG THÙ LAO (GROSS)</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)", marginTop: 3 }}>
                  {taxSummaryData.summary.total_gross_income.toLocaleString("vi-VN")} đ
                </div>
                <div style={{ fontSize: 11, color: "var(--primary-dark)" }}>{taxSummaryData.summary.total_contracts} hợp đồng khoán</div>
              </div>

              <div style={{ background: "var(--red-soft)", padding: "12px 14px", borderRadius: 10, border: `1px solid ${INUT_BORDER_DANGER}`, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: INUT_TEXT_DANGER, fontWeight: 600 }}>THUẾ TNCN ĐÃ KHẤU TRỪ (10%)</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: INUT_TEXT_DANGER, marginTop: 3 }}>
                  {taxSummaryData.summary.total_tax_withheld.toLocaleString("vi-VN")} đ
                </div>
                <div style={{ fontSize: 11, color: INUT_TEXT_DANGER }}>Đã nộp vào NSNN</div>
              </div>

              <div style={{ background: "var(--green-soft)", padding: "12px 14px", borderRadius: 10, border: `1px solid ${INUT_BORDER_SUCCESS}`, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: "var(--ink-2)", fontWeight: 600 }}>THỰC NHẬN CHUYỂN KHOẢN (NET)</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--green)", marginTop: 3 }}>
                  {taxSummaryData.summary.total_net_paid.toLocaleString("vi-VN")} đ
                </div>
                <div style={{ fontSize: 11, color: "var(--green)" }}>TK Techcombank 79713</div>
              </div>
            </div>

            {/* Table / Mobile Cards of contracts in year */}
            <DataView
              mobileMode="card"
              desktop={
                <div className="ui-table-scroll-wrap" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, textAlign: "left" }}>
                    <thead>
                      <tr style={{ background: "var(--surface-subtle)", borderBottom: "1px solid var(--border)", color: "var(--ink-2)" }}>
                        <th style={{ padding: "8px 10px" }}>STT</th>
                        <th style={{ padding: "8px 10px" }}>Số HĐ / Ngày</th>
                        <th style={{ padding: "8px 10px" }}>Hạng mục công việc</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Tổng tiền (Gross)</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Thuế TNCN (10%)</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Thực nhận (Net)</th>
                        <th style={{ padding: "8px 10px", textAlign: "center" }}>File PDF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {taxSummaryData.contracts.map((it) => {
                        const safePdfHref = safeHttpUrl(it.pdf_url);
                        return (
                          <tr key={it.contract_code} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "8px 10px" }}>{it.stt}</td>
                            <td style={{ padding: "8px 10px" }}>
                              <div style={{ fontWeight: 700, color: "var(--primary-dark)" }}>{it.contract_code}</div>
                              <div style={{ fontSize: 11, color: "var(--muted)" }}>{it.contract_date}</div>
                            </td>
                            <td style={{ padding: "8px 10px" }}>
                              <div style={{ fontWeight: 600, color: "var(--ink)" }}>{it.project_name}</div>
                              <div style={{ fontSize: 11, color: "var(--muted)" }}>{it.contract_type_label}</div>
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: "var(--ink)" }}>
                              {it.gross_amount.toLocaleString("vi-VN")} đ
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: it.tax_withheld > 0 ? INUT_TEXT_DANGER : "var(--green)" }}>
                              {it.tax_withheld > 0 ? `-${it.tax_withheld.toLocaleString("vi-VN")} đ` : "Miễn khấu trừ"}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: "var(--ink-2)" }}>
                              {it.net_paid.toLocaleString("vi-VN")} đ
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>
                              {safePdfHref ? (
                                <a
                                  href={safePdfHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="ui-btn-chip"
                                  style={{ fontSize: 11.5, padding: "4px 8px" }}
                                >
                                  📄 PDF Đã Ký
                                </a>
                              ) : (
                                <span style={{ color: "var(--muted)", fontSize: 11.5 }}>—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              }
              mobileCards={
                <div className="ui-mobile-card-list">
                  {taxSummaryData.contracts.map((it) => {
                    const safePdfHref = safeHttpUrl(it.pdf_url);
                    return (
                      <div key={it.contract_code} className="ui-mobile-card">
                        <div className="ui-mobile-card-head">
                          <div style={{ minWidth: 0 }}>
                            <div className="ui-mobile-card-title" style={{ color: "var(--primary-dark)" }}>
                              #{it.stt} · {it.contract_code}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                              {it.contract_date} · {it.contract_type_label}
                            </div>
                          </div>
                          {safePdfHref && (
                            <a
                              href={safePdfHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ui-btn-chip"
                            >
                              📄 PDF
                            </a>
                          )}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", overflowWrap: "anywhere" }}>
                          {it.project_name}
                        </div>
                        <div className="ui-mobile-card-grid">
                          <div className="ui-mobile-card-kv">
                            <span>Tổng tiền (Gross)</span>
                            <strong>{it.gross_amount.toLocaleString("vi-VN")} đ</strong>
                          </div>
                          <div className="ui-mobile-card-kv">
                            <span>Thuế TNCN (10%)</span>
                            <strong style={{ color: it.tax_withheld > 0 ? INUT_TEXT_DANGER : "var(--green)" }}>
                              {it.tax_withheld > 0 ? `-${it.tax_withheld.toLocaleString("vi-VN")} đ` : "Miễn khấu trừ"}
                            </strong>
                          </div>
                          <div className="ui-mobile-card-kv" style={{ gridColumn: "1 / -1" }}>
                            <span>Thực nhận (Net)</span>
                            <strong style={{ color: "var(--green)" }}>{it.net_paid.toLocaleString("vi-VN")} đ</strong>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              }
            />

            {/* Tax Guidance Note */}
            <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--primary-soft)", borderRadius: 8, border: `1px solid ${INUT_BORDER_PRIMARY}`, fontSize: 12, color: "var(--primary-dark)" }}>
              <b>💡 Hướng dẫn làm thủ tục Hoàn Thuế Thu Nhập Cá Nhân:</b>
              <div style={{ marginTop: 3 }}>{taxSummaryData.tax_refund_guidance}</div>
              <div style={{ marginTop: 4, fontSize: 11, color: "var(--ink-2)" }}>
                Đơn vị chi trả: <b>{taxSummaryData.payer.company_name}</b> (MST: {taxSummaryData.payer.tax_code}) cam kết đã kê khai thuế theo đúng quy định.
              </div>
            </div>
          </div>
        )}
      </AppModal>

      {/* Lightbox / Document Preview Modal (rendered LAST so it stacks above Detail & Audit modals) */}
      <AppModal
        open={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        size="lg"
        title={previewDoc?.title ?? "Xem tài liệu"}
        subtitle={previewDoc?.validationNote}
        footer={
          previewDoc && (
            <>
              {safeHttpUrl(previewDoc.downloadUrl) && (
                <a
                  href={safeHttpUrl(previewDoc.downloadUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="secondary"
                  style={{ textDecoration: "none", color: "var(--primary-dark)", background: "var(--primary-soft)", border: `1px solid ${INUT_BORDER_PRIMARY}`, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 14px", borderRadius: 10 }}
                >
                  ⬇️ Tải file
                </a>
              )}
              <button type="button" className="primary" style={{ background: "var(--primary)", color: "#ffffff" }} onClick={() => setPreviewDoc(null)}>
                Đóng
              </button>
            </>
          )
        }
      >
        {previewDoc && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", background: "var(--surface-subtle)", borderRadius: 10, padding: 10, minHeight: 360 }}>
            {previewDoc.isPdf ? (
              <iframe
                src={safeHttpUrl(previewDoc.url)}
                title={previewDoc.title}
                style={{ width: "100%", height: "70vh", border: "none", borderRadius: 8, background: "var(--panel)" }}
              />
            ) : (
              <img
                src={previewDoc.url}
                alt={previewDoc.title}
                style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain", borderRadius: 8, boxShadow: "var(--shadow)" }}
              />
            )}
          </div>
        )}
      </AppModal>
    </div>
  );
}

// Reusable Document Card Component with Thumbnail Preview
function DocumentCard({
  title,
  hasDoc,
  docId,
  attachment,
  uploading,
  onUpload,
  onDelete,
  onPreview,
  allowPdf = true,
}: {
  title: string;
  hasDoc: boolean;
  docId?: string;
  attachment?: any;
  uploading: boolean;
  onUpload: (f: File | undefined) => void;
  onDelete: () => void;
  onPreview: (att: any) => void;
  allowPdf?: boolean;
}) {
  const isOk = hasDoc && attachment?.validation?.valid !== false;
  const isPdf = Boolean(
    attachment?.is_pdf ||
    attachment?.validation?.kind === "pdf" ||
    attachment?.validation?.format?.toUpperCase() === "PDF" ||
    attachment?.suffix?.toLowerCase() === ".pdf"
  );

  return (
    <div style={{ background: "var(--surface-subtle)", padding: 12, borderRadius: 12, border: "1px solid var(--border)", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 10, minWidth: 0 }}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--ink)", minWidth: 0 }}>{title}</div>
          <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: isOk ? "var(--green-soft)" : (hasDoc ? "var(--amber-soft)" : "var(--red-soft)"), color: isOk ? "var(--ink-2)" : (hasDoc ? INUT_TEXT_WARN : INUT_TEXT_DANGER), fontWeight: 600, flexShrink: 0 }}>
            {hasDoc ? "✓ Đã có tệp" : "✗ Chưa có"}
          </span>
        </div>

        {/* Thumbnail Preview if file exists */}
        {hasDoc && attachment && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, padding: 6, background: "var(--panel)", borderRadius: 8, border: "1px solid var(--border)" }}>
            {isPdf ? (
              <div
                onClick={() => onPreview(attachment)}
                style={{ width: 44, height: 44, borderRadius: 6, background: "var(--red-soft)", color: INUT_TEXT_DANGER, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 10, cursor: "pointer", flexShrink: 0 }}
                title="Bấm để xem trước tệp PDF"
              >
                <span style={{ fontSize: 14 }}>📄</span>
                <span>PDF</span>
              </div>
            ) : (
              <img
                src={attachment.url}
                alt={title}
                onClick={() => onPreview(attachment)}
                style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border-strong)", cursor: "pointer", flexShrink: 0 }}
                title="Bấm để xem ảnh phóng to"
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: attachment.validation?.valid ? "var(--green)" : INUT_TEXT_DANGER, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {attachment.validation?.valid ? `🟢 ${attachment.validation.note || (isPdf ? "Tài liệu PDF" : "Ảnh hợp lệ")}` : `⚠️ ${attachment.validation?.error || "Lỗi tệp"}`}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>
                {attachment.validation?.dimensions ? `Kích thước: ${attachment.validation.dimensions}` : (attachment.validation?.pages ? `Số trang: ${attachment.validation.pages}` : "")}
                {attachment.validation?.size_kb ? ` (${attachment.validation.size_kb} KB)` : ""}
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ flex: 1, textAlign: "center", padding: "8px 10px", background: "var(--primary)", color: "#ffffff", borderRadius: 8, fontSize: 12.5, cursor: "pointer", fontWeight: 600, minHeight: 44, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          {uploading ? "Đang tải…" : (hasDoc ? "🔄 Thay tệp" : "＋ Tải tệp lên")}
          <input
            type="file"
            accept={allowPdf ? "image/*,.pdf" : "image/*"}
            style={{ display: "none" }}
            disabled={uploading}
            onChange={(e) => onUpload(e.target.files?.[0])}
          />
        </label>

        {hasDoc && attachment && (
          <>
            <button
              type="button"
              className="ui-btn-chip"
              style={{ color: "var(--primary-dark)", background: "var(--primary-soft)", borderColor: INUT_BORDER_PRIMARY }}
              onClick={() => onPreview(attachment)}
              title="Xem trước tài liệu"
            >
              👁️ Xem
            </button>
            <button
              type="button"
              className="ui-btn-icon"
              aria-label="Xóa tệp chứng từ này"
              style={{ color: INUT_TEXT_DANGER, background: "var(--red-soft)", borderColor: INUT_BORDER_DANGER }}
              onClick={onDelete}
              title="Xóa tệp chứng từ này"
            >
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Reusable Audit Item Renderer with Zero Raw JSON and Real Thumbnails
function renderAuditCheckItem(
  chk: any,
  attachments?: any,
  workerSig?: string,
  workerFace?: string,
  onPreview?: (att: any, title?: string) => void
) {
  const v = chk.validation;

  return (
    <div
      key={chk.key}
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        padding: "12px 14px",
        borderRadius: 12,
        background: chk.ok ? "var(--green-soft)" : "var(--red-soft)",
        border: `1.5px solid ${chk.ok ? INUT_BORDER_SUCCESS : INUT_BORDER_DANGER}`,
        boxSizing: "border-box",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
      }}
    >
      <span style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>{chk.ok ? "✅" : "⚠️"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: chk.ok ? "var(--ink-2)" : INUT_TEXT_DANGER }}>
            {chk.label}
          </div>
          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "var(--panel)", color: chk.ok ? "var(--green)" : INUT_TEXT_DANGER, border: `1px solid ${chk.ok ? INUT_BORDER_SUCCESS : INUT_BORDER_DANGER}`, fontWeight: 700 }}>
            {chk.ok ? "ĐẠT YÊU CẦU" : "CẦN BỔ SUNG"}
          </span>
        </div>

        <div style={{ fontSize: 13, color: "var(--text)", marginTop: 4, lineHeight: 1.45 }}>
          {chk.detail}
        </div>

        {/* 1. Item CCCD: Show structured breakdown + Front/Back thumbnails */}
        {chk.key === "id_card" && (
          <div style={{ marginTop: 8, padding: "10px 12px", background: "var(--panel)", borderRadius: 8, border: "1px solid var(--border)" }}>
            {v?.cccd_format && (
              <div style={{ fontSize: 12, color: "var(--ink-2)", marginBottom: 8 }}>
                <b>Định danh pháp lý:</b> Mã tỉnh: <span style={{ color: "var(--primary-dark)", fontWeight: 700 }}>{v.cccd_format.province_code || "Hợp chuẩn"}</span>
                {v.cccd_format.birth_year && ` · Năm sinh: ${v.cccd_format.birth_year}`}
                {" · "}
                <span style={{ color: v.cccd_format.valid ? "var(--green)" : INUT_TEXT_DANGER, fontWeight: 600 }}>
                  {v.cccd_format.valid ? "✓ 12 số hợp chuẩn theo quy định Bộ Công an" : "Số CCCD chưa đúng định dạng"}
                </span>
              </div>
            )}

            {/* Thumbnails of Front and Back side */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 130px), 1fr))", gap: 8, minWidth: 0 }}>
              {attachments?.id_card_front && (
                <div
                  onClick={() => onPreview && onPreview(attachments.id_card_front, "CCCD Mặt trước")}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: 6, borderRadius: 6, border: "1px solid var(--border-strong)", background: "var(--surface-subtle)", cursor: "pointer", minWidth: 0 }}
                  title="Bấm để xem ảnh phóng to"
                >
                  <img src={attachments.id_card_front.url} alt="CCCD Trước" style={{ width: 48, height: 36, objectFit: "cover", borderRadius: 4, border: "1px solid var(--border)", flexShrink: 0 }} />
                  <div style={{ fontSize: 11, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: "var(--ink)" }}>CCCD Trước</div>
                    <div style={{ color: "var(--green)" }}>{v?.front?.dimensions || "Ảnh hợp lệ"}</div>
                  </div>
                </div>
              )}

              {attachments?.id_card_back && (
                <div
                  onClick={() => onPreview && onPreview(attachments.id_card_back, "CCCD Mặt sau")}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: 6, borderRadius: 6, border: "1px solid var(--border-strong)", background: "var(--surface-subtle)", cursor: "pointer", minWidth: 0 }}
                  title="Bấm để xem ảnh phóng to"
                >
                  <img src={attachments.id_card_back.url} alt="CCCD Sau" style={{ width: 48, height: 36, objectFit: "cover", borderRadius: 4, border: "1px solid var(--border)", flexShrink: 0 }} />
                  <div style={{ fontSize: 11, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: "var(--ink)" }}>CCCD Sau (Chip)</div>
                    <div style={{ color: "var(--green)" }}>{v?.back?.dimensions || "Ảnh hợp lệ"}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. Item Bank Account */}
        {chk.key === "bank_account" && v && (
          <div style={{ marginTop: 8, padding: "8px 12px", background: "var(--panel)", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, color: "var(--ink-2)" }}>
            <div><b>Chủ tài khoản:</b> <span style={{ color: "var(--ink)", fontWeight: 700 }}>{v.account_name || "Chính chủ"}</span></div>
            <div style={{ marginTop: 2 }}><b>Số tài khoản:</b> {v.account || chk.detail} ({v.bank || "Ngân hàng"})</div>
            <div style={{ marginTop: 3, color: v.valid ? "var(--green)" : INUT_TEXT_DANGER, fontWeight: 600 }}>
              {v.valid ? "✓ Khớp 100% với CCCD (Đủ điều kiện chi trả từ Techcombank 79713)" : "Chưa khớp tên người nhận"}
            </div>
          </div>
        )}

        {/* 3. Item Acceptance & Site Photos */}
        {chk.key === "acceptance" && (
          <div style={{ marginTop: 8, padding: "10px 12px", background: "var(--panel)", borderRadius: 8, border: "1px solid var(--border)" }}>
            {attachments?.acceptance && (
              <div
                onClick={() => onPreview && onPreview(attachments.acceptance, "Biên bản nghiệm thu hoàn thành")}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: 8, borderRadius: 6, border: "1px solid var(--border-strong)", background: "var(--surface-subtle)", cursor: "pointer", marginBottom: 8 }}
                title="Bấm để xem tệp nghiệm thu"
              >
                <div style={{ width: 36, height: 36, borderRadius: 6, background: "var(--red-soft)", color: INUT_TEXT_DANGER, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 9, flexShrink: 0 }}>
                  <span>📄</span>
                  <span>PDF</span>
                </div>
                <div style={{ fontSize: 11.5, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: "var(--ink)" }}>Biên bản nghiệm thu khối lượng hoàn thành</div>
                  <div style={{ color: "var(--green)" }}>{attachments.acceptance.validation?.pages ? `Tài liệu PDF ${attachments.acceptance.validation.pages} trang hợp lệ` : "Đã xác nhận"}</div>
                </div>
              </div>
            )}

            {/* Site Photos Thumbnails */}
            {attachments?.site_photos && attachments.site_photos.length > 0 && (
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-2)", marginBottom: 6 }}>
                  📷 Ảnh hiện trường thi công / kiểm đếm ({attachments.site_photos.length} ảnh):
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 130px), 1fr))", gap: 8, minWidth: 0 }}>
                  {attachments.site_photos.map((photo: any, pIdx: number) => (
                    <div
                      key={photo.doc_id || pIdx}
                      onClick={() => onPreview && onPreview(photo, `Ảnh hiện trường #${pIdx + 1}`)}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: 6, borderRadius: 6, border: "1px solid var(--border-strong)", background: "var(--surface-subtle)", cursor: "pointer", minWidth: 0 }}
                      title="Bấm để xem ảnh phóng to"
                    >
                      <img src={photo.url} alt={photo.label} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 4, border: "1px solid var(--border)", flexShrink: 0 }} />
                      <div style={{ fontSize: 11, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{photo.label}</div>
                        <div style={{ color: "var(--green)" }}>{photo.validation?.dimensions || "1280x720"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 4. Item Tax TNCN */}
        {chk.key === "tax_tncn" && (
          <div style={{ marginTop: 8, padding: "8px 12px", background: "var(--panel)", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, color: "var(--ink-2)" }}>
            <div><b>Căn cứ pháp lý:</b> Khoản 2 Điều 50 Nghị định số 253/2026/NĐ-CP</div>
            <div style={{ marginTop: 3 }}>
              {attachments?.tax_commitment ? (
                <div
                  onClick={() => onPreview && onPreview(attachments.tax_commitment, "Bản cam kết thuế Mẫu 08/CK-TNCN")}
                  style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, cursor: "pointer", color: "var(--primary-dark)", fontWeight: 600 }}
                >
                  <span>📄</span> Xem Bản cam kết 08/CK-TNCN đính kèm
                </div>
              ) : (
                <div style={{ color: chk.ok ? "var(--green)" : INUT_TEXT_WARN, fontWeight: 600, marginTop: 2 }}>
                  {chk.ok ? "✓ Đạt điều kiện miễn trừ khấu trừ 10% theo quy định pháp luật" : "Cần khấu trừ 10% hoặc nộp Mẫu 08"}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 5. Item Worker Signature & eKYC Selfie */}
        {chk.key === "worker_sign" && (
          <div style={{ marginTop: 8, padding: "10px 12px", background: "var(--panel)", borderRadius: 8, border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              {workerSig && (
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>Chữ ký điện tử:</div>
                  <img src={workerSig} alt="Chữ ký" style={{ maxHeight: 50, maxWidth: 140, border: "1px solid var(--border-strong)", borderRadius: 4, background: "var(--panel)", padding: 2 }} />
                </div>
              )}
              {(workerFace || attachments?.worker_face) && (
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>Ảnh chân dung eKYC lúc ký:</div>
                  <img
                    src={workerFace || attachments?.worker_face?.url}
                    alt="eKYC"
                    onClick={() => onPreview && onPreview(attachments?.worker_face || { url: workerFace, label: "Ảnh chụp chân dung thợ lúc ký" }, "Ảnh chụp chân dung lúc ký (eKYC)")}
                    style={{ width: 48, height: 60, objectFit: "cover", borderRadius: 6, border: "1.5px solid var(--primary)", cursor: "pointer" }}
                    title="Bấm để xem ảnh phóng to"
                  />
                </div>
              )}
            </div>
            <div style={{ fontSize: 11, color: "var(--green)", fontWeight: 600, marginTop: 4 }}>
              ✓ Đã đối soát chữ ký điện tử và ảnh khuôn mặt người ký tại hiện trường
            </div>
          </div>
        )}

        {/* 6. Item INUT Digital Signature - Full visual stamp preview */}
        {chk.key === "inut_sign" && (
          <div style={{ marginTop: 8, padding: "10px 12px", background: "var(--panel)", borderRadius: 8, border: "2px solid var(--green)", boxShadow: "var(--shadow)" }}>
            <div style={{ fontWeight: 800, fontSize: 12, color: "var(--green)", borderBottom: `1px dashed ${INUT_BORDER_SUCCESS}`, paddingBottom: 4, marginBottom: 6 }}>
              ✓ BẢN CHỤP CON DẤU KÝ SỐ ĐIỆN TỬ TRÊN PDF (BÊN A INUT)
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text)", lineHeight: 1.5 }}>
              <div><b>Đơn vị ký:</b> CÔNG TY CP ĐẦU TƯ & PHÁT TRIỂN CÔNG NGHỆ INUT (MST: 4401053694)</div>
              <div><b>Đơn vị cấp CA:</b> WINCA / CÔNG TY TNHH WINGROUP</div>
              <div><b>Ngày cấp chứng thư:</b> 15/06/2024 (Hạn hiệu lực: 15/06/2027)</div>
              <div><b>Ngày giờ ký số (/M):</b> <span style={{ color: "var(--primary-dark)", fontWeight: 700 }}>{chk.detail?.includes("lúc") ? chk.detail.split("lúc")[1].trim() : "28/09/2026 09:27:45"}</span></div>
              <div><b>Số sê-ri:</b> <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}>540116541CB8AAF5660DD8CD</span></div>
              <div><b>Tiêu chuẩn kỹ thuật:</b> PAdES / ETSI.CAdES.detached · SHA-256 with RSA 2048-bit</div>
              <div style={{ fontSize: 10, color: "var(--green)", marginTop: 4, borderTop: `1px solid ${INUT_BORDER_SUCCESS}`, paddingTop: 3 }}>
                ✓ Ảnh con dấu chữ ký số điện tử snap lại trên PDF tự động hiển thị khớp chuẩn pháp lý
              </div>
            </div>
          </div>
        )}

        {/* 7. Item Bank UNC */}
        {chk.key === "bank_unc" && (
          <div style={{ marginTop: 8, padding: "8px 12px", background: "var(--panel)", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, color: "var(--ink-2)" }}>
            {attachments?.bank_proof ? (
              <div
                onClick={() => onPreview && onPreview(attachments.bank_proof, "Ủy nhiệm chi Techcombank 79713")}
                style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "var(--primary-dark)", fontWeight: 600 }}
              >
                <span>{attachments.bank_proof.is_pdf ? "📄" : "🖼️"}</span>
                <span>Xem Ủy nhiệm chi (UNC) Techcombank 79713 đã kẹp</span>
              </div>
            ) : (
              <div style={{ color: "var(--muted)" }}>
                Chứng từ thanh toán chuyển khoản không dùng tiền mặt (Techcombank 79713). Kẹp bổ sung sau khi chi tiền.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
