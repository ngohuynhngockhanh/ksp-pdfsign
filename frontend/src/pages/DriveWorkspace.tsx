import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import {
  api,
  type Customer,
  type DocRecord,
  type DriveFolderDetail,
  type DriveFolderSummary,
  type DriveItem,
  type DriveKpiSummary,
  type DriveTreeNode,
} from "../api";
import { DrivePreviewModal } from "../components/drive/DrivePreviewModal";
import { FolderShareModal } from "../components/drive/FolderShareModal";
import { MediaLightbox } from "../components/drive/MediaLightbox";
import {
  classifyDriveItem,
  formatBytes,
  formatDateTime,
  getDriveItemBadge,
  getDriveItemIcon,
  isItemSignedPdf,
} from "../components/drive/driveUtils";
import {
  AppButton,
  AppIcon,
  AppModal,
  DataView,
  EmptyState,
  FilterBar,
  FormField,
  FormGrid,
  InlineAlert,
  KpiStrip,
  MobileCard,
  MobileCardActions,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  PageHeader,
  PageShell,
  PromptDialog,
  SectionCard,
  SkeletonBlock,
  SplitWorkspace,
  StatusBadge,
  useConfirm,
  useToast,
  type KpiItem,
} from "../components/ui";

type TypeFilter = "all" | "signed_pdf" | "image" | "video" | "other";

interface UploadJob {
  id: string;
  filename: string;
  size: number;
  percent: number;
  chunkLabel?: string;
  status: "uploading" | "done" | "error";
  error?: string;
}

const DEPTH_CLS = ["", "drive-d1", "drive-d2", "drive-d3", "drive-d4"];

export function DriveWorkspace() {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const folderNameId = useId();
  const folderCustId = useId();
  const folderCodeId = useId();
  const folderDescId = useId();

  // Global lists & KPIs
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tree, setTree] = useState<DriveTreeNode[]>([]);
  const [kpi, setKpi] = useState<DriveKpiSummary | null>(null);
  const [customerFilter, setCustomerFilter] = useState<string>("");
  const [treeSearch, setTreeSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [loadingTree, setLoadingTree] = useState(true);
  const [err, setErr] = useState("");

  // Active folder detail
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DriveFolderDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Content filters & view mode
  const [itemSearch, setItemSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [mobilePane, setMobilePane] = useState<"primary" | "secondary">("secondary");

  // Upload state
  const [dragActive, setDragActive] = useState(false);
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>([]);

  // Modals & Drawers
  const [createModal, setCreateModal] = useState<{
    parentId: number | null;
    parentName?: string;
    name: string;
    customerId: string;
    projectCode: string;
    description: string;
    presetSolar: boolean;
    busy: boolean;
  } | null>(null);

  const [attachModalOpen, setAttachModalOpen] = useState(false);
  const [vaultDocs, setVaultDocs] = useState<DocRecord[]>([]);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [vaultSearch, setVaultSearch] = useState("");
  const [vaultCustomerId, setVaultCustomerId] = useState<string>("");
  const [vaultSelectedIds, setVaultSelectedIds] = useState<Set<number>>(new Set());
  const [attachBusy, setAttachBusy] = useState(false);

  const [shareDrawerOpen, setShareDrawerOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<DriveItem | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState(-1);
  const [renameTarget, setRenameTarget] = useState<
    { kind: "folder"; id: number; name: string } | { kind: "item"; id: number; name: string } | null
  >(null);

  const loadTreeAndKpi = useCallback(async () => {
    setLoadingTree(true);
    setErr("");
    try {
      const cid = customerFilter ? Number(customerFilter) : null;
      const [treeRes, listRes, custs] = await Promise.all([
        api.driveGetTree({ customerId: cid, archived: false }),
        api.driveListFolders({ customerId: cid, archived: false }),
        api.listCustomers(),
      ]);
      setTree(treeRes.items || []);
      setKpi(listRes.kpi || null);
      setCustomers(custs || []);

      // Auto-expand root folders and select first folder if none selected
      const roots = treeRes.items || [];
      if (roots.length > 0) {
        setExpandedIds((prev) => {
          if (prev.size > 0) return prev;
          return new Set(roots.slice(0, 6).map((r) => r.id));
        });
        setSelectedFolderId((cur) => cur ?? roots[0].id);
      } else {
        setSelectedFolderId(null);
        setDetail(null);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoadingTree(false);
    }
  }, [customerFilter]);

  const loadFolderDetail = useCallback(async (folderId: number | null) => {
    if (folderId == null) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    setErr("");
    try {
      const d = await api.driveGetFolder(folderId);
      setDetail(d);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    void loadTreeAndKpi();
  }, [loadTreeAndKpi]);

  useEffect(() => {
    void loadFolderDetail(selectedFolderId);
  }, [selectedFolderId, loadFolderDetail]);

  // Load Vault Documents when Attach Modal opens
  useEffect(() => {
    if (!attachModalOpen) return;
    let cancelled = false;
    setVaultLoading(true);
    api
      .listDocuments({
        customerId: vaultCustomerId ? Number(vaultCustomerId) : undefined,
        search: vaultSearch.trim() || undefined,
        page: 1,
        perPage: 100,
      })
      .then((r) => {
        if (!cancelled) setVaultDocs(r.items || []);
      })
      .catch((e) => {
        if (!cancelled) toast.error((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setVaultLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attachModalOpen, vaultCustomerId, vaultSearch]);

  function openCreateFolder(parent?: DriveFolderSummary | null) {
    setCreateModal({
      parentId: parent ? parent.id : null,
      parentName: parent?.name,
      name: "",
      customerId: parent?.customer_id
        ? String(parent.customer_id)
        : customerFilter || "",
      projectCode: parent?.project_code || "",
      description: "",
      presetSolar: false,
      busy: false,
    });
  }

  async function submitCreateFolder(e: FormEvent) {
    e.preventDefault();
    if (!createModal) return;
    const trimmed = createModal.name.trim();
    if (!trimmed) {
      toast.warning("Vui lòng nhập tên thư mục.");
      return;
    }
    setCreateModal({ ...createModal, busy: true });
    try {
      const cust = customers.find((c) => String(c.id) === createModal.customerId);
      const created = await api.driveCreateFolder({
        name: trimmed,
        parent_id: createModal.parentId,
        customer_id: cust ? cust.id : null,
        customer_name: cust ? cust.name : undefined,
        project_code: createModal.projectCode.trim() || undefined,
        description: createModal.description.trim() || undefined,
        preset: createModal.parentId == null && createModal.presetSolar ? "solar_handover" : "",
      });
      setCreateModal(null);
      toast.success(
        createModal.presetSolar && createModal.parentId == null
          ? `Đã tạo thư mục "${trimmed}" kèm 5 thư mục nghiệm thu Solar chuẩn.`
          : `Đã tạo thư mục "${trimmed}".`,
      );
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (createModal.parentId) next.add(createModal.parentId);
        next.add(created.folder.id);
        return next;
      });
      await loadTreeAndKpi();
      setSelectedFolderId(created.folder.id);
      setMobilePane("secondary");
    } catch (ex) {
      setCreateModal((prev) => (prev ? { ...prev, busy: false } : null));
      toast.error((ex as Error).message);
    }
  }

  function openAttachModal() {
    if (!detail) {
      toast.warning("Vui lòng chọn một thư mục trước khi thêm hồ sơ.");
      return;
    }
    setVaultSelectedIds(new Set());
    setVaultSearch("");
    setVaultCustomerId(detail.folder.customer_id ? String(detail.folder.customer_id) : "");
    setAttachModalOpen(true);
  }

  async function submitAttachDocuments() {
    if (!detail || vaultSelectedIds.size === 0) return;
    setAttachBusy(true);
    try {
      const res = await api.driveAttachDocuments(detail.folder.id, [...vaultSelectedIds]);
      setAttachModalOpen(false);
      const skipMsg =
        res.skipped_document_ids.length > 0
          ? ` (${res.skipped_document_ids.length} tệp đã có sẵn được bỏ qua)`
          : "";
      toast.success(`Đã gắn ${res.total_attached} hồ sơ vào "${detail.folder.name}"${skipMsg}.`);
      await Promise.all([loadFolderDetail(detail.folder.id), loadTreeAndKpi()]);
    } catch (ex) {
      toast.error((ex as Error).message);
    } finally {
      setAttachBusy(false);
    }
  }

  async function handleUploadFiles(fileList: FileList | File[]) {
    if (!detail) {
      toast.warning("Vui lòng chọn hoặc tạo thư mục trước khi tải tệp lên.");
      return;
    }
    const files = Array.from(fileList);
    if (files.length === 0) return;
    const folderId = detail.folder.id;

    let okCount = 0;
    for (const file of files) {
      const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setUploadJobs((prev) => [
        { id: jobId, filename: file.name, size: file.size, percent: 0, status: "uploading" },
        ...prev.slice(0, 14),
      ]);
      try {
        await api.driveUploadFile(folderId, file, {
          onProgress: (p) => {
            setUploadJobs((prev) =>
              prev.map((j) =>
                j.id === jobId
                  ? {
                      ...j,
                      percent: p.percent,
                      chunkLabel: p.totalChunks ? `Phần ${p.chunkIndex}/${p.totalChunks}` : undefined,
                    }
                  : j,
              ),
            );
          },
        });
        okCount += 1;
        setUploadJobs((prev) =>
          prev.map((j) => (j.id === jobId ? { ...j, percent: 100, status: "done" } : j)),
        );
      } catch (ex) {
        const msg = (ex as Error).message || "Tải lên thất bại";
        setUploadJobs((prev) =>
          prev.map((j) => (j.id === jobId ? { ...j, status: "error", error: msg } : j)),
        );
        toast.error(`Không thể tải "${file.name}": ${msg}`);
      }
    }

    if (okCount > 0) {
      toast.success(`Đã tải lên thành công ${okCount}/${files.length} tệp.`);
      await Promise.all([loadFolderDetail(folderId), loadTreeAndKpi()]);
    }
  }

  async function confirmRename(nextName: string) {
    if (!renameTarget) return;
    const trimmed = nextName.trim();
    const target = renameTarget;
    setRenameTarget(null);
    if (!trimmed || trimmed === target.name) return;
    try {
      if (target.kind === "folder") {
        await api.driveUpdateFolder(target.id, { name: trimmed });
        toast.success(`Đã đổi tên thư mục thành "${trimmed}".`);
      } else {
        await api.driveUpdateItem(target.id, { display_name: trimmed });
        toast.success(`Đã đổi tên tệp thành "${trimmed}".`);
      }
      await Promise.all([loadFolderDetail(selectedFolderId), loadTreeAndKpi()]);
    } catch (ex) {
      toast.error((ex as Error).message);
    }
  }

  async function handleDeleteFolder(folder: DriveFolderSummary) {
    const ok = await confirmDialog({
      title: "Xóa thư mục Drive",
      message: `Xóa thư mục "${folder.name}" cùng các thư mục con và liên kết chia sẻ? Các hồ sơ gốc trong Kho hồ sơ sẽ KHÔNG bị xóa.`,
      confirmLabel: "Xóa thư mục",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const parentId = folder.parent_id;
      await api.driveDeleteFolder(folder.id);
      toast.success(`Đã xóa thư mục "${folder.name}".`);
      if (selectedFolderId === folder.id) {
        setSelectedFolderId(parentId ?? null);
      }
      await loadTreeAndKpi();
    } catch (ex) {
      toast.error((ex as Error).message);
    }
  }

  async function handleDeleteItem(item: DriveItem) {
    const ok = await confirmDialog({
      title: item.item_kind === "document" ? "Gỡ hồ sơ khỏi thư mục" : "Xóa tệp khỏi Drive",
      message:
        item.item_kind === "document"
          ? `Gỡ "${item.display_name || item.original_filename}" khỏi thư mục này? Bản gốc trong Kho hồ sơ vẫn được giữ nguyên.`
          : `Xóa vĩnh viễn tệp "${item.display_name || item.original_filename}" khỏi Drive?`,
      confirmLabel: item.item_kind === "document" ? "Gỡ khỏi thư mục" : "Xóa tệp",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.driveDeleteItem(item.id);
      toast.success(`Đã xóa "${item.display_name || item.original_filename}".`);
      await Promise.all([loadFolderDetail(selectedFolderId), loadTreeAndKpi()]);
    } catch (ex) {
      toast.error((ex as Error).message);
    }
  }

  const filteredTree = useMemo(() => {
    const q = treeSearch.trim().toLowerCase();
    if (!q) return tree;
    const filterNodes = (nodes: DriveTreeNode[]): DriveTreeNode[] => {
      const out: DriveTreeNode[] = [];
      for (const n of nodes) {
        const kids = filterNodes(n.children || []);
        const hit =
          n.name.toLowerCase().includes(q) ||
          (n.customer_name || "").toLowerCase().includes(q) ||
          (n.project_code || "").toLowerCase().includes(q);
        if (hit || kids.length > 0) {
          out.push({ ...n, children: kids });
        }
      }
      return out;
    };
    return filterNodes(tree);
  }, [tree, treeSearch]);

  const filteredItems = useMemo(() => {
    const items = detail?.items || [];
    const q = itemSearch.trim().toLowerCase();
    return items.filter((item) => {
      if (q) {
        const hay = `${item.display_name} ${item.original_filename} ${item.note || ""} ${item.signer_name || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (typeFilter === "signed_pdf") return isItemSignedPdf(item);
      if (typeFilter === "image") return classifyDriveItem(item) === "image";
      if (typeFilter === "video") return classifyDriveItem(item) === "video";
      if (typeFilter === "other") {
        const c = classifyDriveItem(item);
        return c === "office" || c === "other" || (c === "pdf" && !isItemSignedPdf(item));
      }
      return true;
    });
  }, [detail?.items, itemSearch, typeFilter]);

  const imageItems = useMemo(
    () => filteredItems.filter((it) => classifyDriveItem(it) === "image"),
    [filteredItems],
  );

  function openItem(item: DriveItem) {
    if (classifyDriveItem(item) === "image") {
      const idx = imageItems.findIndex((img) => img.id === item.id);
      if (idx >= 0) {
        setLightboxIdx(idx);
        return;
      }
    }
    setPreviewItem(item);
  }

  const kpiItems: KpiItem[] = [
    {
      label: "Tổng thư mục",
      value: kpi ? String(kpi.total_folders) : "0",
      sub: customerFilter ? "theo khách hàng đã chọn" : "toàn hệ thống Drive",
      tone: "brand",
      icon: "folder",
    },
    {
      label: "Tổng tệp & dung lượng",
      value: kpi ? `${kpi.total_items} tệp` : "0 tệp",
      sub: kpi ? formatBytes(kpi.total_bytes) : "0 B",
      tone: "info",
      icon: "hard-drive",
    },
    {
      label: "PDF đã ký số",
      value: kpi ? String(kpi.signed_pdfs) : "0",
      sub: kpi ? `${kpi.images} ảnh · ${kpi.videos} video` : "0 ảnh · 0 video",
      tone: "success",
      icon: "shield-check",
    },
    {
      label: "Chia sẻ & lượt xem 7 ngày",
      value: kpi ? `${kpi.active_shares} link` : "0 link",
      sub: kpi ? `${kpi.views_7d} lượt xem 7 ngày qua` : "0 lượt xem",
      tone: "gold",
      icon: "share",
    },
  ];

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderTreeNodes(nodes: DriveTreeNode[], depth = 0) {
    const dCls = DEPTH_CLS[Math.min(depth, 4)] || "";
    return nodes.map((node) => {
      const hasKids = node.children && node.children.length > 0;
      const expanded = expandedIds.has(node.id) || Boolean(treeSearch.trim());
      const active = selectedFolderId === node.id;
      return (
        <div key={node.id} className="ui-stack--xs">
          <div className={`ui-row ui-row--xs ui-row--nowrap ${dCls}`}>
            {hasKids ? (
              <AppButton
                variant="ghost"
                size="sm"
                iconOnly
                leftIcon={expanded ? "chevron-down" : "chevron-right"}
                aria-label={expanded ? `Thu gọn ${node.name}` : `Mở rộng ${node.name}`}
                onClick={() => toggleExpand(node.id)}
              />
            ) : (
              <AppButton
                variant="ghost"
                size="sm"
                iconOnly
                leftIcon="folder"
                aria-label={node.name}
                onClick={() => {
                  setSelectedFolderId(node.id);
                  setMobilePane("secondary");
                }}
              />
            )}
            <AppButton
              variant="ghost"
              size="sm"
              className={`drive-tbtn ui-flex-1${active ? " is-active" : ""}`}
              onClick={() => {
                setSelectedFolderId(node.id);
                setMobilePane("secondary");
              }}
            >
              <span className="ui-truncate">{node.name}</span>
              <StatusBadge tone={active ? "brand" : "neutral"} size="sm" className="num">
                {node.item_count}
              </StatusBadge>
            </AppButton>
          </div>
          {hasKids && expanded && renderTreeNodes(node.children, depth + 1)}
        </div>
      );
    });
  }

  const sidebarPane = (
    <SectionCard
      padding="compact"
      icon="folder-tree"
      title="Cây thư mục dự án"
      actions={
        <AppButton
          variant="ghost"
          size="sm"
          iconOnly
          leftIcon="folder-plus"
          title="Tạo thư mục gốc mới"
          aria-label="Tạo thư mục gốc mới"
          onClick={() => openCreateFolder(null)}
        />
      }
    >
      <div className="ui-stack--sm">
        <select
          className="ui-select"
          aria-label="Lọc nhanh theo khách hàng"
          value={customerFilter}
          onChange={(e) => setCustomerFilter(e.target.value)}
        >
          <option value="">Tất cả khách hàng</option>
          {customers.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.name}
            </option>
          ))}
        </select>

        <input
          type="search"
          className="ui-input"
          value={treeSearch}
          placeholder="Tìm thư mục, mã dự án…"
          aria-label="Tìm thư mục"
          onChange={(e) => setTreeSearch(e.target.value)}
        />

        {loadingTree ? (
          <div className="ui-stack--sm">
            <SkeletonBlock variant="line" lines={5} />
          </div>
        ) : filteredTree.length === 0 ? (
          <EmptyState
            compact
            icon="folder-open"
            title="Chưa có thư mục nào"
            description="Bấm Tạo thư mục mới để khởi tạo bộ hồ sơ dự án."
            action={
              <AppButton
                variant="primary"
                size="sm"
                leftIcon="folder-plus"
                onClick={() => openCreateFolder(null)}
              >
                Tạo thư mục mới
              </AppButton>
            }
          />
        ) : (
          <div className="ui-stack--xs">{renderTreeNodes(filteredTree)}</div>
        )}
      </div>
    </SectionCard>
  );

  const mainPane = (
    <div className="ui-stack">
      {err && <InlineAlert tone="danger">{err}</InlineAlert>}

      {!selectedFolderId && !loadingTree && (
        <SectionCard>
          <EmptyState
            icon="folder-plus"
            title="Chọn hoặc tạo thư mục dự án"
            description="Tổ chức hợp đồng, biên bản nghiệm thu ký số, ảnh trạm VNPT NMS và video bàn giao vào một đường dẫn chia sẻ duy nhất."
            action={
              <AppButton
                variant="primary"
                leftIcon="folder-plus"
                onClick={() => openCreateFolder(null)}
              >
                Tạo thư mục mới
              </AppButton>
            }
          />
        </SectionCard>
      )}

      {selectedFolderId != null && loadingDetail && !detail && (
        <SectionCard>
          <SkeletonBlock variant="title" />
          <SkeletonBlock variant="line" lines={6} />
        </SectionCard>
      )}

      {detail && (
        <>
          <SectionCard
            padding="compact"
            title={detail.folder.name}
            subtitle={
              [
                detail.folder.customer_name || null,
                detail.folder.project_code ? `Mã DA: ${detail.folder.project_code}` : null,
                detail.folder.description || null,
              ]
                .filter(Boolean)
                .join(" · ") || "Thư mục lưu trữ & chia sẻ hồ sơ dự án"
            }
            actions={
              <div className="ui-row">
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon="folder-plus"
                  onClick={() => openCreateFolder(detail.folder)}
                >
                  Thư mục con
                </AppButton>
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon="share"
                  onClick={() => setShareDrawerOpen(true)}
                >
                  Chia sẻ ({detail.shares.filter((s) => !s.revoked && !s.expired).length})
                </AppButton>
                <a
                  className="ui-btn ui-btn--secondary ui-btn--sm"
                  href={api.driveFolderZipUrl(detail.folder.id)}
                >
                  <AppIcon name="archive" size={14} />
                  <span>Tải ZIP</span>
                </a>
                <AppButton
                  variant="ghost"
                  size="sm"
                  iconOnly
                  leftIcon="edit"
                  aria-label="Đổi tên thư mục"
                  title="Đổi tên thư mục"
                  onClick={() =>
                    setRenameTarget({ kind: "folder", id: detail.folder.id, name: detail.folder.name })
                  }
                />
                <AppButton
                  variant="ghost"
                  size="sm"
                  iconOnly
                  leftIcon="trash"
                  aria-label="Xóa thư mục"
                  title="Xóa thư mục"
                  onClick={() => handleDeleteFolder(detail.folder)}
                />
              </div>
            }
          >
            {detail.breadcrumbs.length > 0 && (
              <nav aria-label="Đường dẫn thư mục" className="ui-mb-2">
                <ol className="ui-breadcrumbs-list">
                  {detail.breadcrumbs.map((crumb, idx) => {
                    const isLast = idx === detail.breadcrumbs.length - 1;
                    return (
                      <li key={crumb.id} className="ui-breadcrumb-item">
                        {idx > 0 && (
                          <AppIcon name="chevron-right" size={12} className="ui-breadcrumb-sep" />
                        )}
                        {isLast ? (
                          <span className="ui-breadcrumb-current ui-wrap" aria-current="page">
                            {crumb.name}
                          </span>
                        ) : (
                          <AppButton
                            variant="ghost"
                            size="sm"
                            className="ui-wrap-btn"
                            onClick={() => setSelectedFolderId(crumb.id)}
                          >
                            {crumb.name}
                          </AppButton>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </nav>
            )}

            <label
              className={`ui-dropzone ui-dropzone--compact${dragActive ? " is-dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                if (e.dataTransfer.files?.length) {
                  void handleUploadFiles(e.dataTransfer.files);
                }
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp,.mp4,.docx,.xlsx,.xls,.md,.xml,.zip"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    void handleUploadFiles(e.target.files);
                  }
                  e.target.value = "";
                }}
              />
              <span className="ui-dropzone-icon" aria-hidden="true">
                <AppIcon name="cloud-upload" size={20} />
              </span>
              <span className="ui-dropzone-copy">
                <strong>Kéo thả tệp vào đây hoặc bấm để tải lên</strong>
                <span>
                  Hỗ trợ PDF, ảnh PNG/JPG/WebP, video MP4 (tự động phân mảnh 16 MB cho video lớn),
                  DOCX, XLSX, ZIP.
                </span>
              </span>
            </label>

            {uploadJobs.length > 0 && (
              <div className="ui-stack--xs ui-mt-3">
                <div className="ui-row-between">
                  <span className="ui-kicker">Tiến trình tải tệp lên</span>
                  <AppButton
                    variant="ghost"
                    size="sm"
                    onClick={() => setUploadJobs([])}
                  >
                    Xóa danh sách
                  </AppButton>
                </div>
                {uploadJobs.map((job) => (
                  <div key={job.id} className="ui-subpanel ui-stack--xs">
                    <div className="ui-row-between">
                      <span className="ui-truncate ui-text-semibold">{job.filename}</span>
                      <span className="ui-inline">
                        <span className="ui-muted ui-mono">{formatBytes(job.size)}</span>
                        {job.chunkLabel && (
                          <StatusBadge tone="info" size="sm">
                            {job.chunkLabel}
                          </StatusBadge>
                        )}
                        <StatusBadge
                          tone={
                            job.status === "done"
                              ? "success"
                              : job.status === "error"
                                ? "danger"
                                : "brand"
                          }
                          size="sm"
                          className="num"
                        >
                          {job.status === "done"
                            ? "Hoàn tất"
                            : job.status === "error"
                              ? "Lỗi"
                              : `${job.percent}%`}
                        </StatusBadge>
                      </span>
                    </div>
                    <progress
                      className={`ui-progress ui-progress--sm${
                        job.status === "done"
                          ? " ui-progress--success"
                          : job.status === "error"
                            ? " ui-progress--danger"
                            : ""
                      }`}
                      value={job.percent}
                      max={100}
                    />
                    {job.error && <span className="ui-text-danger ui-text-xs">{job.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {detail.subfolders.length > 0 && (
            <SectionCard padding="compact" icon="folder-open" title={`Thư mục con (${detail.subfolders.length})`}>
              <div className="ui-draft-grid">
                {detail.subfolders.map((sub) => (
                  <div key={sub.id} className="ui-draft-card">
                    <AppButton
                      variant="ghost"
                      className="ui-draft-open"
                      leftIcon="folder"
                      onClick={() => {
                        setExpandedIds((prev) => new Set(prev).add(detail.folder.id));
                        setSelectedFolderId(sub.id);
                      }}
                    >
                      <span className="ui-draft-open-inner">
                        <strong>{sub.name}</strong>
                        <span>
                          {sub.stats.total_items} tệp · {formatBytes(sub.stats.total_bytes)}
                        </span>
                      </span>
                    </AppButton>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          <FilterBar
            collapsibleMobile
            search={{
              value: itemSearch,
              onChange: setItemSearch,
              placeholder: "Tìm tên tệp, người ký, ghi chú…",
              ariaLabel: "Tìm tệp trong thư mục",
            }}
            activeCount={(itemSearch.trim() ? 1 : 0) + (typeFilter !== "all" ? 1 : 0)}
            onReset={() => {
              setItemSearch("");
              setTypeFilter("all");
            }}
            filters={
              <div className="ui-row ui-row--xs">
                {(
                  [
                    ["all", "Tất cả"],
                    ["signed_pdf", "PDF ký số"],
                    ["image", "Ảnh"],
                    ["video", "Video"],
                    ["other", "Khác"],
                  ] as const
                ).map(([key, label]) => (
                  <AppButton
                    key={key}
                    variant={typeFilter === key ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => setTypeFilter(key)}
                  >
                    {label}
                  </AppButton>
                ))}
              </div>
            }
            actions={
              <div className="ui-row ui-row--xs">
                <AppButton
                  variant={viewMode === "list" ? "primary" : "secondary"}
                  size="sm"
                  iconOnly
                  leftIcon="list"
                  aria-label="Xem dạng danh sách"
                  aria-pressed={viewMode === "list"}
                  onClick={() => setViewMode("list")}
                />
                <AppButton
                  variant={viewMode === "grid" ? "primary" : "secondary"}
                  size="sm"
                  iconOnly
                  leftIcon="grid"
                  aria-label="Xem dạng lưới"
                  aria-pressed={viewMode === "grid"}
                  onClick={() => setViewMode("grid")}
                />
              </div>
            }
          />

          {viewMode === "grid" ? (
            filteredItems.length === 0 ? (
              <EmptyState
                icon="inbox"
                title="Thư mục chưa có tệp khớp bộ lọc."
                description="Kéo thả tệp lên khung phía trên hoặc thêm PDF đã ký từ Kho hồ sơ."
                action={
                  <div className="ui-row">
                    <AppButton
                      variant="secondary"
                      size="sm"
                      leftIcon="folder-input"
                      onClick={openAttachModal}
                    >
                      Thêm từ Kho hồ sơ
                    </AppButton>
                    <AppButton
                      variant="primary"
                      size="sm"
                      leftIcon="upload"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Tải tệp lên
                    </AppButton>
                  </div>
                }
              />
            ) : (
              <div className="ui-draft-grid">
                {filteredItems.map((item) => {
                  const badge = getDriveItemBadge(item);
                  const cat = classifyDriveItem(item);
                  const thumb =
                    cat === "image"
                      ? item.thumb_url || api.driveItemThumbUrl(item.id)
                      : null;
                  const dlUrl = item.download_url || api.driveItemFileUrl(item.id, { download: true });
                  return (
                    <article key={item.id} className="drive-card ui-stack--xs">
                      <div
                        className="drive-thumb ui-row-center ui-clickable"
                        onClick={() => openItem(item)}
                      >
                        {thumb ? (
                          <img
                            src={thumb}
                            alt={item.display_name || item.original_filename}
                            loading="lazy"
                          />
                        ) : (
                          <AppIcon name={getDriveItemIcon(item)} size={36} />
                        )}
                      </div>
                      <div className="ui-stack--xs ui-pad-3 ui-flex-1">
                        <strong className="ui-truncate" title={item.display_name || item.original_filename}>
                          {item.display_name || item.original_filename}
                        </strong>
                        <div className="ui-row ui-row--xs">
                          <StatusBadge tone={badge.tone} icon={badge.icon} size="sm">
                            {badge.label}
                          </StatusBadge>
                          <span className="ui-muted ui-mono">{formatBytes(item.file_size)}</span>
                        </div>
                      </div>
                      <div className="drive-cfoot ui-row-between">
                        <AppButton
                          variant="secondary"
                          size="sm"
                          leftIcon="eye"
                          onClick={() => openItem(item)}
                        >
                          Xem
                        </AppButton>
                        <div className="ui-inline">
                          <a
                            className="ui-btn ui-btn--ghost ui-btn--sm ui-btn--icon-only"
                            href={dlUrl}
                            aria-label={`Tải ${item.display_name}`}
                            title="Tải xuống"
                          >
                            <AppIcon name="download" size={14} />
                          </a>
                          <AppButton
                            variant="ghost"
                            size="sm"
                            iconOnly
                            leftIcon="edit"
                            aria-label={`Đổi tên ${item.display_name}`}
                            onClick={() =>
                              setRenameTarget({
                                kind: "item",
                                id: item.id,
                                name: item.display_name || item.original_filename,
                              })
                            }
                          />
                          <AppButton
                            variant="ghost"
                            size="sm"
                            iconOnly
                            leftIcon="trash"
                            aria-label={`Xóa ${item.display_name}`}
                            onClick={() => handleDeleteItem(item)}
                          />
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )
          ) : (
            <DataView
              loading={loadingDetail}
              skeletonRows={5}
              skeletonCols={5}
              empty={
                !loadingDetail && filteredItems.length === 0 ? (
                  <EmptyState
                    icon="inbox"
                    title="Chưa có tệp nào trong thư mục này."
                    description="Tải lên ảnh/video nghiệm thu hoặc gắn trực tiếp các PDF đã ký từ Kho hồ sơ."
                    action={
                      <div className="ui-row">
                        <AppButton
                          variant="secondary"
                          size="sm"
                          leftIcon="folder-input"
                          onClick={openAttachModal}
                        >
                          Thêm từ Kho hồ sơ
                        </AppButton>
                        <AppButton
                          variant="primary"
                          size="sm"
                          leftIcon="upload"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          Tải tệp lên
                        </AppButton>
                      </div>
                    }
                  />
                ) : undefined
              }
              desktop={
                <div className="ui-table-scroll-wrap">
                  <table className="ui-table ui-w-full">
                    <thead>
                      <tr>
                        <th>Tên tệp</th>
                        <th>Trạng thái</th>
                        <th>Dung lượng</th>
                        <th className="col-hide-sm">Cập nhật</th>
                        <th className="col-act">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map((item) => {
                        const badge = getDriveItemBadge(item);
                        const dlUrl =
                          item.download_url || api.driveItemFileUrl(item.id, { download: true });
                        return (
                          <tr key={item.id}>
                            <td className="doc-fname-cell">
                              <AppButton
                                variant="ghost"
                                size="sm"
                                leftIcon={getDriveItemIcon(item)}
                                className="doc-fname-trigger"
                                onClick={() => openItem(item)}
                              >
                                {item.display_name || item.original_filename}
                              </AppButton>
                              {item.signer_name && (
                                <div className="ui-muted">Người ký: {item.signer_name}</div>
                              )}
                            </td>
                            <td>
                              <StatusBadge tone={badge.tone} icon={badge.icon} size="sm">
                                {badge.label}
                              </StatusBadge>
                            </td>
                            <td className="ui-mono nowrap">{formatBytes(item.file_size)}</td>
                            <td className="ui-muted col-hide-sm nowrap">
                              {formatDateTime(item.updated_at)}
                            </td>
                            <td className="col-act">
                              <div className="ui-inline ui-row--nowrap">
                                <AppButton
                                  variant="secondary"
                                  size="sm"
                                  leftIcon="eye"
                                  onClick={() => openItem(item)}
                                >
                                  Xem
                                </AppButton>
                                <a
                                  className="ui-btn ui-btn--ghost ui-btn--sm ui-btn--icon-only"
                                  href={dlUrl}
                                  title="Tải xuống"
                                  aria-label={`Tải ${item.display_name}`}
                                >
                                  <AppIcon name="download" size={15} />
                                </a>
                                <AppButton
                                  variant="ghost"
                                  size="sm"
                                  iconOnly
                                  leftIcon="edit"
                                  title="Đổi tên"
                                  aria-label={`Đổi tên ${item.display_name}`}
                                  onClick={() =>
                                    setRenameTarget({
                                      kind: "item",
                                      id: item.id,
                                      name: item.display_name || item.original_filename,
                                    })
                                  }
                                />
                                <AppButton
                                  variant="ghost"
                                  size="sm"
                                  iconOnly
                                  leftIcon="trash"
                                  title="Xóa"
                                  aria-label={`Xóa ${item.display_name}`}
                                  onClick={() => handleDeleteItem(item)}
                                />
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
                <div className="ui-mobile-card-list">
                  {filteredItems.map((item) => {
                    const badge = getDriveItemBadge(item);
                    const dlUrl =
                      item.download_url || api.driveItemFileUrl(item.id, { download: true });
                    return (
                      <MobileCard key={item.id}>
                        <MobileCardHeader
                          title={<span className="ui-wrap">{item.display_name || item.original_filename}</span>}
                          subtitle={item.signer_name ? `Ký bởi ${item.signer_name}` : undefined}
                          badge={
                            <StatusBadge tone={badge.tone} icon={badge.icon} size="sm">
                              {badge.label}
                            </StatusBadge>
                          }
                        />
                        <MobileCardGrid cols={2}>
                          <MobileCardRow label="Dung lượng" value={formatBytes(item.file_size)} mono />
                          <MobileCardRow label="Cập nhật" value={formatDateTime(item.updated_at)} />
                        </MobileCardGrid>
                        <MobileCardActions>
                          <AppButton
                            variant="secondary"
                            size="sm"
                            leftIcon="eye"
                            onClick={() => openItem(item)}
                          >
                            Xem
                          </AppButton>
                          <a className="ui-btn ui-btn--secondary ui-btn--sm" href={dlUrl}>
                            <AppIcon name="download" size={14} />
                            <span>Tải</span>
                          </a>
                          <AppButton
                            variant="ghost"
                            size="sm"
                            leftIcon="edit"
                            onClick={() =>
                              setRenameTarget({
                                kind: "item",
                                id: item.id,
                                name: item.display_name || item.original_filename,
                              })
                            }
                          >
                            Đổi tên
                          </AppButton>
                          <AppButton
                            variant="ghost"
                            size="sm"
                            leftIcon="trash"
                            onClick={() => handleDeleteItem(item)}
                          >
                            Xóa
                          </AppButton>
                        </MobileCardActions>
                      </MobileCard>
                    );
                  })}
                </div>
              }
            />
          )}
        </>
      )}
    </div>
  );

  return (
    <PageShell maxWidth="wide" data-page="drive">
      <PageHeader
        variant="compact"
        icon="folder-tree"
        eyebrow="INUT · PROJECT DRIVE"
        title="Drive Hồ Sơ Dự Án"
        subtitle="Gom nhóm hợp đồng, PDF ký số, ảnh hiện trường và video nghiệm thu theo cây thư mục chia sẻ bảo mật."
        actions={
          <>
            <AppButton
              variant="secondary"
              size="sm"
              leftIcon="folder-input"
              disabled={!detail}
              onClick={openAttachModal}
            >
              Thêm từ Kho hồ sơ
            </AppButton>
            <AppButton
              variant="secondary"
              size="sm"
              leftIcon="upload"
              disabled={!detail}
              onClick={() => fileInputRef.current?.click()}
            >
              Tải tệp lên
            </AppButton>
            <AppButton
              variant="primary"
              size="sm"
              leftIcon="folder-plus"
              onClick={() => openCreateFolder(null)}
            >
              Tạo thư mục mới
            </AppButton>
          </>
        }
      />

      <KpiStrip items={kpiItems} columns={4} loading={loadingTree && !kpi} />

      <SplitWorkspace
        variant="sidebar-left"
        className="drive-split"
        mobileTabs={["Thư mục", "Nội dung"]}
        activeMobilePane={mobilePane}
        onMobilePaneChange={setMobilePane}
        primary={sidebarPane}
        secondary={mainPane}
      />

      {/* Modal: Tạo thư mục mới (hỗ trợ 1-click preset Solar 5 mục chuẩn) */}
      <AppModal
        open={Boolean(createModal)}
        onClose={() => {
          if (!createModal?.busy) setCreateModal(null);
        }}
        dismissible={!createModal?.busy}
        size="md"
        title={
          createModal?.parentId ? "Tạo thư mục con" : "Tạo thư mục dự án mới"
        }
        subtitle={
          createModal?.parentName
            ? `Nằm trong thư mục: ${createModal.parentName}`
            : "Tổ chức bộ hồ sơ bàn giao khách hàng theo cấu trúc chuẩn"
        }
        footer={
          <>
            <AppButton
              variant="secondary"
              disabled={createModal?.busy}
              onClick={() => setCreateModal(null)}
            >
              Hủy
            </AppButton>
            <AppButton
              type="submit"
              form="drive-create-folder-form"
              variant="primary"
              leftIcon="folder-plus"
              loading={createModal?.busy}
            >
              Tạo thư mục
            </AppButton>
          </>
        }
      >
        {createModal && (
          <form
            id="drive-create-folder-form"
            className="ui-stack"
            onSubmit={submitCreateFolder}
          >
            <FormField label="Tên thư mục" htmlFor={folderNameId} required>
              <input
                id={folderNameId}
                className="ui-input"
                value={createModal.name}
                placeholder="VD: Việt Hùng Power — Hồ sơ nghiệm thu 16 trạm"
                autoFocus
                onChange={(e) => setCreateModal({ ...createModal, name: e.target.value })}
              />
            </FormField>

            <FormGrid cols={2}>
              <FormField label="Khách hàng" htmlFor={folderCustId}>
                <select
                  id={folderCustId}
                  className="ui-select"
                  value={createModal.customerId}
                  onChange={(e) =>
                    setCreateModal({ ...createModal, customerId: e.target.value })
                  }
                >
                  <option value="">— Chưa gán khách hàng —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Mã dự án" htmlFor={folderCodeId}>
                <input
                  id={folderCodeId}
                  className="ui-input ui-mono"
                  value={createModal.projectCode}
                  placeholder="VD: VH-SOLAR-16TRAM-2026"
                  onChange={(e) =>
                    setCreateModal({ ...createModal, projectCode: e.target.value })
                  }
                />
              </FormField>
            </FormGrid>

            <FormField label="Mô tả ngắn" htmlFor={folderDescId}>
              <textarea
                id={folderDescId}
                className="ui-textarea ui-textarea-sm"
                value={createModal.description}
                placeholder="Tóm tắt phạm vi hồ sơ nghiệm thu hiển thị cho khách hàng…"
                onChange={(e) =>
                  setCreateModal({ ...createModal, description: e.target.value })
                }
              />
            </FormField>

            {createModal.parentId == null && (
              <label className={`ui-choice-card${createModal.presetSolar ? " is-active" : ""}`}>
                <input
                  type="checkbox"
                  checked={createModal.presetSolar}
                  onChange={(e) =>
                    setCreateModal({ ...createModal, presetSolar: e.target.checked })
                  }
                />
                <div className="ui-stack--xs">
                  <strong className="ui-text-semibold">
                    Bộ hồ sơ Nghiệm thu Solar (5 mục chuẩn)
                  </strong>
                  <span className="ui-muted">
                    Tự động khởi tạo 5 thư mục con: Hợp đồng & Pháp lý, Báo cáo & BBNT 16 trạm,
                    Minh chứng 16 trạm VNPT NMS, Video nghiệm thu, Tài liệu hướng dẫn.
                  </span>
                </div>
              </label>
            )}
          </form>
        )}
      </AppModal>

      {/* Modal: Thêm từ Kho hồ sơ */}
      <AppModal
        open={attachModalOpen}
        onClose={() => {
          if (!attachBusy) setAttachModalOpen(false);
        }}
        dismissible={!attachBusy}
        size="lg"
        title="Thêm tệp từ Kho hồ sơ"
        subtitle={detail ? `Đích đến: ${detail.folder.name}` : undefined}
        footer={
          <>
            <AppButton
              variant="secondary"
              disabled={attachBusy}
              onClick={() => setAttachModalOpen(false)}
            >
              Hủy
            </AppButton>
            <AppButton
              variant="primary"
              leftIcon="folder-input"
              loading={attachBusy}
              disabled={vaultSelectedIds.size === 0}
              onClick={submitAttachDocuments}
            >
              Gắn {vaultSelectedIds.size} hồ sơ vào thư mục
            </AppButton>
          </>
        }
      >
        <div className="ui-stack">
          <FormGrid cols={2}>
            <select
              className="ui-select"
              aria-label="Lọc kho hồ sơ theo khách hàng"
              value={vaultCustomerId}
              onChange={(e) => setVaultCustomerId(e.target.value)}
            >
              <option value="">Tất cả khách hàng</option>
              {customers.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              type="search"
              className="ui-input"
              value={vaultSearch}
              placeholder="Tìm tên file PDF, hợp đồng, biên bản…"
              aria-label="Tìm trong kho hồ sơ"
              onChange={(e) => setVaultSearch(e.target.value)}
            />
          </FormGrid>

          {vaultLoading ? (
            <SkeletonBlock variant="line" lines={5} />
          ) : vaultDocs.length === 0 ? (
            <EmptyState
              compact
              icon="folder-open"
              title="Không tìm thấy hồ sơ nào khớp."
              description="Thử đổi bộ lọc khách hàng hoặc từ khóa tìm kiếm."
            />
          ) : (
            <div className="ui-stack--xs ui-scroll-md">
              {vaultDocs.map((doc) => {
                const checked = vaultSelectedIds.has(doc.id);
                return (
                  <label
                    key={doc.id}
                    className={`ui-choice-card${checked ? " is-active" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setVaultSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(doc.id)) next.delete(doc.id);
                          else next.add(doc.id);
                          return next;
                        });
                      }}
                    />
                    <div className="ui-stack--xs ui-flex-1">
                      <strong className="ui-text-semibold ui-wrap">{doc.filename}</strong>
                      <div className="ui-row ui-row--xs">
                        {doc.signed && (
                          <StatusBadge tone="success" icon="shield-check" size="sm">
                            Đã ký số
                          </StatusBadge>
                        )}
                        {doc.customer_name && (
                          <StatusBadge tone="brand" size="sm">
                            {doc.customer_name}
                          </StatusBadge>
                        )}
                        <span className="ui-muted">{formatDateTime(doc.created_at)}</span>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </AppModal>

      {/* Share & Access Logs DetailDrawer */}
      <FolderShareModal
        open={shareDrawerOpen}
        folder={detail?.folder ?? null}
        shares={detail?.shares ?? []}
        onClose={() => setShareDrawerOpen(false)}
        onSharesChanged={() => {
          void loadFolderDetail(selectedFolderId);
          void loadTreeAndKpi();
        }}
      />

      {/* Preview Modal (PDF / Video / Office / Other) */}
      <DrivePreviewModal
        item={previewItem}
        onClose={() => setPreviewItem(null)}
        viewUrl={
          previewItem
            ? previewItem.view_url || api.driveItemFileUrl(previewItem.id)
            : ""
        }
        downloadUrl={
          previewItem
            ? previewItem.download_url || api.driveItemFileUrl(previewItem.id, { download: true })
            : ""
        }
        pdfFormatUrl={
          previewItem ? api.driveItemFileUrl(previewItem.id, { format: "pdf" }) : undefined
        }
        canDownload
      />

      {/* Image Lightbox */}
      <MediaLightbox
        images={imageItems}
        index={lightboxIdx}
        onChangeIndex={setLightboxIdx}
        onClose={() => setLightboxIdx(-1)}
        getViewUrl={(img) => img.view_url || api.driveItemFileUrl(img.id)}
        getDownloadUrl={(img) =>
          img.download_url || api.driveItemFileUrl(img.id, { download: true })
        }
        canDownload
      />

      {/* Rename Prompt */}
      <PromptDialog
        open={Boolean(renameTarget)}
        title={renameTarget?.kind === "folder" ? "Đổi tên thư mục" : "Đổi tên tệp"}
        label="Tên hiển thị mới"
        defaultValue={renameTarget?.name || ""}
        placeholder="Nhập tên mới…"
        onConfirm={confirmRename}
        onCancel={() => setRenameTarget(null)}
      />
    </PageShell>
  );
}
