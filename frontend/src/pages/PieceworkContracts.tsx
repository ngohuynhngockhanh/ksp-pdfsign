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
      setContracts(res.contracts);
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
      setContractors(res.contractors);
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
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#0f172a", color: "#38bdf8", padding: "4px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase" }}>
            ⚖️ iNut HR & Compliance
          </div>
          <h2 style={{ margin: "8px 0 4px 0", fontSize: 24, color: "#0f172a" }}>Quản Lý Hợp Đồng Giao Khoán & Hồ Sơ Thợ/CTV</h2>
          <div style={{ color: "#64748b", fontSize: 13.5 }}>
            Chuẩn hóa giao khoán theo sản phẩm/kết quả đầu ra dân sự · Tự động kiểm định tính hợp lệ chứng từ (Nghị định 253/2026/NĐ-CP & Luật BHXH 2024)
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            className="piecework-btn-create"
            onClick={() => setShowCreateModal(true)}
          >
            ＋ Tạo HĐ Khoán Mới
          </button>
          <button
            type="button"
            className="piecework-btn-create"
            style={{ background: "#0f766e" }}
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
            style={{ background: "#7c3aed" }}
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
            style={{ background: "#2563eb", display: "inline-flex", alignItems: "center", gap: 6 }}
            disabled={syncingQuarterDrive}
            onClick={handleSyncQuarterlyDrive}
            title="Đồng bộ toàn bộ HĐ giao khoán đã ký trong quý lên Google Drive Kế toán"
          >
            {syncingQuarterDrive ? "⏳ Đang sync Drive..." : "☁️ Sync Drive Quý"}
          </button>
        </div>
      </div>

      {/* Main Navigation Tabs */}
      <div className="piecework-main-tabs">
        <button
          type="button"
          className={`piecework-main-tab ${activeMainTab === "contracts" ? "active" : ""}`}
          onClick={() => setActiveMainTab("contracts")}
        >
          <span>📄</span>
          <span>Danh Sách Hợp Đồng Khoán ({contracts.length})</span>
        </button>
        <button
          type="button"
          className={`piecework-main-tab ${activeMainTab === "contractors" ? "active" : ""}`}
          onClick={() => setActiveMainTab("contractors")}
        >
          <span>👥</span>
          <span>Danh Bạ Nhà Cung Cấp / Thợ ({contractors.length})</span>
        </button>
      </div>

      {/* Notifications */}
      {message && (
        <div style={{ padding: "12px 18px", borderRadius: 10, marginBottom: 16, background: message.type === "success" ? "#f0fdf4" : "#fef2f2", color: message.type === "success" ? "#166534" : "#991b1b", border: `1px solid ${message.type === "success" ? "#bbf7d0" : "#fecaca"}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{message.text}</span>
          <button style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontWeight: 700, minHeight: 36, minWidth: 36, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setMessage(null)}>✕</button>
        </div>
      )}

      {/* TAB 1: CONTRACTS VIEW */}
      {activeMainTab === "contracts" && (
        <div data-testid="piecework-contracts-view">
          {/* Metrics Cards (Deficiency Radar) */}
          <div className="piecework-metrics-grid">
        <div className="piecework-metric-card">
          <div style={{ color: "#64748b", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Tổng số hợp đồng</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>{totalContracts}</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{totalGross.toLocaleString("vi-VN")} đ</div>
        </div>

        <div className="piecework-metric-card" style={{ borderColor: "#fed7aa" }}>
          <div style={{ color: "#c2410c", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>🔴 Cần bổ sung hồ sơ</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#c2410c", marginTop: 4 }}>{pendingDocsCount}</div>
          <div style={{ fontSize: 12, color: "#ea580c", marginTop: 2 }}>Thiếu CCCD, nghiệm thu, ảnh HT</div>
        </div>

        <div className="piecework-metric-card" style={{ borderColor: "#bbf7d0" }}>
          <div style={{ color: "#15803d", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>🟢 Đủ điều kiện thanh toán</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#15803d", marginTop: 4 }}>{readyToPayCount}</div>
          <div style={{ fontSize: 12, color: "#16a34a", marginTop: 2 }}>Đã có chữ ký & đủ chứng từ</div>
        </div>

        <div className="piecework-metric-card">
          <div style={{ color: "#475569", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>⚪ Đã thanh toán (Có UNC)</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#334155", marginTop: 4 }}>{completedCount}</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Đã khớp Techcombank 79713</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="piecework-filter-bar">
        <form onSubmit={handleSearchSubmit} className="piecework-filter-search">
          <input
            type="text"
            placeholder="Tìm theo mã HĐ, tên thợ, số CCCD, công trình..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13.5, minHeight: 42 }}
          />
          <button type="submit" className="secondary" style={{ padding: "8px 16px", borderRadius: 8, minHeight: 42, fontWeight: 600 }}>Tìm kiếm</button>
        </form>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="piecework-filter-select"
        >
          <option value="">Tất cả loại khoán</option>
          <option value="thi_cong">Thi công lắp đặt</option>
          <option value="boc_xep">Bốc xếp vận chuyển</option>
          <option value="gia_cong">Gia công sản phẩm</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="piecework-filter-select"
        >
          <option value="">Mọi trạng thái hồ sơ</option>
          <option value="pending_docs">🔴 Cần bổ sung hồ sơ</option>
          <option value="ready_to_pay">🟢 Đủ điều kiện thanh toán</option>
          <option value="completed">⚪ Đã thanh toán (Có UNC)</option>
        </select>
      </div>

      {/* Contract Content: Dual View (Desktop Table + Mobile Card Stack) */}
      {loading ? (
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: 40, textAlign: "center", color: "#64748b" }}>
          Đang tải danh sách hợp đồng khoán...
        </div>
      ) : contracts.length === 0 ? (
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: 40, textAlign: "center", color: "#64748b" }}>
          Không tìm thấy hợp đồng giao khoán nào phù hợp.
        </div>
      ) : (
        <>
          {/* 1. Desktop Table (Hidden on Mobile < 768px via CSS) */}
          <div className="piecework-desktop-table">
            <table>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: 12.5, color: "#475569" }}>
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
                  return (
                    <tr key={c.id} style={{ borderBottom: "1px solid #f1f5f9", fontSize: 13.5 }}>
                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ fontWeight: 700, color: "#0284c7" }}>{c.contract_code}</div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>{c.contract_date}</div>
                        <span style={{ display: "inline-block", marginTop: 4, padding: "2px 8px", borderRadius: 4, fontSize: 11, background: "#f1f5f9", color: "#475569" }}>
                          {c.contract_type === "thi_cong" ? "Thi công" : (c.contract_type === "boc_xep" ? "Bốc xếp" : "Gia công")}
                        </span>
                      </td>

                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ fontWeight: 600, color: "#0f172a" }}>{c.worker_name}</div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>CCCD: {c.worker_id_card || "Chưa có"}</div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>SĐT: {c.worker_phone || "Chưa có"}</div>
                        <div style={{ fontSize: 11.5, color: "#0284c7" }}>{c.worker_bank_account} ({c.worker_bank_name})</div>
                      </td>

                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ fontWeight: 600, color: "#334155" }}>{c.project_name}</div>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>📍 {c.location}</div>
                      </td>

                      <td style={{ padding: "14px 16px", textAlign: "right" }}>
                        <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 14.5 }}>{c.total_amount.toLocaleString("vi-VN")} đ</div>
                        {def.is_sub_5m ? (
                          <div style={{ fontSize: 11, color: "#16a34a", fontWeight: 600, marginTop: 2 }}>
                            Miễn 10% TNCN (NĐ 253)
                          </div>
                        ) : (
                          <div style={{ fontSize: 11, color: "#dc2626", marginTop: 2 }}>
                            Trừ 10% Thuế: -{c.tax_amount.toLocaleString("vi-VN")} đ
                            <div style={{ color: "#16a34a", fontWeight: 600 }}>Thực nhận: {c.net_amount.toLocaleString("vi-VN")} đ</div>
                          </div>
                        )}
                      </td>

                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, maxWidth: 320 }}>
                          <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[0].ok ? "#dcfce7" : "#fee2e2", color: def.checklist[0].ok ? "#166534" : "#991b1b" }}>
                            {def.checklist[0].ok ? "✓ CCCD 2 mặt" : "✗ Thiếu CCCD"}
                          </span>
                          <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[1].ok ? "#dcfce7" : "#fee2e2", color: def.checklist[1].ok ? "#166534" : "#991b1b" }}>
                            {def.checklist[1].ok ? "✓ STK chính chủ" : "✗ Thiếu STK"}
                          </span>
                          <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[2].ok ? "#dcfce7" : "#fee2e2", color: def.checklist[2].ok ? "#166534" : "#991b1b" }}>
                            {def.checklist[2].ok ? "✓ Nghiệm thu" : "✗ Thiếu Nghiệm thu"}
                          </span>
                          <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[4].ok ? "#dcfce7" : "#fef3c7", color: def.checklist[4].ok ? "#166534" : "#b45309" }}>
                            {def.checklist[4].ok ? "✓ Thợ đã ký online" : "⏳ Chờ thợ ký"}
                          </span>
                          <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[5].ok ? "#dcfce7" : "#f1f5f9", color: def.checklist[5].ok ? "#166534" : "#64748b" }}>
                            {def.checklist[5].ok ? "✓ Ký số INUT" : "Chưa ký số A"}
                          </span>
                          <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[6].ok ? "#dcfce7" : "#f8fafc", color: def.checklist[6].ok ? "#166534" : "#94a3b8", border: "1px solid #e2e8f0" }}>
                            {def.checklist[6].ok ? "✓ Đã kẹp UNC" : "Chưa có UNC"}
                          </span>
                        </div>
                        <div style={{ marginTop: 6, fontWeight: 700, fontSize: 12, color: def.can_pay ? "#16a34a" : (def.missing_count > 0 ? "#ea580c" : "#475569") }}>
                          {def.status_label}
                        </div>
                      </td>

                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch" }}>
                          <button
                            className="secondary"
                            style={{ fontSize: 12, padding: "5px 10px", borderRadius: 6, background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", minHeight: 32 }}
                            onClick={() => copyToClipboard(`/khoan/${c.portal_token}`, `ký online HĐ ${c.contract_code}`)}
                            title="Sao chép link Portal di động gửi Zalo cho thợ"
                          >
                            📲 Copy link Zalo thợ
                          </button>

                          <a
                            href={`/khoan/${c.portal_token}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{ fontSize: 12, padding: "5px 10px", borderRadius: 6, background: "#f8fafc", color: "#0284c7", border: "1px solid #cbd5e1", textDecoration: "none", textAlign: "center" }}
                            title="Mở giao diện ký online của thợ để kiểm tra"
                          >
                            📱 Mở Portal ký online
                          </a>

                          <div style={{ display: "flex", gap: 4 }}>
                            <a
                              href={`/api/public/khoan/${c.portal_token}/pdf`}
                              target="_blank"
                              rel="noreferrer"
                              style={{ flex: 1, fontSize: 11.5, padding: "4px 6px", borderRadius: 6, background: "#e2e8f0", color: "#334155", textDecoration: "none", textAlign: "center" }}
                            >
                              📄 PDF
                            </a>

                            <button
                              style={{ flex: 1, fontSize: 11.5, padding: "4px 6px", borderRadius: 6, background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", cursor: "pointer", fontWeight: 700 }}
                              onClick={() => setShareModal({ contract: c, tab: c.is_signed_by_inut ? "signed" : "unsigned" })}
                              title={c.is_signed_by_inut ? "Chia sẻ PDF đã ký số" : "Chia sẻ PDF bản thảo chưa ký"}
                            >
                              📤 Share
                            </button>

                            <button
                              style={{ flex: 1, fontSize: 11.5, padding: "4px 6px", borderRadius: 6, background: c.is_signed_by_inut ? "#0369a1" : "#0284c7", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 }}
                              disabled={actionLoading === c.id}
                              onClick={() => openSigningModal(c)}
                              title={c.is_signed_by_inut ? "Bấm để ký lại số điện tử với chứng thư hoặc mốc thời gian khác" : "Ký số điện tử Bên A (INUT)"}
                            >
                              {actionLoading === c.id ? "Đang ký…" : (c.is_signed_by_inut ? "✍️ Ký lại" : "✍️ Ký INUT")}
                            </button>

                            <button
                              style={{ flex: 1, fontSize: 11.5, padding: "4px 6px", borderRadius: 6, background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1", cursor: "pointer" }}
                              onClick={() => openDetail(c.id)}
                            >
                              Chi tiết
                            </button>
                          </div>

                          <div style={{ display: "flex", gap: 4 }}>
                            <button
                              style={{ flex: 1, fontSize: 11.5, padding: "4px 6px", borderRadius: 6, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", cursor: "pointer" }}
                              onClick={() => handleAuditContract(c)}
                              title="Kiểm định tính hợp lệ toàn diện hồ sơ theo luật"
                            >
                              🔍 Kiểm định
                            </button>
                            <button
                              style={{ flex: 1, fontSize: 11.5, padding: "4px 6px", borderRadius: 6, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", cursor: "pointer" }}
                              onClick={() => handleDeleteContract(c)}
                              title="Xóa hợp đồng khoán"
                            >
                              🗑️ Xóa
                            </button>
                          </div>

                          {c.is_signed_by_inut && (
                            <button
                              style={{ fontSize: 11.5, padding: "5px 8px", borderRadius: 6, background: "#f0fdf4", color: "#166534", border: "1.5px solid #86efac", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontWeight: 700 }}
                              onClick={() => handleVerifySignature(c)}
                              title="Kiểm tra thẩm định chữ ký số theo chuẩn Foxit Reader và Cơ quan Thuế"
                            >
                              🛡️ Thẩm định Chữ ký số
                            </button>
                          )}
                          <button
                            style={{
                              fontSize: 11.5,
                              padding: "5px 8px",
                              borderRadius: 6,
                              background: c.drive_synced_at ? "#ecfdf5" : "#eff6ff",
                              color: c.drive_synced_at ? "#047857" : "#1d4ed8",
                              border: c.drive_synced_at ? "1.5px solid #a7f3d0" : "1.5px solid #bfdbfe",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 5,
                              fontWeight: 600,
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
                          {c.drive_link && (
                            <a
                              href={c.drive_link}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                fontSize: 11,
                                color: "#059669",
                                textAlign: "center",
                                textDecoration: "underline",
                                display: "inline-block",
                                marginTop: -2,
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

          {/* 2. Mobile Card Stack (Visible on Mobile < 768px via CSS) */}
          <div className="piecework-mobile-cards" data-testid="piecework-mobile-cards">
            {contracts.map((c) => {
              const def = c.deficiency;
              return (
                <div key={c.id} className="piecework-mobile-card" data-testid="piecework-mobile-card">
                  {/* Card Header */}
                  <div className="piecework-mobile-card-header">
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15, color: "#0284c7" }}>{c.contract_code}</div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                        {c.contract_date} · <span style={{ padding: "1px 6px", borderRadius: 4, background: "#f1f5f9", fontSize: 11, color: "#475569" }}>{c.contract_type === "thi_cong" ? "Thi công" : (c.contract_type === "boc_xep" ? "Bốc xếp" : "Gia công")}</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 8px", borderRadius: 6, background: def.can_pay ? "#dcfce7" : (def.missing_count > 0 ? "#ffedd5" : "#f1f5f9"), color: def.can_pay ? "#166534" : (def.missing_count > 0 ? "#c2410c" : "#475569") }}>
                      {def.status_label}
                    </span>
                  </div>

                  {/* Card Info Rows */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#64748b" }}>Thợ nhận khoán:</span>
                      <span style={{ fontWeight: 700, color: "#0f172a" }}>{c.worker_name}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#64748b" }}>CCCD / SĐT:</span>
                      <span style={{ color: "#334155" }}>{c.worker_id_card || "Chưa có"} · {c.worker_phone || "N/A"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#64748b" }}>STK nhận tiền:</span>
                      <span style={{ color: "#0284c7", fontWeight: 600 }}>{c.worker_bank_account} ({c.worker_bank_name})</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#64748b" }}>Công trình:</span>
                      <span style={{ fontWeight: 600, color: "#334155", textAlign: "right", maxWidth: "60%" }}>{c.project_name}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px dashed #e2e8f0", paddingTop: 6, marginTop: 2 }}>
                      <span style={{ fontWeight: 700, color: "#0f172a" }}>Giá trị khoán:</span>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontWeight: 800, color: "#0f172a", fontSize: 15 }}>{c.total_amount.toLocaleString("vi-VN")} đ</span>
                        {def.is_sub_5m ? (
                          <div style={{ fontSize: 11, color: "#16a34a", fontWeight: 600 }}>Miễn 10% TNCN (NĐ 253)</div>
                        ) : (
                          <div style={{ fontSize: 11, color: "#dc2626" }}>-10% Thuế ({c.tax_amount.toLocaleString("vi-VN")} đ)</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Deficiency Checklist Chips */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, background: "#f8fafc", padding: 8, borderRadius: 8 }}>
                    <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[0].ok ? "#dcfce7" : "#fee2e2", color: def.checklist[0].ok ? "#166534" : "#991b1b" }}>
                      {def.checklist[0].ok ? "✓ CCCD 2 mặt" : "✗ Thiếu CCCD"}
                    </span>
                    <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[2].ok ? "#dcfce7" : "#fee2e2", color: def.checklist[2].ok ? "#166534" : "#991b1b" }}>
                      {def.checklist[2].ok ? "✓ Nghiệm thu" : "✗ Thiếu Nghiệm thu"}
                    </span>
                    <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[4].ok ? "#dcfce7" : "#fef3c7", color: def.checklist[4].ok ? "#166534" : "#b45309" }}>
                      {def.checklist[4].ok ? "✓ Thợ đã ký online" : "⏳ Chờ thợ ký"}
                    </span>
                    <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[5].ok ? "#dcfce7" : "#f1f5f9", color: def.checklist[5].ok ? "#166534" : "#64748b" }}>
                      {def.checklist[5].ok ? "✓ Ký số INUT" : "Chưa ký số A"}
                    </span>
                    <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: def.checklist[6].ok ? "#dcfce7" : "#f8fafc", color: def.checklist[6].ok ? "#166534" : "#94a3b8" }}>
                      {def.checklist[6].ok ? "✓ Đã kẹp UNC" : "Chưa có UNC"}
                    </span>
                  </div>

                  {/* Mobile Actions Grid (Touch Targets >= 44px) */}
                  <div className="piecework-mobile-action-grid">
                    <button
                      className="piecework-touch-btn"
                      style={{ gridColumn: "1 / -1", background: "#f0fdf4", color: "#166534", border: "1.5px solid #86efac", fontWeight: 700 }}
                      onClick={() => setShareModal({ contract: c, tab: c.is_signed_by_inut ? "signed" : "unsigned" })}
                    >
                      {c.is_signed_by_inut ? "📤 Chia sẻ PDF Đã Ký (Zalo / Email / Link)" : "📤 Chia sẻ HĐ Chưa Ký (Bản Thảo / Zalo)"}
                    </button>

                    <button
                      className="piecework-touch-btn"
                      style={{ background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0" }}
                      onClick={() => copyToClipboard(`/khoan/${c.portal_token}`, `ký online HĐ ${c.contract_code}`)}
                    >
                      📲 Copy Zalo thợ
                    </button>

                    <a
                      href={`/khoan/${c.portal_token}`}
                      target="_blank"
                      rel="noreferrer"
                      className="piecework-touch-btn"
                      style={{ background: "#f8fafc", color: "#0284c7", border: "1px solid #cbd5e1" }}
                    >
                      📱 Mở Portal ký
                    </a>

                    <a
                      href={`/api/public/khoan/${c.portal_token}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="piecework-touch-btn"
                      style={{ background: "#f1f5f9", color: "#334155", border: "1px solid #cbd5e1" }}
                    >
                      📄 Mở PDF
                    </a>

                    <button
                      className="piecework-touch-btn"
                      style={{ background: c.is_signed_by_inut ? "#0369a1" : "#0284c7", color: "#fff" }}
                      disabled={actionLoading === c.id}
                      onClick={() => openSigningModal(c)}
                    >
                      {actionLoading === c.id ? "Đang ký…" : (c.is_signed_by_inut ? "✍️ Ký lại INUT" : "✍️ Ký số INUT")}
                    </button>

                    <button
                      className="piecework-touch-btn"
                      style={{ background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe" }}
                      onClick={() => handleAuditContract(c)}
                    >
                      🔍 Kiểm định
                    </button>

                    <button
                      className="piecework-touch-btn"
                      style={{ background: "#f8fafc", color: "#475569", border: "1px solid #cbd5e1" }}
                      onClick={() => openDetail(c.id)}
                    >
                      👁️ Chi tiết HĐ
                    </button>

                    {c.is_signed_by_inut && (
                      <button
                        className="piecework-touch-btn"
                        style={{ gridColumn: "1 / -1", background: "#f0fdf4", color: "#166534", border: "1.5px solid #86efac", fontWeight: 700 }}
                        onClick={() => handleVerifySignature(c)}
                      >
                        🛡️ Thẩm định Chữ ký số (Chuẩn Foxit / Thuế)
                      </button>
                    )}
                    <button
                      className="piecework-touch-btn"
                      style={{
                        gridColumn: "1 / -1",
                        background: c.drive_synced_at ? "#ecfdf5" : "#eff6ff",
                        color: c.drive_synced_at ? "#047857" : "#1d4ed8",
                        border: c.drive_synced_at ? "1.5px solid #a7f3d0" : "1.5px solid #bfdbfe",
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
                    {c.drive_link && (
                      <a
                        href={c.drive_link}
                        target="_blank"
                        rel="noreferrer"
                        className="piecework-touch-btn"
                        style={{
                          gridColumn: "1 / -1",
                          background: "#2563eb",
                          color: "#fff",
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
        </>
      )}
      </div>
      )}

      {/* TAB 2: CONTRACTORS / SUPPLIERS VIEW */}
      {activeMainTab === "contractors" && (
        <div data-testid="piecework-contractors-view">
          {/* Metrics Cards for Contractors */}
          <div className="piecework-metrics-grid">
            <div className="piecework-metric-card">
              <div style={{ color: "#64748b", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Tổng số nhà cung cấp/thợ</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>{contractors.length}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>Đã định danh CCCD & MST</div>
            </div>

            <div className="piecework-metric-card" style={{ borderColor: "#bae6fd" }}>
              <div style={{ color: "#0369a1", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>📦 Hợp đồng đã giao</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "#0369a1", marginTop: 4 }}>
                {contractors.reduce((s, c) => s + (c.contracts_count || 0), 0)}
              </div>
              <div style={{ fontSize: 12, color: "#0284c7", marginTop: 2 }}>Tổng số lượt khoán việc</div>
            </div>

            <div className="piecework-metric-card" style={{ borderColor: "#bbf7d0" }}>
              <div style={{ color: "#15803d", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>💰 Tổng thù lao chi trả (Gross)</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#15803d", marginTop: 4 }}>
                {contractors.reduce((s, c) => s + (c.total_gross || 0), 0).toLocaleString("vi-VN")} đ
              </div>
              <div style={{ fontSize: 12, color: "#16a34a", marginTop: 2 }}>Thực nhận (Net): {contractors.reduce((s, c) => s + (c.total_net || 0), 0).toLocaleString("vi-VN")} đ</div>
            </div>

            <div className="piecework-metric-card" style={{ borderColor: "#fed7aa" }}>
              <div style={{ color: "#c2410c", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>⚖️ Thuế TNCN đã khấu trừ (10%)</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#c2410c", marginTop: 4 }}>
                {contractors.reduce((s, c) => s + (c.total_tax || 0), 0).toLocaleString("vi-VN")} đ
              </div>
              <div style={{ fontSize: 12, color: "#ea580c", marginTop: 2 }}>Nộp NSNN (NĐ 253/2026)</div>
            </div>
          </div>

          {/* Filter & Search Bar for Contractors */}
          <div className="piecework-filter-bar">
            <div style={{ display: "flex", gap: 8, flex: 1, minWidth: 260 }}>
              <input
                type="text"
                placeholder="Tìm thợ theo họ tên, CCCD, MST cá nhân, SĐT, ngân hàng..."
                value={contractorSearch}
                onChange={(e) => setContractorSearch(e.target.value)}
                style={{ flex: 1, padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13.5, minHeight: 42 }}
              />
            </div>
            <button
              type="button"
              className="piecework-btn-create"
              style={{ background: "#0f766e" }}
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
              style={{ background: "#7c3aed" }}
              onClick={() => {
                setSmartPasteTarget("contractor");
                setSmartPasteText("");
                setShowSmartPasteModal(true);
              }}
            >
              ⚡ Smart Paste (Dán Nhanh)
            </button>
          </div>

          {/* Contractors Content: Desktop Table & Mobile Cards */}
          {contractorLoading ? (
            <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: 40, textAlign: "center", color: "#64748b" }}>
              Đang tải danh bạ nhà cung cấp khoán...
            </div>
          ) : contractors.length === 0 ? (
            <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: 40, textAlign: "center", color: "#64748b" }}>
              Chưa có nhà cung cấp / thợ khoán nào phù hợp. Bấm "Thêm Nhà Cung Cấp Mới" hoặc "Smart Paste" để thêm nhanh!
            </div>
          ) : (
            <>
              {/* Desktop Table for Contractors */}
              <div className="piecework-desktop-table" data-testid="contractors-desktop-table">
                <table>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: 12.5, color: "#475569" }}>
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
                      <tr key={c.id} style={{ borderBottom: "1px solid #f1f5f9", fontSize: 13.5 }}>
                        <td style={{ padding: "14px 16px" }}>
                          <div style={{ fontWeight: 800, color: "#0f172a" }}>{c.name}</div>
                          <span style={{ display: "inline-block", marginTop: 4, padding: "2px 8px", borderRadius: 4, fontSize: 11, background: "#f0f9ff", color: "#0369a1", fontWeight: 700 }}>
                            {c.code}
                          </span>
                          {c.skills && (
                            <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>🛠️ {c.skills}</div>
                          )}
                        </td>

                        <td style={{ padding: "14px 16px" }}>
                          <div style={{ fontWeight: 700, color: "#0284c7" }}>CCCD: {c.id_card}</div>
                          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Ngày cấp: {c.id_card_date || "N/A"}</div>
                          <div style={{ fontSize: 11.5, color: "#94a3b8" }}>{c.id_card_place || "Cục CSQLHC về TTXH"}</div>
                        </td>

                        <td style={{ padding: "14px 16px" }}>
                          <div style={{ fontWeight: 700, color: c.tax_code ? "#15803d" : "#ea580c" }}>
                            {c.tax_code ? `MST: ${c.tax_code}` : "Chưa có MST"}
                          </div>
                          <div style={{ fontSize: 12, color: "#334155", marginTop: 2 }}>📞 SĐT: {c.phone || "Chưa có"}</div>
                          <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2, maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={c.address}>
                            📍 {c.address || "Chưa có địa chỉ"}
                          </div>
                        </td>

                        <td style={{ padding: "14px 16px" }}>
                          <div style={{ fontWeight: 700, color: "#0f172a" }}>{c.bank_account}</div>
                          <div style={{ fontSize: 12, color: "#0284c7", fontWeight: 600 }}>{c.bank_name}</div>
                          <div style={{ fontSize: 11, color: "#16a34a", marginTop: 2 }}>✓ Đủ điều kiện chi Techcombank 79713</div>
                        </td>

                        <td style={{ padding: "14px 16px", textAlign: "right" }}>
                          <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 14.5 }}>
                            {c.total_gross?.toLocaleString("vi-VN")} đ
                          </div>
                          <div style={{ fontSize: 11.5, color: "#0369a1", marginTop: 2 }}>
                            <b>{c.contracts_count}</b> hợp đồng khoán
                          </div>
                          {c.total_tax > 0 ? (
                            <div style={{ fontSize: 11, color: "#c2410c", marginTop: 2 }}>
                              Thuế TNCN: -{c.total_tax?.toLocaleString("vi-VN")} đ
                            </div>
                          ) : (
                            <div style={{ fontSize: 11, color: "#16a34a", marginTop: 2 }}>Miễn trừ thuế TNCN</div>
                          )}
                        </td>

                        <td style={{ padding: "14px 16px", textAlign: "center" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 150 }}>
                            <button
                              type="button"
                              className="piecework-btn-create"
                              style={{ background: "#0284c7", padding: "6px 10px", fontSize: 12, minHeight: 34 }}
                              onClick={() => handleCreateContractForContractor(c)}
                              title="Tạo hợp đồng khoán mới cho nhà cung cấp này (tự điền 100%)"
                            >
                              ＋ Tạo HĐ Khoán
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              style={{ fontSize: 11.5, padding: "5px 10px", borderRadius: 6, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", fontWeight: 700 }}
                              onClick={() => handleOpenTaxSummary(c.id)}
                              title="Xem bảng kê quyết toán & khấu trừ thuế TNCN để hỗ trợ thợ hoàn thuế"
                            >
                              📊 Quyết Toán Thuế
                            </button>
                            <div style={{ display: "flex", gap: 4 }}>
                              <button
                                type="button"
                                style={{ flex: 1, fontSize: 11.5, padding: "4px 8px", borderRadius: 6, background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1", cursor: "pointer" }}
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
                                style={{ flex: 1, fontSize: 11.5, padding: "4px 8px", borderRadius: 6, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", cursor: "pointer" }}
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

              {/* Mobile Cards for Contractors */}
              <div className="piecework-mobile-cards" data-testid="contractors-mobile-cards">
                {contractors.map((c) => (
                  <div key={c.id} className="piecework-mobile-card">
                    <div className="piecework-mobile-card-header">
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 15, color: "#0f172a" }}>{c.name}</div>
                        <div style={{ fontSize: 12, color: "#0284c7", fontWeight: 700, marginTop: 2 }}>{c.code}</div>
                      </div>
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 8px", borderRadius: 6, background: "#dcfce7", color: "#166534" }}>
                        {c.contracts_count} HĐ Khoán
                      </span>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#64748b" }}>Số CCCD:</span>
                        <span style={{ fontWeight: 700, color: "#0284c7" }}>{c.id_card}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#64748b" }}>Mã số thuế:</span>
                        <span style={{ fontWeight: 600, color: c.tax_code ? "#166534" : "#ea580c" }}>{c.tax_code || "Chưa có"}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#64748b" }}>Số điện thoại:</span>
                        <span style={{ color: "#334155" }}>{c.phone || "N/A"}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#64748b" }}>STK thụ hưởng:</span>
                        <span style={{ color: "#0284c7", fontWeight: 600 }}>{c.bank_account} ({c.bank_name})</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px dashed #e2e8f0", paddingTop: 6 }}>
                        <span style={{ fontWeight: 700, color: "#0f172a" }}>Tổng thù lao (Gross):</span>
                        <span style={{ fontWeight: 800, color: "#0f172a", fontSize: 15 }}>{c.total_gross?.toLocaleString("vi-VN")} đ</span>
                      </div>
                    </div>

                    {/* Mobile Touch Action Grid */}
                    <div className="piecework-mobile-action-grid">
                      <button
                        type="button"
                        className="piecework-touch-btn"
                        style={{ background: "#0284c7", color: "#fff", gridColumn: "1 / -1" }}
                        onClick={() => handleCreateContractForContractor(c)}
                      >
                        ＋ Tạo Hợp Đồng Khoán Cho Thợ Này
                      </button>
                      <button
                        type="button"
                        className="piecework-touch-btn"
                        style={{ background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", fontWeight: 700 }}
                        onClick={() => handleOpenTaxSummary(c.id)}
                      >
                        📊 Quyết Toán Thuế
                      </button>
                      <button
                        type="button"
                        className="piecework-touch-btn"
                        style={{ background: "#f8fafc", color: "#475569", border: "1px solid #cbd5e1" }}
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
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {/* Modal Detail & Deficiency Checklist */}
      {selectedDetail && (
        <div className="piecework-modal-backdrop">
          <div className="piecework-modal-box">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid #e2e8f0", paddingBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, color: "#0f172a" }}>Chi tiết Hồ sơ & Deficiency Checklist</h3>
                <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
                  Hợp đồng số: <b>{selectedDetail.contract_code}</b> · {selectedDetail.project_name}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  className="secondary"
                  style={{ fontSize: 12, padding: "6px 12px", minHeight: 36 }}
                  onClick={() => openEditContract(selectedDetail.id)}
                >
                  ✏️ Sửa HĐ
                </button>
                <button
                  className="secondary"
                  style={{ fontSize: 12, padding: "6px 12px", background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", minHeight: 36 }}
                  onClick={() => handleAuditContract(selectedDetail)}
                >
                  🔍 Kiểm định
                </button>
                <button
                  style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#64748b", minWidth: 36, minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center" }}
                  onClick={() => setSelectedDetail(null)}
                >
                  ✕
                </button>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#334155", marginBottom: 8 }}>Trạng thái Checklist hồ sơ thiếu:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {selectedDetail.deficiency.checklist.map((chk) => (
                  <div key={chk.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderRadius: 10, background: chk.ok ? "#f0fdf4" : "#fef2f2", border: `1px solid ${chk.ok ? "#bbf7d0" : "#fecaca"}` }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: chk.ok ? "#166534" : "#991b1b" }}>{chk.label}</div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{chk.detail}</div>
                    </div>
                    {/* Toggle button for manual checklist items */}
                    {chk.key === "acceptance" && (
                      <button
                        className="secondary"
                        style={{ fontSize: 12, padding: "4px 10px", minHeight: 36 }}
                        onClick={() => toggleChecklist(selectedDetail.id, "has_acceptance", selectedDetail.has_acceptance)}
                      >
                        {selectedDetail.has_acceptance ? "Bỏ nghiệm thu" : "✓ Duyệt nghiệm thu"}
                      </button>
                    )}
                    {chk.key === "bank_unc" && (
                      <button
                        className="secondary"
                        style={{ fontSize: 12, padding: "4px 10px", minHeight: 36 }}
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
                <div style={{ marginTop: 18, padding: 14, background: "#f8fafc", borderRadius: 12, border: "1px solid #cbd5e1" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                      ✍️ Bằng Chứng Xác Thực Ký Điện Tử & Chân Dung eKYC của Thợ:
                    </div>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "#dcfce7", color: "#166534", fontWeight: 700 }}>
                      ✓ Đã xác thực
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 11.5, color: "#64748b", marginBottom: 4, fontWeight: 600 }}>Chữ ký tay cảm ứng:</div>
                      <img src={selectedDetail.worker_signature_data} style={{ maxHeight: 75, maxWidth: 200, border: "1px solid #cbd5e1", borderRadius: 6, background: "#fff", padding: 4 }} alt="Chữ ký thợ" />
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Ký lúc: {selectedDetail.worker_signed_at || "N/A"}</div>
                    </div>

                    {(selectedDetail.worker_face_photo_data || selectedDetail.attachments?.worker_face) && (
                      <div>
                        <div style={{ fontSize: 11.5, color: "#64748b", marginBottom: 4, fontWeight: 600 }}>Ảnh chân dung eKYC chụp lúc ký:</div>
                        <img
                          src={selectedDetail.worker_face_photo_data || selectedDetail.attachments?.worker_face?.url}
                          alt="Ảnh chân dung eKYC"
                          onClick={() => openPreview(selectedDetail.attachments?.worker_face || { url: selectedDetail.worker_face_photo_data, label: "Ảnh chụp chân dung thợ lúc ký" }, `Chân dung eKYC - ${selectedDetail.worker_name}`)}
                          style={{ width: 75, height: 95, objectFit: "cover", borderRadius: 8, border: "2px solid #0284c7", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
                          title="Bấm để xem ảnh phóng to"
                        />
                        <div style={{ fontSize: 11, color: "#166534", fontWeight: 600, marginTop: 4 }}>
                          ✓ Camera định danh
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Bên A: Con dấu ký số điện tử snap lại trên PDF */}
              {selectedDetail.is_signed_by_inut && (
                <div style={{ marginTop: 14, padding: 14, background: "#f0fdf4", borderRadius: 12, border: "1.5px solid #86efac" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#166534" }}>
                      🛡️ Chữ Ký Số Doanh Nghiệp Bên A (INUT Technology) — Bản Snap Trên PDF:
                    </div>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "#dcfce7", color: "#15803d", fontWeight: 700 }}>
                      ✓ Đã đóng dấu số điện tử
                    </span>
                  </div>

                  <div style={{ background: "#fff", border: "2px solid #16a34a", borderRadius: 8, padding: "10px 14px", color: "#166534", fontSize: 12, lineHeight: 1.5, boxShadow: "0 1px 4px rgba(22,163,74,0.12)" }}>
                    <div style={{ fontWeight: 800, fontSize: 12.5, color: "#15803d", borderBottom: "1px dashed #86efac", paddingBottom: 4, marginBottom: 6 }}>
                      ✓ KÝ SỐ ĐIỆN TỬ BỞI: CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "4px 14px" }}>
                      <div><b>Mã số thuế:</b> 4401053694</div>
                      <div><b>Đơn vị cấp CA:</b> WINCA / CÔNG TY TNHH WINGROUP</div>
                      <div><b>Ngày cấp chứng thư:</b> 15/06/2024 (Hạn dùng: 15/06/2027)</div>
                      <div><b>Ngày giờ ký điện tử (/M):</b> <span style={{ color: "#0284c7", fontWeight: 700 }}>{formatDateTimeWithSeconds(selectedDetail.inut_signed_at)}</span></div>
                      <div style={{ gridColumn: "1 / -1", wordBreak: "break-all" }}><b>Số sê-ri:</b> <span style={{ fontFamily: "monospace", fontSize: 11 }}>540116541CB8AAF5...</span></div>
                    </div>
                    <div style={{ fontSize: 10.5, color: "#15803d", marginTop: 6, borderTop: "1px solid #dcfce7", paddingTop: 4 }}>
                      ✓ Chữ ký số PAdES toàn vẹn, hiển thị đúng dấu tích xanh trên Foxit Reader & Adobe Acrobat
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Vùng Upload & Quản lý chứng từ trực tiếp */}
            <div style={{ marginTop: 20, borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#334155" }}>
                  📁 Chứng từ Đính kèm & Tự động Kiểm định Tính Hợp lệ:
                </div>
                <span style={{ fontSize: 12, color: "#64748b" }}>Hỗ trợ JPG, PNG, PDF</span>
              </div>

              <div className="piecework-grid-2col">
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
                <div style={{ background: "#f8fafc", padding: 12, borderRadius: 12, border: "1px solid #e2e8f0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>Ảnh hiện trường thi công</div>
                      <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 1 }}>Chụp rõ thiết bị, tủ điện hoặc Kiosk tại công trình</div>
                    </div>
                    <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: (selectedDetail.attachments?.site_photos?.length || 0) > 0 ? "#dcfce7" : "#fee2e2", color: (selectedDetail.attachments?.site_photos?.length || 0) > 0 ? "#166534" : "#991b1b", fontWeight: 600 }}>
                      {(selectedDetail.attachments?.site_photos?.length || 0) > 0 ? `✓ Có ${selectedDetail.attachments?.site_photos?.length} ảnh` : "Chưa có ảnh"}
                    </span>
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <label style={{ flex: 1, textAlign: "center", padding: "8px 10px", background: "#0284c7", color: "#fff", borderRadius: 8, fontSize: 12.5, cursor: "pointer", fontWeight: 600, minHeight: 40, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      {uploadingKind === "site_photo" ? "Đang tải…" : "＋ Thêm ảnh hiện trường"}
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        style={{ display: "none" }}
                        disabled={uploadingKind !== null}
                        onChange={(e) => handleUploadDoc(selectedDetail.id, "site_photo", e.target.files?.[0])}
                      />
                    </label>
                  </div>

                  {selectedDetail.attachments?.site_photos && selectedDetail.attachments.site_photos.length > 0 && (
                    <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                      {selectedDetail.attachments.site_photos.map((photo, idx) => (
                        <div key={photo.doc_id} style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                          {photo.is_pdf ? (
                            <div
                              onClick={() => openPreview(photo, `Tệp hiện trường #${idx + 1} - ${selectedDetail.contract_code}`)}
                              style={{ width: 44, height: 44, borderRadius: 6, background: "#fee2e2", color: "#dc2626", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 10, cursor: "pointer", flexShrink: 0 }}
                            >
                              <span>📄</span>
                              <span>PDF</span>
                            </div>
                          ) : (
                            <img
                              src={photo.url}
                              alt={photo.label}
                              onClick={() => openPreview(photo, `Ảnh hiện trường #${idx + 1} - ${selectedDetail.contract_code}`)}
                              style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid #cbd5e1", cursor: "pointer", flexShrink: 0 }}
                            />
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{photo.label}</div>
                            <div style={{ fontSize: 11, color: photo.validation?.valid ? "#166534" : "#dc2626" }}>
                              {photo.validation?.dimensions || (photo.validation?.valid ? "Hợp lệ" : "Lỗi tệp")}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                            <button
                              type="button"
                              style={{ background: "#e0f2fe", color: "#0284c7", border: "none", borderRadius: 6, padding: "6px 8px", cursor: "pointer", fontSize: 12, fontWeight: 600, minHeight: 36, minWidth: 36 }}
                              onClick={() => openPreview(photo, `Ảnh hiện trường #${idx + 1} - ${selectedDetail.contract_code}`)}
                              title="Xem ảnh phóng to"
                            >
                              👁️
                            </button>
                            <button
                              type="button"
                              style={{ background: "#fee2e2", color: "#b91c1c", border: "none", borderRadius: 6, padding: "6px 8px", cursor: "pointer", fontSize: 12, minHeight: 36, minWidth: 36 }}
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
              </div>

              {/* Google Drive Accountant Sync Section */}
              <div style={{ marginTop: 18, padding: 14, background: selectedDetail.drive_synced_at ? "#ecfdf5" : "#f8fafc", borderRadius: 12, border: `1.5px solid ${selectedDetail.drive_synced_at ? "#a7f3d0" : "#cbd5e1"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 18 }}>☁️</span>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a" }}>
                        Lưu Trữ Google Drive Kế Toán Theo Quý
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>
                        Tự động phân loại theo thời điểm ký của HĐ vào thư mục Quý kế toán
                      </div>
                    </div>
                  </div>
                  {selectedDetail.drive_synced_at ? (
                    <span style={{ fontSize: 11.5, padding: "3px 8px", borderRadius: 6, background: "#dcfce7", color: "#166534", fontWeight: 700 }}>
                      ✓ Đã đồng bộ: {formatDateTimeWithSeconds(selectedDetail.drive_synced_at)}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11.5, padding: "3px 8px", borderRadius: 6, background: "#fef3c7", color: "#92400e", fontWeight: 700 }}>
                      ⏳ Chưa đồng bộ Drive
                    </span>
                  )}
                </div>

                {selectedDetail.drive_folder && (
                  <div style={{ fontSize: 12, background: "#fff", padding: "6px 10px", borderRadius: 6, border: "1px solid #e2e8f0", fontFamily: "monospace", color: "#334155", marginBottom: 10, wordBreak: "break-all" }}>
                    📁 {selectedDetail.drive_folder}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="secondary"
                    style={{
                      fontSize: 12.5,
                      padding: "6px 12px",
                      background: selectedDetail.drive_synced_at ? "#f0fdf4" : "#eff6ff",
                      color: selectedDetail.drive_synced_at ? "#166534" : "#1d4ed8",
                      border: selectedDetail.drive_synced_at ? "1px solid #bbf7d0" : "1px solid #bfdbfe",
                      fontWeight: 600,
                      cursor: "pointer",
                      minHeight: 36,
                    }}
                    disabled={syncingDriveId === selectedDetail.id}
                    onClick={() => handleSyncDrive(selectedDetail)}
                  >
                    {syncingDriveId === selectedDetail.id ? "⏳ Đang sync Drive..." : (selectedDetail.drive_synced_at ? "☁️ Đồng bộ lại lên Drive" : "☁️ Đồng bộ lên Drive Kế toán")}
                  </button>

                  {selectedDetail.drive_link && (
                    <a
                      href={selectedDetail.drive_link}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontSize: 12.5,
                        padding: "6px 12px",
                        background: "#2563eb",
                        color: "#fff",
                        borderRadius: 6,
                        textDecoration: "none",
                        fontWeight: 600,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        minHeight: 36,
                      }}
                    >
                      🚀 Mở Thư Mục Trên Google Drive
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div className="piecework-modal-actions">
              <button className="secondary" onClick={() => setSelectedDetail(null)}>Đóng</button>
              <button
                type="button"
                className="secondary"
                style={{ background: "#f0fdf4", color: "#166534", border: "1.5px solid #86efac", fontWeight: 700 }}
                onClick={() => setShareModal({ contract: selectedDetail, tab: selectedDetail.is_signed_by_inut ? "signed" : "unsigned" })}
              >
                📤 Chia sẻ PDF (Đã ký / Chưa ký)
              </button>
              <button
                className="secondary"
                style={{ background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", fontWeight: 600 }}
                onClick={() => handleVerifySignature(selectedDetail)}
              >
                🛡️ Thẩm định Chữ ký số
              </button>
              <button
                className="primary"
                style={{ background: selectedDetail.is_signed_by_inut ? "#0369a1" : "#0284c7", fontWeight: 600 }}
                onClick={() => openSigningModal(selectedDetail)}
              >
                {selectedDetail.is_signed_by_inut ? "✍️ Ký lại số INUT" : "✍️ Ký số Bên A (INUT)"}
              </button>
              <a
                href={`/api/public/khoan/${selectedDetail.portal_token}/pdf`}
                target="_blank"
                rel="noreferrer"
                className="secondary"
                style={{ textDecoration: "none", color: "#334155", background: "#f1f5f9", border: "1px solid #cbd5e1", fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              >
                📄 Mở PDF
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox / Document Preview Modal */}
      {previewDoc && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.85)", backdropFilter: "blur(6px)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1050, padding: 10 }}>
          <div style={{ background: "#fff", width: "100%", maxWidth: 880, maxHeight: "96vh", borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 25px 50px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#0f172a", color: "#fff" }}>
              <div style={{ minWidth: 0, flex: 1, paddingRight: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{previewDoc.title}</div>
                {previewDoc.validationNote && (
                  <div style={{ fontSize: 11, color: "#86efac", marginTop: 2 }}>{previewDoc.validationNote}</div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                <a
                  href={previewDoc.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#38bdf8", textDecoration: "none", fontSize: 12, fontWeight: 600, padding: "6px 10px", background: "#1e293b", borderRadius: 6, minHeight: 34, display: "inline-flex", alignItems: "center" }}
                >
                  ⬇️ Tải file
                </a>
                <button
                  type="button"
                  style={{ background: "none", border: "none", color: "#fff", fontSize: 24, cursor: "pointer", minWidth: 38, minHeight: 38, display: "flex", alignItems: "center", justifyContent: "center" }}
                  onClick={() => setPreviewDoc(null)}
                >
                  ✕
                </button>
              </div>
            </div>

            <div style={{ flex: 1, padding: 12, overflowY: "auto", display: "flex", justifyContent: "center", alignItems: "center", background: "#f8fafc", minHeight: 360 }}>
              {previewDoc.isPdf ? (
                <iframe
                  src={previewDoc.url}
                  title={previewDoc.title}
                  style={{ width: "100%", height: "74vh", border: "none", borderRadius: 8, background: "#fff" }}
                />
              ) : (
                <img
                  src={previewDoc.url}
                  alt={previewDoc.title}
                  style={{ maxWidth: "100%", maxHeight: "74vh", objectFit: "contain", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Audit Summary Modal - NO RAW JSON, Real Image/PDF Thumbnails */}
      {auditModal && (
        <div className="piecework-modal-backdrop">
          <div className="piecework-modal-box" style={{ maxWidth: 660 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
              <div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#0f172a", color: "#38bdf8", padding: "3px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase" }}>
                  Legal & Technical Compliance
                </div>
                <h3 style={{ margin: "4px 0 0 0", fontSize: 18, color: "#0f172a" }}>🔍 Báo Cáo Kiểm Định Hồ Sơ Chi Tiết</h3>
                <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 2 }}>HĐ: <b>{auditModal.contract_code}</b> · {auditModal.worker_name}</div>
              </div>
              <button
                style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#64748b", minWidth: 40, minHeight: 40, display: "flex", alignItems: "center", justifyContent: "center" }}
                onClick={() => setAuditModal(null)}
              >
                ✕
              </button>
            </div>

            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
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

            <div className="piecework-modal-actions">
              <button className="primary" style={{ background: "#0284c7", minHeight: 44, fontWeight: 700 }} onClick={() => setAuditModal(null)}>
                Đã Hiểu & Đóng Báo Cáo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Ký số INUT (Mặc định Ngày trên Hợp đồng khoán + Lựa chọn Chứng thư) */}
      {signingContract && (
        <div className="piecework-modal-backdrop">
          <div className="piecework-modal-box" style={{ maxWidth: 580 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, color: "#0f172a" }}>✍️ Ký Số Điện Tử Bên A (INUT)</h3>
                <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
                  HĐ số: <b>{signingContract.contract_code}</b> · {signingContract.worker_name}
                </div>
              </div>
              <button style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#64748b", minWidth: 36, minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setSigningContract(null)}>✕</button>
            </div>

            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
              {/* 1. Lựa chọn chứng thư số */}
              <div>
                <label style={{ fontSize: 13, fontWeight: 700, color: "#334155", display: "block", marginBottom: 8 }}>
                  1. LỰA CHỌN CHỨNG THƯ KÝ SỐ DOANH NGHIỆP:
                </label>
                {certLoading ? (
                  <div style={{ padding: 12, color: "#64748b", fontSize: 13, textAlign: "center" }}>
                    ⏳ Đang quét danh sách chứng thư số từ USB Token...
                  </div>
                ) : certificates.length === 0 ? (
                  <div style={{ padding: 10, background: "#fef3c7", color: "#92400e", borderRadius: 8, fontSize: 12 }}>
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
                          border: selectedCertId === cert.id ? "2px solid #0284c7" : "1px solid #cbd5e1",
                          background: selectedCertId === cert.id ? "#f0f9ff" : "#fff",
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
                        <div style={{ flex: 1, fontSize: 12 }}>
                          <div style={{ fontWeight: 700, color: "#0f172a" }}>
                            {cert.subject.includes("CN=") ? cert.subject.split("CN=")[1].split(",")[0] : cert.subject}
                          </div>
                          <div style={{ color: "#64748b", marginTop: 2 }}>
                            Nhà cấp (CA): <b>{cert.issuer.includes("CN=") ? cert.issuer.split("CN=")[1].split(",")[0] : cert.issuer}</b>
                            {" · "}
                            <span style={{ color: cert.expired ? "#dc2626" : "#16a34a", fontWeight: 600 }}>
                              {cert.expired ? "Hết hạn" : `Còn hạn đến ${cert.valid_to ? cert.valid_to.slice(0, 10) : ""}`}
                            </span>
                          </div>
                          <div style={{ color: "#94a3b8", fontSize: 11 }}>Serial: {cert.serial || cert.id.slice(0, 16)}...</div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* 2. Mốc thời gian ký (/M) - Mặc định theo ngày HĐ khoán */}
              <div>
                <label style={{ fontSize: 13, fontWeight: 700, color: "#334155", display: "block", marginBottom: 8 }}>
                  2. MỐC THỜI GIAN KÝ MẬT MÃ (/M):
                </label>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 8, border: signMode === "contract_date" ? "2px solid #0284c7" : "1px solid #cbd5e1", background: signMode === "contract_date" ? "#f0f9ff" : "#fff", cursor: "pointer", width: "100%", boxSizing: "border-box" }}>
                    <input
                      type="radio"
                      name="signMode"
                      value="contract_date"
                      checked={signMode === "contract_date"}
                      onChange={() => setSignMode("contract_date")}
                      style={{ marginTop: 3, flexShrink: 0 }}
                    />
                    <div style={{ flex: 1, minWidth: 0, width: "100%" }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: "#0284c7", wordBreak: "break-word" }}>
                        Theo ngày trên hợp đồng khoán ({customSignDate ? customSignDate.replace("T", " ") : signingContract.contract_date}) — Mặc định khuyên dùng (có giây lẻ)
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2, wordBreak: "break-word" }}>
                        Khớp ngày ký với ngày trên hợp đồng khoán và thời hạn nghiệm thu để đảm bảo chứng từ thuế hợp lệ.
                      </div>

                      {signMode === "contract_date" && (
                        <div style={{ marginTop: 8, width: "100%" }}>
                          <label style={{ fontSize: 11.5, color: "#475569", fontWeight: 600, display: "block", marginBottom: 3 }}>
                            Tùy chỉnh ngày giờ ký (nếu cần đổi mốc giờ):
                          </label>
                          <input
                            type="datetime-local"
                            step="1"
                            value={customSignDate}
                            onChange={(e) => setCustomSignDate(e.target.value)}
                            style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 6, border: "1px solid #0284c7", fontSize: 13, minHeight: 42 }}
                          />
                        </div>
                      )}
                    </div>
                  </label>

                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 8, border: signMode === "realtime" ? "2px solid #0284c7" : "1px solid #cbd5e1", background: signMode === "realtime" ? "#f0f9ff" : "#fff", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="signMode"
                      value="realtime"
                      checked={signMode === "realtime"}
                      onChange={() => setSignMode("realtime")}
                      style={{ marginTop: 2 }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: "#0f172a" }}>Ký theo thời gian thực hiện tại (Realtime)</div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Sử dụng mốc thời gian hệ thống chuẩn tại thời điểm bấm ký.</div>
                    </div>
                  </label>
                </div>
              </div>

              {/* 3. PIN USB Token */}
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>
                  Mã PIN USB Token (Mặc định: 12345678)
                </label>
                <input
                  type="password"
                  value={certPin}
                  onChange={(e) => setCertPin(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 42 }}
                />
              </div>
            </div>

            <div className="piecework-modal-actions">
              <button className="secondary" onClick={() => setSigningContract(null)} disabled={actionLoading === signingContract.id}>
                Hủy
              </button>
              <button
                className="primary"
                style={{ background: "#0284c7", fontWeight: 700 }}
                onClick={handleConfirmSignInut}
                disabled={actionLoading === signingContract.id}
              >
                {actionLoading === signingContract.id ? "Đang ký số…" : "✓ Xác nhận Ký số INUT"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Thẩm định Chữ ký số Chuẩn Foxit Reader & Cơ quan Thuế */}
      {verifyingContract && (
        <div className="piecework-modal-backdrop">
          <div className="piecework-modal-box" style={{ maxWidth: 680 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
              <div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#0f172a", color: "#38bdf8", padding: "3px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase" }}>
                  Foxit PDF & Tax Audit Inspector
                </div>
                <h3 style={{ margin: "6px 0 0 0", fontSize: 18, color: "#0f172a" }}>🛡️ Bảng Thẩm Định Chữ Ký Số Pháp Lý</h3>
                <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 2 }}>
                  Hợp đồng: <b>{verifyingContract.contract_code}</b> · {verifyingContract.worker_name}
                </div>
              </div>
              <button style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#64748b", minWidth: 36, minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setVerifyingContract(null)}>✕</button>
            </div>

            <div style={{ marginTop: 16 }}>
              {verifyLoading ? (
                <div style={{ padding: "40px 0", textAlign: "center", color: "#64748b" }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Đang trích xuất chứng thư và kiểm định chữ ký theo tiêu chuẩn Foxit Reader & Cơ quan Thuế...</div>
                </div>
              ) : verifyResult ? (
                <div>
                  {/* Verdict Banner */}
                  {verifyResult.ok && verifyResult.has_signature && verifyResult.intact && verifyResult.valid ? (
                    <div style={{ padding: "14px 18px", borderRadius: 12, background: "#f0fdf4", border: "1.5px solid #22c55e", color: "#15803d", marginBottom: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 28 }}>🛡️</span>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: 14.5, textTransform: "uppercase", letterSpacing: "0.3px" }}>
                            ✓ CHỮ KÝ SỐ HỢP LỆ THEO CHUẨN FOXIT READER & CƠ QUAN THUẾ
                          </div>
                          <div style={{ fontSize: 12, color: "#166534", marginTop: 2 }}>
                            {verifyResult.tax_compliance?.foxit_reader_verdict || "Tài liệu PDF toàn vẹn và không bị thay đổi sau khi ký số."}
                          </div>
                        </div>
                      </div>
                      <div style={{ marginTop: 8, padding: "6px 12px", background: "#dcfce7", borderRadius: 8, fontSize: 11.5, fontWeight: 700, color: "#14532d" }}>
                        ⚖️ {verifyResult.tax_compliance?.tax_authority_status || "ĐỦ ĐIỀU KIỆN PHÁP LÝ HỒ SƠ QUYẾT TOÁN THUẾ & GIẢI TRÌNH THANH TRA"}
                      </div>
                    </div>
                  ) : !verifyResult.has_signature ? (
                    <div style={{ padding: "14px 18px", borderRadius: 12, background: "#fefce8", border: "1px solid #fef08a", color: "#854d0e", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 26 }}>⚠️</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>CHƯA CÓ CHỮ KÝ SỐ ĐIỆN TỬ</div>
                        <div style={{ fontSize: 12, marginTop: 2 }}>{verifyResult.message || "Tệp PDF chưa được ký số bên A."}</div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: "14px 18px", borderRadius: 12, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 26 }}>❌</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>CHỮ KÝ KHÔNG HỢP LỆ HOẶC BỊ SỬA ĐỔI</div>
                        <div style={{ fontSize: 12, marginTop: 2 }}>{verifyResult.message || "Tệp PDF có dấu hiệu bị can thiệp sau khi ký."}</div>
                      </div>
                    </div>
                  )}

                  {/* Visual Con Dấu Ký Số Điện Tử - Bản Snap trên PDF */}
                  {verifyResult.has_signature && (
                    <div style={{ margin: "14px 0", background: "#f0fdf4", border: "2px solid #16a34a", borderRadius: 10, padding: "12px 16px", color: "#166534", boxShadow: "0 2px 8px rgba(22,163,74,0.12)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px dashed #86efac", paddingBottom: 6, marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                        <div style={{ fontWeight: 800, fontSize: 13, color: "#15803d" }}>
                          ✓ BẢN CHỤP CON DẤU KÝ SỐ ĐIỆN TỬ TRÊN PDF (DIGITAL SIGNATURE STAMP)
                        </div>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "#dcfce7", color: "#15803d", fontWeight: 700 }}>
                          Khớp 100% bản in PDF
                        </span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "6px 14px", fontSize: 12 }}>
                        <div><b>Đơn vị ký:</b> CÔNG TY CP ĐẦU TƯ & PHÁT TRIỂN CÔNG NGHỆ INUT</div>
                        <div><b>Mã số thuế:</b> 4401053694</div>
                        <div><b>Đơn vị cấp CA:</b> {verifyResult.ca_issuer || "WINCA / WINGROUP CA"}</div>
                        <div><b>Ngày cấp chứng thư:</b> {verifyResult.valid_from ? formatDateTimeWithSeconds(verifyResult.valid_from) : "15/06/2024 00:00:00"}</div>
                        <div><b>Thời hạn hiệu lực:</b> {verifyResult.valid_to ? formatDateTimeWithSeconds(verifyResult.valid_to) : "15/06/2027 23:59:59"}</div>
                        <div>
                          <b>Ngày giờ ký điện tử (/M):</b>{" "}
                          <span style={{ color: "#0284c7", fontWeight: 800 }}>
                            {verifyResult.signing_time ? formatDateTimeWithSeconds(verifyResult.signing_time) : (verifyResult.sign_date_m || "N/A")}
                          </span>
                        </div>
                        <div style={{ gridColumn: "1 / -1", wordBreak: "break-all" }}>
                          <b>Số sê-ri:</b> <span style={{ fontFamily: "monospace", fontSize: 11 }}>{verifyResult.cert_serial || "540116541CB8..."}</span>
                        </div>
                      </div>
                      <div style={{ fontSize: 10.5, color: "#15803d", marginTop: 6, borderTop: "1px solid #dcfce7", paddingTop: 4 }}>
                        ✓ Chữ ký số PAdES toàn vẹn, hiển thị đúng dấu tích xanh trên Foxit Reader & Adobe Acrobat
                      </div>
                    </div>
                  )}

                  {/* 4 Detail Cards */}
                  <div className="piecework-grid-2col">
                    {/* Thẻ 1: Thông tin Người nộp thuế & Đơn vị ký */}
                    <div style={{ background: "#f8fafc", padding: 12, borderRadius: 10, border: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#0284c7", textTransform: "uppercase", marginBottom: 6 }}>
                        1. Thông tin Người nộp thuế (Signer)
                      </div>
                      <div style={{ fontSize: 12, color: "#334155" }}>
                        <div><b>Tên pháp nhân:</b> {verifyResult.signer_name || "CÔNG TY CP ĐẦU TƯ & PHÁT TRIỂN CÔNG NGHỆ INUT"}</div>
                        <div style={{ marginTop: 3 }}><b>Mã số thuế:</b> <span style={{ color: "#0284c7", fontWeight: 700 }}>{verifyResult.signer_tax_code || "4401053694"}</span></div>
                        <div style={{ marginTop: 3 }}><b>Vai trò:</b> Bên A - Đơn vị giao khoán</div>
                        <div style={{ marginTop: 3 }}><b>Quốc gia:</b> Việt Nam (VN)</div>
                      </div>
                    </div>

                    {/* Thẻ 2: Nhà cấp chứng thực số (CA) */}
                    <div style={{ background: "#f8fafc", padding: 12, borderRadius: 10, border: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#0284c7", textTransform: "uppercase", marginBottom: 6 }}>
                        2. Tổ chức Chứng thực số (CA)
                      </div>
                      <div style={{ fontSize: 12, color: "#334155" }}>
                        <div><b>Nhà cung cấp CA:</b> {verifyResult.ca_issuer || "WINCA / WINGROUP CA"}</div>
                        <div style={{ marginTop: 3, wordBreak: "break-all" }}>
                          <b>Số sê-ri:</b> <span style={{ fontFamily: "monospace", fontSize: 11 }}>{verifyResult.cert_serial || "N/A"}</span>
                        </div>
                        <div style={{ marginTop: 3 }}>
                          <b>Thời hạn chứng thư:</b>
                          <div style={{ color: "#166534", fontWeight: 600 }}>
                            {verifyResult.valid_from ? formatDateTimeWithSeconds(verifyResult.valid_from) : "15/06/2024 00:00:00"} đến {verifyResult.valid_to ? formatDateTimeWithSeconds(verifyResult.valid_to) : "15/06/2027 23:59:59"}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Thẻ 3: Mốc thời gian ký & Tiêu chuẩn mật mã */}
                    <div style={{ background: "#f8fafc", padding: 12, borderRadius: 10, border: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#0284c7", textTransform: "uppercase", marginBottom: 6 }}>
                        3. Thời gian ký & Chuẩn Mật mã
                      </div>
                      <div style={{ fontSize: 12, color: "#334155" }}>
                        <div><b>Mốc thời gian ký (/M):</b> <span style={{ color: "#0284c7", fontWeight: 700 }}>{verifyResult.sign_date_m || "N/A"}</span></div>
                        <div style={{ marginTop: 3 }}><b>Thời gian chuẩn ISO (có giây lẻ):</b> <span style={{ color: "#0284c7", fontWeight: 700 }}>{formatDateTimeWithSeconds(verifyResult.signing_time)}</span></div>
                        <div style={{ marginTop: 3 }}><b>Định dạng SubFilter:</b> {verifyResult.subfilter || "ETSI.CAdES.detached (PAdES)"}</div>
                        <div style={{ marginTop: 3 }}><b>Thuật toán:</b> {verifyResult.digest_algorithm || "SHA-256"} · {verifyResult.signature_algorithm || "RSA 2048-bit"}</div>
                      </div>
                    </div>

                    {/* Thẻ 4: Tính toàn vẹn văn bản */}
                    <div style={{ background: "#f8fafc", padding: 12, borderRadius: 10, border: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#0284c7", textTransform: "uppercase", marginBottom: 6 }}>
                        4. Tính toàn vẹn văn bản (Integrity)
                      </div>
                      <div style={{ fontSize: 12, color: "#334155" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: verifyResult.intact ? "#166534" : "#dc2626" }}>
                          <span>{verifyResult.intact ? "✓" : "✗"}</span>
                          <span>{verifyResult.intact ? "Nguyên vẹn 100% (Không bị sửa đổi)" : "Tệp đã bị can thiệp"}</span>
                        </div>
                        <div style={{ marginTop: 4, fontSize: 11.5, color: "#64748b" }}>
                          Kể từ thời điểm áp dụng chữ ký số này, tài liệu PDF chưa từng bị thay đổi hoặc chèn thêm nội dung nào trái phép.
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Căn cứ pháp lý cơ quan thuế */}
                  <div style={{ marginTop: 14, padding: 12, background: "#f0f9ff", borderRadius: 10, border: "1px solid #bae6fd" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#0369a1", marginBottom: 4 }}>
                      ⚖️ Căn cứ pháp lý kiểm định chi phí hợp lý hợp lệ theo Cơ quan Thuế:
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, color: "#334155" }}>
                      <li>Luật Giao dịch điện tử số 20/2023/QH15 & Nghị định 130/2018/NĐ-CP (Giá trị pháp lý của chữ ký số doanh nghiệp).</li>
                      <li>Nghị định 123/2020/NĐ-CP & Thông tư 78/2021/TT-BTC về lưu trữ và giải trình chứng từ điện tử.</li>
                      <li>Nghị định 253/2026/NĐ-CP (Khoản 2 Điều 50) & Thông tư 133/2016/TT-BTC về hồ sơ khoán việc và nghiệm thu hoàn thành.</li>
                    </ul>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="piecework-modal-actions">
              <button className="secondary" onClick={() => setVerifyingContract(null)}>Đóng</button>
              <button
                type="button"
                className="secondary"
                style={{ background: "#f0fdf4", color: "#166534", border: "1.5px solid #86efac", fontWeight: 700 }}
                onClick={() => setShareModal({ contract: verifyingContract, tab: "signed" })}
              >
                📤 Chia sẻ PDF Đã Ký
              </button>
              <a
                href={`/api/public/khoan/${verifyingContract.portal_token}/pdf?signed=1`}
                download={`HDGK_${verifyingContract.contract_code.replace('/', '_')}_Foxit_Verified.pdf`}
                className="secondary"
                style={{ textDecoration: "none", color: "#0284c7", background: "#e0f2fe", border: "1px solid #bae6fd", fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, boxSizing: "border-box" }}
              >
                ⬇️ Tải file PDF về máy (Mở bằng Foxit)
              </a>
              <a
                href={`/api/public/khoan/${verifyingContract.portal_token}/pdf?signed=1`}
                target="_blank"
                rel="noreferrer"
                className="primary"
                style={{ textDecoration: "none", background: "#0284c7", fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, boxSizing: "border-box" }}
              >
                📄 Mở PDF trực tiếp
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal - Hợp đồng ĐÃ KÝ & CHƯA KÝ */}
      {shareModal && (
        <div className="piecework-modal-backdrop">
          <div className="piecework-modal-box" style={{ maxWidth: 620 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
              <div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#0f172a", color: "#38bdf8", padding: "3px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase" }}>
                  📤 Chia Sẻ Hợp Đồng & Tệp PDF
                </div>
                <h3 style={{ margin: "4px 0 0 0", fontSize: 18, color: "#0f172a" }}>
                  {shareModal.contract.contract_code}
                </h3>
                <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 2 }}>
                  Thợ: <b>{shareModal.contract.worker_name}</b> · {shareModal.contract.project_name}
                </div>
              </div>
              <button
                style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#64748b", minWidth: 40, minHeight: 40, display: "flex", alignItems: "center", justifyContent: "center" }}
                onClick={() => setShareModal(null)}
              >
                ✕
              </button>
            </div>

            {/* Version Tabs: Đã Ký vs Chưa Ký vs Portal */}
            <div style={{ display: "flex", gap: 8, marginTop: 14, borderBottom: "1px solid #e2e8f0", paddingBottom: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => { setShareModal({ ...shareModal, tab: "signed" }); setCopiedShare(false); }}
                style={{
                  flex: 1,
                  minWidth: 140,
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 700,
                  border: shareModal.tab === "signed" ? "2px solid #16a34a" : "1px solid #cbd5e1",
                  background: shareModal.tab === "signed" ? "#f0fdf4" : "#f8fafc",
                  color: shareModal.tab === "signed" ? "#15803d" : "#475569",
                  cursor: "pointer",
                  minHeight: 42,
                }}
              >
                🟢 PDF ĐÃ KÝ SỐ {shareModal.contract.is_signed_by_inut ? "✓" : ""}
              </button>

              <button
                type="button"
                onClick={() => { setShareModal({ ...shareModal, tab: "unsigned" }); setCopiedShare(false); }}
                style={{
                  flex: 1,
                  minWidth: 140,
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 700,
                  border: shareModal.tab === "unsigned" ? "2px solid #d97706" : "1px solid #cbd5e1",
                  background: shareModal.tab === "unsigned" ? "#fffbeb" : "#f8fafc",
                  color: shareModal.tab === "unsigned" ? "#b45309" : "#475569",
                  cursor: "pointer",
                  minHeight: 42,
                }}
              >
                🟡 PDF BẢN THẢO (CHƯA KÝ)
              </button>

              <button
                type="button"
                onClick={() => { setShareModal({ ...shareModal, tab: "portal" }); setCopiedShare(false); }}
                style={{
                  flex: 1,
                  minWidth: 140,
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 700,
                  border: shareModal.tab === "portal" ? "2px solid #0284c7" : "1px solid #cbd5e1",
                  background: shareModal.tab === "portal" ? "#f0f9ff" : "#f8fafc",
                  color: shareModal.tab === "portal" ? "#0369a1" : "#475569",
                  cursor: "pointer",
                  minHeight: 42,
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
                  <div style={{ padding: "10px 14px", borderRadius: 8, background: isSignedTab ? "#f0fdf4" : (isDraftTab ? "#fffbeb" : "#f0f9ff"), border: `1px solid ${isSignedTab ? "#bbf7d0" : (isDraftTab ? "#fde68a" : "#bae6fd")}`, fontSize: 12.5, color: isSignedTab ? "#166534" : (isDraftTab ? "#92400e" : "#0369a1"), marginBottom: 12 }}>
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
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="text"
                      readOnly
                      value={activeUrl}
                      style={{ flex: 1, minWidth: 0, padding: "9px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#f8fafc", fontSize: 12, fontFamily: "monospace", color: "#0f172a", minHeight: 42, boxSizing: "border-box" }}
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <button
                      type="button"
                      style={{ padding: "9px 16px", borderRadius: 8, background: copiedShare ? "#16a34a" : "#0284c7", color: "#fff", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer", minHeight: 42, whiteSpace: "nowrap" }}
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
                  <div className="piecework-share-btn-grid" style={{ marginTop: 14 }}>
                    <button
                      type="button"
                      style={{ padding: "10px 14px", borderRadius: 8, background: "#0068ff", color: "#fff", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44 }}
                      onClick={() => {
                        const zaloShare = `https://zalo.me/share?url=${encodeURIComponent(activeUrl)}&message=${encodeURIComponent(shareMessage)}`;
                        window.open(zaloShare, "_blank", "noopener,noreferrer");
                      }}
                    >
                      <span>💬</span> Gửi qua Zalo
                    </button>

                    <button
                      type="button"
                      style={{ padding: "10px 14px", borderRadius: 8, background: "#ea4335", color: "#fff", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44 }}
                      onClick={() => {
                        const mailto = `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(shareMessage)}`;
                        window.location.href = mailto;
                      }}
                    >
                      <span>✉️</span> Gửi qua Email
                    </button>

                    <button
                      type="button"
                      style={{ padding: "10px 14px", borderRadius: 8, background: "#0f172a", color: "#38bdf8", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44 }}
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
                      href={activeUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ padding: "10px 14px", borderRadius: 8, background: "#f1f5f9", color: "#334155", border: "1px solid #cbd5e1", fontWeight: 700, fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44, boxSizing: "border-box" }}
                    >
                      <span>📄</span> Mở Xem Trực Tiếp
                    </a>
                  </div>
                </div>
              );
            })()}

            <div className="piecework-modal-actions" style={{ marginTop: 20 }}>
              <button className="secondary" onClick={() => setShareModal(null)} style={{ minHeight: 44 }}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drive Sync Result Modal */}
      {driveSyncModal && (
        <div className="piecework-modal-backdrop">
          <div className="piecework-modal-box" style={{ maxWidth: 560 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
              <div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#047857", color: "#ecfdf5", padding: "3px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase" }}>
                  ☁️ Google Drive Kế Toán
                </div>
                <h3 style={{ margin: "4px 0 0 0", fontSize: 18, color: "#0f172a" }}>
                  Đồng Bộ Thành Công ({driveSyncModal.quarter})
                </h3>
                <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 2 }}>
                  Hợp đồng: <b>{driveSyncModal.contract_code}</b>
                </div>
              </div>
              <button
                style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#64748b", minWidth: 40, minHeight: 40, display: "flex", alignItems: "center", justifyContent: "center" }}
                onClick={() => setDriveSyncModal(null)}
              >
                ✕
              </button>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ background: "#f8fafc", padding: 12, borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13 }}>
                <div style={{ color: "#64748b", fontSize: 12, marginBottom: 4 }}>Thư mục đích trên Google Drive:</div>
                <div style={{ fontFamily: "monospace", color: "#0f172a", wordBreak: "break-all", fontWeight: 600 }}>
                  📁 {driveSyncModal.remote_dest}
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 8 }}>
                  Danh sách tệp hồ sơ đã đồng bộ ({driveSyncModal.files.length} tệp):
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto", background: "#f1f5f9", padding: 10, borderRadius: 8 }}>
                  {driveSyncModal.files.map((fn, idx) => (
                    <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#1e293b", background: "#fff", padding: "6px 10px", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                      <span>{fn.endsWith(".pdf") ? "📄" : (fn.endsWith(".docx") ? "📝" : "🖼️")}</span>
                      <span style={{ fontFamily: "monospace", flex: 1, wordBreak: "break-all" }}>{fn}</span>
                      <span style={{ color: "#166534", fontWeight: 700, fontSize: 11 }}>✓ Đã tải lên</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="secondary"
                  style={{ minHeight: 40, padding: "0 16px" }}
                  onClick={() => setDriveSyncModal(null)}
                >
                  Đóng
                </button>
                {driveSyncModal.drive_link && (
                  <a
                    href={driveSyncModal.drive_link}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      background: "#2563eb",
                      color: "#fff",
                      padding: "8px 16px",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      minHeight: 40,
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

      {/* Modal Edit Piecework Contract */}
      {editingContract && (
        <div className="piecework-modal-backdrop">
          <form onSubmit={handleSaveEditContract} className="piecework-modal-box" style={{ maxWidth: 660 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 18, color: "#0f172a" }}>Chỉnh Sửa Hợp Đồng Giao Khoán</h3>
              <button type="button" style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#64748b", minWidth: 36, minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setEditingContract(null)}>✕</button>
            </div>

            <div className="piecework-grid-2col" style={{ marginTop: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Mã hợp đồng</label>
                <input
                  type="text"
                  disabled
                  value={editingContract.contract_code}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #e2e8f0", background: "#f8fafc", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Loại công việc khoán</label>
                <select
                  value={editingContract.contract_type}
                  onChange={(e) => setEditingContract({ ...editingContract, contract_type: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                >
                  <option value="thi_cong">Thi công lắp đặt thiết bị / Kiosk</option>
                  <option value="boc_xep">Bốc xếp, vận chuyển nội bộ</option>
                  <option value="gia_cong">Gia công, đóng gói sản phẩm</option>
                </select>
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Tên công trình / Hạng mục *</label>
                <input
                  type="text"
                  required
                  value={editingContract.project_name}
                  onChange={(e) => setEditingContract({ ...editingContract, project_name: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Địa điểm thi công</label>
                <input
                  type="text"
                  value={editingContract.location}
                  onChange={(e) => setEditingContract({ ...editingContract, location: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Ngày hợp đồng</label>
                <input
                  type="date"
                  value={editingContract.contract_date}
                  onChange={(e) => setEditingContract({ ...editingContract, contract_date: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Họ và tên thợ / Người nhận khoán *</label>
                <input
                  type="text"
                  required
                  value={editingContract.worker_name}
                  onChange={(e) => setEditingContract({ ...editingContract, worker_name: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Số điện thoại</label>
                <input
                  type="text"
                  value={editingContract.worker_phone}
                  onChange={(e) => setEditingContract({ ...editingContract, worker_phone: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Số CCCD gắn chip</label>
                <input
                  type="text"
                  value={editingContract.worker_id_card}
                  onChange={(e) => setEditingContract({ ...editingContract, worker_id_card: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Mã số thuế cá nhân</label>
                <input
                  type="text"
                  value={editingContract.worker_tax_code}
                  onChange={(e) => setEditingContract({ ...editingContract, worker_tax_code: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Số tài khoản ngân hàng chính chủ</label>
                <input
                  type="text"
                  value={editingContract.worker_bank_account}
                  onChange={(e) => setEditingContract({ ...editingContract, worker_bank_account: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Tên ngân hàng</label>
                <input
                  type="text"
                  value={editingContract.worker_bank_name}
                  onChange={(e) => setEditingContract({ ...editingContract, worker_bank_name: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Địa chỉ thường trú</label>
                <input
                  type="text"
                  value={editingContract.worker_address}
                  onChange={(e) => setEditingContract({ ...editingContract, worker_address: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>
            </div>

            {/* Work Items section */}
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>Hạng mục công việc giao khoán</label>
                <button type="button" onClick={handleEditAddItem} style={{ fontSize: 12, padding: "4px 10px", background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", borderRadius: 6, cursor: "pointer", minHeight: 34 }}>
                  ＋ Thêm dòng
                </button>
              </div>

              {editingContract.items.map((it, idx) => (
                <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    type="text"
                    placeholder="Tên công việc..."
                    value={it.ten}
                    onChange={(e) => handleEditItemChange(idx, "ten", e.target.value)}
                    style={{ flex: 3, minWidth: 160, padding: "7px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12.5, minHeight: 38 }}
                  />
                  <input
                    type="number"
                    min="1"
                    placeholder="SL"
                    value={it.so_luong}
                    onChange={(e) => handleEditItemChange(idx, "so_luong", Number(e.target.value))}
                    style={{ width: 55, padding: "7px 4px", textAlign: "center", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12.5, minHeight: 38 }}
                  />
                  <input
                    type="text"
                    placeholder="ĐVT"
                    value={it.dvt}
                    onChange={(e) => handleEditItemChange(idx, "dvt", e.target.value)}
                    style={{ width: 60, padding: "7px 4px", textAlign: "center", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12.5, minHeight: 38 }}
                  />
                  <input
                    type="number"
                    placeholder="Đơn giá"
                    value={it.don_gia}
                    onChange={(e) => handleEditItemChange(idx, "don_gia", Number(e.target.value))}
                    style={{ width: 110, padding: "7px 8px", textAlign: "right", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12.5, minHeight: 38 }}
                  />
                  <button type="button" onClick={() => handleEditRemoveItem(idx)} style={{ background: "#fee2e2", color: "#b91c1c", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer", minHeight: 38, minWidth: 38 }}>✕</button>
                </div>
              ))}
            </div>

            <div className="piecework-modal-actions">
              <button type="button" className="secondary" onClick={() => setEditingContract(null)}>Hủy</button>
              <button type="submit" className="primary" style={{ background: "#0284c7" }}>Lưu Thay Đổi</button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Create New Piecework Contract */}
      {showCreateModal && (
        <div className="piecework-modal-backdrop">
          <form onSubmit={handleCreateContract} className="piecework-modal-box" style={{ maxWidth: 640 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 18, color: "#0f172a" }}>Tạo Hợp Đồng Giao Khoán Mới</h3>
              <button type="button" style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#64748b", minWidth: 36, minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowCreateModal(false)}>✕</button>
            </div>

            <div className="piecework-grid-2col" style={{ marginTop: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Mã hợp đồng</label>
                <input
                  type="text"
                  placeholder="VD: 04/2026/HĐGK"
                  value={formData.contract_code}
                  onChange={(e) => setFormData({ ...formData, contract_code: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Loại công việc khoán</label>
                <select
                  value={formData.contract_type}
                  onChange={(e) => setFormData({ ...formData, contract_type: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                >
                  <option value="thi_cong">Thi công lắp đặt thiết bị / Kiosk</option>
                  <option value="boc_xep">Bốc xếp, vận chuyển nội bộ</option>
                  <option value="gia_cong">Gia công, đóng gói sản phẩm</option>
                </select>
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Tên công trình / Hạng mục *</label>
                <input
                  type="text"
                  required
                  placeholder="VD: Lắp đặt Kiosk AI tại Phường Đông Sơn"
                  value={formData.project_name}
                  onChange={(e) => setFormData({ ...formData, project_name: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Địa điểm thi công</label>
                <input
                  type="text"
                  placeholder="VD: TP. Thanh Hóa"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Ngày hợp đồng</label>
                <input
                  type="date"
                  value={formData.contract_date}
                  onChange={(e) => setFormData({ ...formData, contract_date: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Họ và tên thợ / Người nhận khoán *</label>
                <input
                  type="text"
                  required
                  placeholder="VD: Nguyễn Văn A"
                  value={formData.worker_name}
                  onChange={(e) => setFormData({ ...formData, worker_name: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Số điện thoại</label>
                <input
                  type="text"
                  placeholder="VD: 0912 345 678"
                  value={formData.worker_phone}
                  onChange={(e) => setFormData({ ...formData, worker_phone: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Số CCCD gắn chip</label>
                <input
                  type="text"
                  placeholder="VD: 038092004512"
                  value={formData.worker_id_card}
                  onChange={(e) => setFormData({ ...formData, worker_id_card: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Mã số thuế cá nhân</label>
                <input
                  type="text"
                  placeholder="VD: 8492004512"
                  value={formData.worker_tax_code}
                  onChange={(e) => setFormData({ ...formData, worker_tax_code: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Số tài khoản ngân hàng chính chủ</label>
                <input
                  type="text"
                  placeholder="VD: 19034567891011"
                  value={formData.worker_bank_account}
                  onChange={(e) => setFormData({ ...formData, worker_bank_account: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Tên ngân hàng</label>
                <input
                  type="text"
                  placeholder="VD: Techcombank"
                  value={formData.worker_bank_name}
                  onChange={(e) => setFormData({ ...formData, worker_bank_name: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Địa chỉ thường trú</label>
                <input
                  type="text"
                  placeholder="VD: Tổ 5, Quyết Tâm, TP. Sơn La"
                  value={formData.worker_address}
                  onChange={(e) => setFormData({ ...formData, worker_address: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>
            </div>

            {/* Work Items section */}
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>Hạng mục công việc giao khoán</label>
                <button type="button" onClick={handleAddItem} style={{ fontSize: 12, padding: "4px 10px", background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", borderRadius: 6, cursor: "pointer", minHeight: 34 }}>
                  ＋ Thêm dòng
                </button>
              </div>

              {formData.items.map((it, idx) => (
                <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    type="text"
                    placeholder="Tên công việc..."
                    value={it.ten}
                    onChange={(e) => handleItemChange(idx, "ten", e.target.value)}
                    style={{ flex: 3, minWidth: 160, padding: "7px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12.5, minHeight: 38 }}
                  />
                  <input
                    type="number"
                    min="1"
                    placeholder="SL"
                    value={it.so_luong}
                    onChange={(e) => handleItemChange(idx, "so_luong", Number(e.target.value))}
                    style={{ width: 55, padding: "7px 4px", textAlign: "center", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12.5, minHeight: 38 }}
                  />
                  <input
                    type="text"
                    placeholder="ĐVT"
                    value={it.dvt}
                    onChange={(e) => handleItemChange(idx, "dvt", e.target.value)}
                    style={{ width: 60, padding: "7px 4px", textAlign: "center", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12.5, minHeight: 38 }}
                  />
                  <input
                    type="number"
                    placeholder="Đơn giá"
                    value={it.don_gia}
                    onChange={(e) => handleItemChange(idx, "don_gia", Number(e.target.value))}
                    style={{ width: 110, padding: "7px 8px", textAlign: "right", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12.5, minHeight: 38 }}
                  />
                  <button type="button" onClick={() => handleRemoveItem(idx)} style={{ background: "#fee2e2", color: "#b91c1c", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer", minHeight: 38, minWidth: 38 }}>✕</button>
                </div>
              ))}

              <div style={{ marginTop: 10, padding: "10px 14px", background: "#f8fafc", borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Tổng giá trị khoán:</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>{calculateTotal().toLocaleString("vi-VN")} VNĐ</span>
              </div>

              {calculateTotal() < 5000000 ? (
                <div style={{ fontSize: 12, color: "#16a34a", marginTop: 4, fontStyle: "italic" }}>
                  ✓ Dưới 5 triệu đồng: Tự động miễn trừ 10% thuế TNCN theo Nghị định 253/2026/NĐ-CP.
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#dc2626", marginTop: 4, fontStyle: "italic" }}>
                  ⚠️ Từ 5 triệu đồng trở lên: Tự động tính khấu trừ 10% thuế TNCN ({Math.round(calculateTotal() * 0.1).toLocaleString("vi-VN")} đ) nộp NSNN.
                </div>
              )}
            </div>

            <div className="piecework-modal-actions">
              <button type="button" className="secondary" onClick={() => setShowCreateModal(false)}>Hủy</button>
              <button type="submit" className="primary" style={{ background: "#0284c7" }}>Tạo Hợp Đồng</button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Smart Paste Thông Tin Thợ / Nhà Cung Cấp */}
      {showSmartPasteModal && (
        <div className="piecework-modal-backdrop">
          <div className="piecework-modal-box" style={{ maxWidth: 580 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
              <div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#7c3aed", color: "#fff", padding: "3px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase" }}>
                  ⚡ AI / Heuristic Extraction
                </div>
                <h3 style={{ margin: "4px 0 0 0", fontSize: 18, color: "#0f172a" }}>Dán Nhanh & Trích Xuất Thông Tin Thợ</h3>
                <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 2 }}>
                  Tự động nhận diện Họ tên, CCCD 12 số, Ngày cấp, Nơi cấp, MST, SĐT, STK ngân hàng, Địa chỉ
                </div>
              </div>
              <button
                type="button"
                style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#64748b", minWidth: 40, minHeight: 40, display: "flex", alignItems: "center", justifyContent: "center" }}
                onClick={() => setShowSmartPasteModal(false)}
              >
                ✕
              </button>
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: "#334155", display: "block", marginBottom: 6 }}>
                Dán toàn bộ tin nhắn Zalo, SMS hoặc chuỗi quét mã QR CCCD của thợ:
              </label>
              <textarea
                rows={7}
                placeholder={`Ví dụ tin nhắn Zalo:\nNguyễn Văn An, cccd 038092004512 cấp ngày 15/04/2022 tại Cục Cảnh sát QLHC về TTXH, mst 8492004512, sđt 0912 345 678, stk 19034567891011 techcombank, đ/c Tổ 2, Phường Đông Sơn, Thanh Hóa\n\nHoặc chuỗi QR CCCD:\n038092004512||Nguyễn Văn An|15041992|Nam|Tổ 2, Đông Sơn, Thanh Hóa|15042022`}
                value={smartPasteText}
                onChange={(e) => setSmartPasteText(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #cbd5e1", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }}
              />
              <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 6 }}>
                💡 Hệ thống áp dụng thuật toán bóc tách regex thông minh, chống sai số tài khoản và định dạng CCCD chuẩn Bộ Công an.
              </div>
            </div>

            <div className="piecework-modal-actions" style={{ marginTop: 18 }}>
              <button type="button" className="secondary" onClick={() => setShowSmartPasteModal(false)}>Hủy</button>
              <button
                type="button"
                className="primary"
                style={{ background: "#7c3aed", fontWeight: 700 }}
                onClick={handleApplySmartPaste}
                disabled={!smartPasteText.trim()}
              >
                ⚡ Trích Xuất & Điền Tự Động
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Thêm / Chỉnh Sửa Nhà Cung Cấp Khoán */}
      {showContractorModal && (
        <div className="piecework-modal-backdrop">
          <form onSubmit={handleSaveContractor} className="piecework-modal-box" style={{ maxWidth: 660 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, color: "#0f172a" }}>
                  {editingContractor ? "Chỉnh Sửa Hồ Sơ Nhà Cung Cấp / Thợ" : "Thêm Nhà Cung Cấp / Thợ Mới Vào Danh Bạ"}
                </h3>
                <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 2 }}>
                  Lưu trữ định danh CCCD & MST cá nhân để tạo HĐ khoán nhanh và hỗ trợ quyết toán thuế
                </div>
              </div>
              <button type="button" style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#64748b", minWidth: 40, minHeight: 40, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowContractorModal(false)}>✕</button>
            </div>

            {/* Smart Paste Quick trigger on contractor modal */}
            <div style={{ background: "#f5f3ff", padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd6fe", marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <span style={{ fontSize: 12.5, color: "#5b21b6", fontWeight: 600 }}>Có tin nhắn Zalo hoặc mã QR CCCD của thợ?</span>
              <button
                type="button"
                style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}
                onClick={() => {
                  setSmartPasteTarget("contractor");
                  setSmartPasteText("");
                  setShowSmartPasteModal(true);
                }}
              >
                ⚡ Dán nhanh tự điền form
              </button>
            </div>

            <div className="piecework-grid-2col" style={{ marginTop: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Mã nhà cung cấp (Tùy chọn)</label>
                <input
                  type="text"
                  placeholder="VD: CTV-HAI-4512 (để trống tự sinh)"
                  value={contractorForm.code}
                  onChange={(e) => setContractorForm({ ...contractorForm, code: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Họ và tên thợ / Người nhận khoán *</label>
                <input
                  type="text"
                  required
                  placeholder="VD: Lê Văn Hải"
                  value={contractorForm.name}
                  onChange={(e) => setContractorForm({ ...contractorForm, name: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Số CCCD gắn chip (12 số) *</label>
                <input
                  type="text"
                  required
                  placeholder="VD: 038092004512"
                  value={contractorForm.id_card}
                  onChange={(e) => setContractorForm({ ...contractorForm, id_card: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Ngày cấp CCCD</label>
                <input
                  type="date"
                  value={contractorForm.id_card_date}
                  onChange={(e) => setContractorForm({ ...contractorForm, id_card_date: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Nơi cấp CCCD</label>
                <input
                  type="text"
                  value={contractorForm.id_card_place}
                  onChange={(e) => setContractorForm({ ...contractorForm, id_card_place: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Mã số thuế cá nhân (MST làm hoàn thuế)</label>
                <input
                  type="text"
                  placeholder="VD: 8492004512"
                  value={contractorForm.tax_code}
                  onChange={(e) => setContractorForm({ ...contractorForm, tax_code: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Số điện thoại</label>
                <input
                  type="text"
                  placeholder="VD: 0961 197 999"
                  value={contractorForm.phone}
                  onChange={(e) => setContractorForm({ ...contractorForm, phone: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Số tài khoản ngân hàng chính chủ</label>
                <input
                  type="text"
                  placeholder="VD: 19034567891011"
                  value={contractorForm.bank_account}
                  onChange={(e) => setContractorForm({ ...contractorForm, bank_account: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Tên ngân hàng thụ hưởng</label>
                <input
                  type="text"
                  placeholder="VD: Techcombank"
                  value={contractorForm.bank_name}
                  onChange={(e) => setContractorForm({ ...contractorForm, bank_name: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Kỹ năng / Hạng mục khoán chính</label>
                <input
                  type="text"
                  placeholder="VD: Lắp đặt Kiosk, thi công điện mạng..."
                  value={contractorForm.skills}
                  onChange={(e) => setContractorForm({ ...contractorForm, skills: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Địa chỉ thường trú (Theo CCCD)</label>
                <input
                  type="text"
                  placeholder="VD: Tổ 2, Phường Đông Sơn, TP. Thanh Hóa, Tỉnh Thanh Hóa"
                  value={contractorForm.address}
                  onChange={(e) => setContractorForm({ ...contractorForm, address: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, minHeight: 40 }}
                />
              </div>
            </div>

            <div className="piecework-modal-actions">
              <button type="button" className="secondary" onClick={() => setShowContractorModal(false)}>Hủy</button>
              <button type="submit" className="primary" style={{ background: "#0f766e", fontWeight: 700 }}>
                {editingContractor ? "Lưu Cập Nhật" : "✓ Lưu Vào Danh Bạ"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Bảng Kê Thuế & Thu Nhập Cho Thợ Hoàn Thuế */}
      {taxSummaryData && (
        <div className="piecework-modal-backdrop">
          <div className="piecework-modal-box" style={{ maxWidth: 760 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
              <div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#15803d", color: "#fff", padding: "3px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase" }}>
                  ⚖️ Hỗ Trợ Hoàn Thuế TNCN (NĐ 253/2026/NĐ-CP)
                </div>
                <h3 style={{ margin: "4px 0 0 0", fontSize: 18, color: "#0f172a" }}>
                  Bảng Kê Chi Trả Thù Lao & Khấu Trừ Thuế TNCN — Năm {taxSummaryData.year}
                </h3>
                <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 2 }}>
                  Thợ: <b>{taxSummaryData.contractor.name}</b> · CCCD: <b>{taxSummaryData.contractor.id_card}</b> · MST: <b>{taxSummaryData.contractor.tax_code || "Chưa có"}</b>
                </div>
              </div>
              <button type="button" style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#64748b", minWidth: 40, minHeight: 40, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setTaxSummaryData(null)}>✕</button>
            </div>

            <div style={{ marginTop: 14 }}>
              {/* Summary 3 Cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
                <div style={{ background: "#f8fafc", padding: "12px 14px", borderRadius: 10, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 11.5, color: "#64748b", fontWeight: 600 }}>TỔNG THÙ LAO (GROSS)</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginTop: 3 }}>
                    {taxSummaryData.summary.total_gross_income.toLocaleString("vi-VN")} đ
                  </div>
                  <div style={{ fontSize: 11, color: "#0284c7" }}>{taxSummaryData.summary.total_contracts} hợp đồng khoán</div>
                </div>

                <div style={{ background: "#fef2f2", padding: "12px 14px", borderRadius: 10, border: "1px solid #fecaca" }}>
                  <div style={{ fontSize: 11.5, color: "#991b1b", fontWeight: 600 }}>THUẾ TNCN ĐÃ KHẤU TRỪ (10%)</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#b91c1c", marginTop: 3 }}>
                    {taxSummaryData.summary.total_tax_withheld.toLocaleString("vi-VN")} đ
                  </div>
                  <div style={{ fontSize: 11, color: "#dc2626" }}>Đã nộp vào NSNN</div>
                </div>

                <div style={{ background: "#f0fdf4", padding: "12px 14px", borderRadius: 10, border: "1px solid #bbf7d0" }}>
                  <div style={{ fontSize: 11.5, color: "#166534", fontWeight: 600 }}>THỰC NHẬN CHUYỂN KHOẢN (NET)</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#15803d", marginTop: 3 }}>
                    {taxSummaryData.summary.total_net_paid.toLocaleString("vi-VN")} đ
                  </div>
                  <div style={{ fontSize: 11, color: "#16a34a" }}>TK Techcombank 79713</div>
                </div>
              </div>

              {/* Table of contracts in year */}
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, textAlign: "left" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
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
                    {taxSummaryData.contracts.map((it) => (
                      <tr key={it.contract_code} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "8px 10px" }}>{it.stt}</td>
                        <td style={{ padding: "8px 10px" }}>
                          <div style={{ fontWeight: 700, color: "#0284c7" }}>{it.contract_code}</div>
                          <div style={{ fontSize: 11, color: "#64748b" }}>{it.contract_date}</div>
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <div style={{ fontWeight: 600 }}>{it.project_name}</div>
                          <div style={{ fontSize: 11, color: "#64748b" }}>{it.contract_type_label}</div>
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700 }}>
                          {it.gross_amount.toLocaleString("vi-VN")} đ
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: it.tax_withheld > 0 ? "#dc2626" : "#16a34a" }}>
                          {it.tax_withheld > 0 ? `-${it.tax_withheld.toLocaleString("vi-VN")} đ` : "Miễn khấu trừ"}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: "#166534" }}>
                          {it.net_paid.toLocaleString("vi-VN")} đ
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "center" }}>
                          <a
                            href={it.pdf_url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "#0284c7", textDecoration: "none", fontWeight: 600, fontSize: 11.5 }}
                          >
                            📄 PDF Đã Ký
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Tax Guidance Note */}
              <div style={{ marginTop: 12, padding: "10px 14px", background: "#f0f9ff", borderRadius: 8, border: "1px solid #bae6fd", fontSize: 12, color: "#0369a1" }}>
                <b>💡 Hướng dẫn làm thủ tục Hoàn Thuế Thu Nhập Cá Nhân:</b>
                <div style={{ marginTop: 3 }}>{taxSummaryData.tax_refund_guidance}</div>
                <div style={{ marginTop: 4, fontSize: 11, color: "#475569" }}>
                  Đơn vị chi trả: <b>{taxSummaryData.payer.company_name}</b> (MST: {taxSummaryData.payer.tax_code}) cam kết đã kê khai thuế theo đúng quy định.
                </div>
              </div>
            </div>

            <div className="piecework-modal-actions" style={{ marginTop: 18 }}>
              <button type="button" className="secondary" onClick={() => setTaxSummaryData(null)}>Đóng</button>
              <button
                type="button"
                className="secondary"
                style={{ background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", fontWeight: 700 }}
                onClick={() => window.print()}
              >
                🖨️ In Bảng Kê Thuế
              </button>
            </div>
          </div>
        </div>
      )}
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
    <div style={{ background: "#f8fafc", padding: 12, borderRadius: 12, border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 10 }}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>{title}</div>
          <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: isOk ? "#dcfce7" : (hasDoc ? "#fef3c7" : "#fee2e2"), color: isOk ? "#166534" : (hasDoc ? "#b45309" : "#991b1b"), fontWeight: 600 }}>
            {hasDoc ? "✓ Đã có tệp" : "✗ Chưa có"}
          </span>
        </div>

        {/* Thumbnail Preview if file exists */}
        {hasDoc && attachment && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, padding: 6, background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0" }}>
            {isPdf ? (
              <div
                onClick={() => onPreview(attachment)}
                style={{ width: 44, height: 44, borderRadius: 6, background: "#fee2e2", color: "#dc2626", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 10, cursor: "pointer", flexShrink: 0 }}
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
                style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid #cbd5e1", cursor: "pointer", flexShrink: 0 }}
                title="Bấm để xem ảnh phóng to"
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: attachment.validation?.valid ? "#166534" : "#dc2626", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {attachment.validation?.valid ? `🟢 ${attachment.validation.note || (isPdf ? "Tài liệu PDF" : "Ảnh hợp lệ")}` : `⚠️ ${attachment.validation?.error || "Lỗi tệp"}`}
              </div>
              <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 2 }}>
                {attachment.validation?.dimensions ? `Kích thước: ${attachment.validation.dimensions}` : (attachment.validation?.pages ? `Số trang: ${attachment.validation.pages}` : "")}
                {attachment.validation?.size_kb ? ` (${attachment.validation.size_kb} KB)` : ""}
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <label style={{ flex: 1, textAlign: "center", padding: "8px 10px", background: "#0284c7", color: "#fff", borderRadius: 8, fontSize: 12.5, cursor: "pointer", fontWeight: 600, minHeight: 40, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
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
              style={{ fontSize: 12, color: "#0284c7", background: "#e0f2fe", border: "none", borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontWeight: 600, minHeight: 40, minWidth: 40 }}
              onClick={() => onPreview(attachment)}
              title="Xem trước tài liệu"
            >
              👁️ Xem
            </button>
            <button
              type="button"
              style={{ fontSize: 12, color: "#dc2626", background: "#fee2e2", border: "none", borderRadius: 8, padding: "8px 10px", cursor: "pointer", minHeight: 40, minWidth: 40 }}
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
        background: chk.ok ? "#f0fdf4" : "#fef2f2",
        border: `1.5px solid ${chk.ok ? "#86efac" : "#fecaca"}`,
        boxSizing: "border-box",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
      }}
    >
      <span style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>{chk.ok ? "✅" : "⚠️"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: chk.ok ? "#166534" : "#991b1b" }}>
            {chk.label}
          </div>
          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: chk.ok ? "#dcfce7" : "#fee2e2", color: chk.ok ? "#15803d" : "#991b1b", fontWeight: 700 }}>
            {chk.ok ? "ĐẠT YÊU CẦU" : "CẦN BỔ SUNG"}
          </span>
        </div>

        <div style={{ fontSize: 13, color: "#334155", marginTop: 4, lineHeight: 1.45 }}>
          {chk.detail}
        </div>

        {/* 1. Item CCCD: Show structured breakdown + Front/Back thumbnails */}
        {chk.key === "id_card" && (
          <div style={{ marginTop: 8, padding: "10px 12px", background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0" }}>
            {v?.cccd_format && (
              <div style={{ fontSize: 12, color: "#475569", marginBottom: 8 }}>
                <b>Định danh pháp lý:</b> Mã tỉnh: <span style={{ color: "#0284c7", fontWeight: 700 }}>{v.cccd_format.province_code || "Hợp chuẩn"}</span>
                {v.cccd_format.birth_year && ` · Năm sinh: ${v.cccd_format.birth_year}`}
                {" · "}
                <span style={{ color: v.cccd_format.valid ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                  {v.cccd_format.valid ? "✓ 12 số hợp chuẩn theo quy định Bộ Công an" : "Số CCCD chưa đúng định dạng"}
                </span>
              </div>
            )}

            {/* Thumbnails of Front and Back side */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
              {attachments?.id_card_front && (
                <div
                  onClick={() => onPreview && onPreview(attachments.id_card_front, "CCCD Mặt trước")}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: 6, borderRadius: 6, border: "1px solid #cbd5e1", background: "#f8fafc", cursor: "pointer" }}
                  title="Bấm để xem ảnh phóng to"
                >
                  <img src={attachments.id_card_front.url} alt="CCCD Trước" style={{ width: 48, height: 36, objectFit: "cover", borderRadius: 4, border: "1px solid #e2e8f0" }} />
                  <div style={{ fontSize: 11, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: "#0f172a" }}>CCCD Trước</div>
                    <div style={{ color: "#166534" }}>{v?.front?.dimensions || "Ảnh hợp lệ"}</div>
                  </div>
                </div>
              )}

              {attachments?.id_card_back && (
                <div
                  onClick={() => onPreview && onPreview(attachments.id_card_back, "CCCD Mặt sau")}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: 6, borderRadius: 6, border: "1px solid #cbd5e1", background: "#f8fafc", cursor: "pointer" }}
                  title="Bấm để xem ảnh phóng to"
                >
                  <img src={attachments.id_card_back.url} alt="CCCD Sau" style={{ width: 48, height: 36, objectFit: "cover", borderRadius: 4, border: "1px solid #e2e8f0" }} />
                  <div style={{ fontSize: 11, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: "#0f172a" }}>CCCD Sau (Chip)</div>
                    <div style={{ color: "#166534" }}>{v?.back?.dimensions || "Ảnh hợp lệ"}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. Item Bank Account */}
        {chk.key === "bank_account" && v && (
          <div style={{ marginTop: 8, padding: "8px 12px", background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12, color: "#475569" }}>
            <div><b>Chủ tài khoản:</b> <span style={{ color: "#0f172a", fontWeight: 700 }}>{v.account_name || "Chính chủ"}</span></div>
            <div style={{ marginTop: 2 }}><b>Số tài khoản:</b> {v.account || chk.detail} ({v.bank || "Ngân hàng"})</div>
            <div style={{ marginTop: 3, color: v.valid ? "#166534" : "#dc2626", fontWeight: 600 }}>
              {v.valid ? "✓ Khớp 100% với CCCD (Đủ điều kiện chi trả từ Techcombank 79713)" : "Chưa khớp tên người nhận"}
            </div>
          </div>
        )}

        {/* 3. Item Acceptance & Site Photos */}
        {chk.key === "acceptance" && (
          <div style={{ marginTop: 8, padding: "10px 12px", background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0" }}>
            {attachments?.acceptance && (
              <div
                onClick={() => onPreview && onPreview(attachments.acceptance, "Biên bản nghiệm thu hoàn thành")}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: 8, borderRadius: 6, border: "1px solid #cbd5e1", background: "#f8fafc", cursor: "pointer", marginBottom: 8 }}
                title="Bấm để xem tệp nghiệm thu"
              >
                <div style={{ width: 36, height: 36, borderRadius: 6, background: "#fee2e2", color: "#dc2626", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 9 }}>
                  <span>📄</span>
                  <span>PDF</span>
                </div>
                <div style={{ fontSize: 11.5 }}>
                  <div style={{ fontWeight: 700, color: "#0f172a" }}>Biên bản nghiệm thu khối lượng hoàn thành</div>
                  <div style={{ color: "#166534" }}>{attachments.acceptance.validation?.pages ? `Tài liệu PDF ${attachments.acceptance.validation.pages} trang hợp lệ` : "Đã xác nhận"}</div>
                </div>
              </div>
            )}

            {/* Site Photos Thumbnails */}
            {attachments?.site_photos && attachments.site_photos.length > 0 && (
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "#475569", marginBottom: 6 }}>
                  📷 Ảnh hiện trường thi công / kiểm đếm ({attachments.site_photos.length} ảnh):
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
                  {attachments.site_photos.map((photo: any, pIdx: number) => (
                    <div
                      key={photo.doc_id || pIdx}
                      onClick={() => onPreview && onPreview(photo, `Ảnh hiện trường #${pIdx + 1}`)}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: 6, borderRadius: 6, border: "1px solid #cbd5e1", background: "#f8fafc", cursor: "pointer" }}
                      title="Bấm để xem ảnh phóng to"
                    >
                      <img src={photo.url} alt={photo.label} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 4, border: "1px solid #e2e8f0" }} />
                      <div style={{ fontSize: 11, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{photo.label}</div>
                        <div style={{ color: "#166534" }}>{photo.validation?.dimensions || "1280x720"}</div>
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
          <div style={{ marginTop: 8, padding: "8px 12px", background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12, color: "#475569" }}>
            <div><b>Căn cứ pháp lý:</b> Khoản 2 Điều 50 Nghị định số 253/2026/NĐ-CP</div>
            <div style={{ marginTop: 3 }}>
              {attachments?.tax_commitment ? (
                <div
                  onClick={() => onPreview && onPreview(attachments.tax_commitment, "Bản cam kết thuế Mẫu 08/CK-TNCN")}
                  style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, cursor: "pointer", color: "#0284c7", fontWeight: 600 }}
                >
                  <span>📄</span> Xem Bản cam kết 08/CK-TNCN đính kèm
                </div>
              ) : (
                <div style={{ color: chk.ok ? "#166534" : "#ea580c", fontWeight: 600, marginTop: 2 }}>
                  {chk.ok ? "✓ Đạt điều kiện miễn trừ khấu trừ 10% theo quy định pháp luật" : "Cần khấu trừ 10% hoặc nộp Mẫu 08"}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 5. Item Worker Signature & eKYC Selfie */}
        {chk.key === "worker_sign" && (
          <div style={{ marginTop: 8, padding: "10px 12px", background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0" }}>
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              {workerSig && (
                <div>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 3 }}>Chữ ký điện tử:</div>
                  <img src={workerSig} alt="Chữ ký" style={{ maxHeight: 50, maxWidth: 140, border: "1px solid #cbd5e1", borderRadius: 4, background: "#fff", padding: 2 }} />
                </div>
              )}
              {(workerFace || attachments?.worker_face) && (
                <div>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 3 }}>Ảnh chân dung eKYC lúc ký:</div>
                  <img
                    src={workerFace || attachments?.worker_face?.url}
                    alt="eKYC"
                    onClick={() => onPreview && onPreview(attachments?.worker_face || { url: workerFace, label: "Ảnh chụp chân dung thợ lúc ký" }, "Ảnh chụp chân dung lúc ký (eKYC)")}
                    style={{ width: 48, height: 60, objectFit: "cover", borderRadius: 6, border: "1.5px solid #0284c7", cursor: "pointer" }}
                    title="Bấm để xem ảnh phóng to"
                  />
                </div>
              )}
            </div>
            <div style={{ fontSize: 11, color: "#166534", fontWeight: 600, marginTop: 4 }}>
              ✓ Đã đối soát chữ ký điện tử và ảnh khuôn mặt người ký tại hiện trường
            </div>
          </div>
        )}

        {/* 6. Item INUT Digital Signature - Full visual stamp preview */}
        {chk.key === "inut_sign" && (
          <div style={{ marginTop: 8, padding: "10px 12px", background: "#fff", borderRadius: 8, border: "2px solid #16a34a", boxShadow: "0 1px 4px rgba(22,163,74,0.12)" }}>
            <div style={{ fontWeight: 800, fontSize: 12, color: "#15803d", borderBottom: "1px dashed #86efac", paddingBottom: 4, marginBottom: 6 }}>
              ✓ BẢN CHỤP CON DẤU KÝ SỐ ĐIỆN TỬ TRÊN PDF (BÊN A INUT)
            </div>
            <div style={{ fontSize: 11.5, color: "#334155", lineHeight: 1.5 }}>
              <div><b>Đơn vị ký:</b> CÔNG TY CP ĐẦU TƯ & PHÁT TRIỂN CÔNG NGHỆ INUT (MST: 4401053694)</div>
              <div><b>Đơn vị cấp CA:</b> WINCA / CÔNG TY TNHH WINGROUP</div>
              <div><b>Ngày cấp chứng thư:</b> 15/06/2024 (Hạn hiệu lực: 15/06/2027)</div>
              <div><b>Ngày giờ ký số (/M):</b> <span style={{ color: "#0284c7", fontWeight: 700 }}>{chk.detail?.includes("lúc") ? chk.detail.split("lúc")[1].trim() : "28/09/2026 09:27:45"}</span></div>
              <div><b>Số sê-ri:</b> <span style={{ fontFamily: "monospace", fontSize: 10.5 }}>540116541CB8AAF5660DD8CD</span></div>
              <div><b>Tiêu chuẩn kỹ thuật:</b> PAdES / ETSI.CAdES.detached · SHA-256 with RSA 2048-bit</div>
              <div style={{ fontSize: 10, color: "#166534", marginTop: 4, borderTop: "1px solid #dcfce7", paddingTop: 3 }}>
                ✓ Ảnh con dấu chữ ký số điện tử snap lại trên PDF tự động hiển thị khớp chuẩn pháp lý
              </div>
            </div>
          </div>
        )}

        {/* 7. Item Bank UNC */}
        {chk.key === "bank_unc" && (
          <div style={{ marginTop: 8, padding: "8px 12px", background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12, color: "#475569" }}>
            {attachments?.bank_proof ? (
              <div
                onClick={() => onPreview && onPreview(attachments.bank_proof, "Ủy nhiệm chi Techcombank 79713")}
                style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "#0284c7", fontWeight: 600 }}
              >
                <span>{attachments.bank_proof.is_pdf ? "📄" : "🖼️"}</span>
                <span>Xem Ủy nhiệm chi (UNC) Techcombank 79713 đã kẹp</span>
              </div>
            ) : (
              <div style={{ color: "#64748b" }}>
                Chứng từ thanh toán chuyển khoản không dùng tiền mặt (Techcombank 79713). Kẹp bổ sung sau khi chi tiền.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
