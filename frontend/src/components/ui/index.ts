// Wave 1a Core Display, Typography, Iconography, Button & Status Primitives (10)
export {
  AppIcon,
  ICON_NAMES,
  type AppIconProps,
  type IconName,
} from "./Icon";
export {
  AppButton,
  type AppButtonProps,
  type AppButtonSize,
  type AppButtonVariant,
} from "./AppButton";
export {
  StatusBadge,
  type StatusBadgeProps,
  type StatusBadgeSize,
  type StatusBadgeTone,
  type StatusBadgeVariant,
} from "./StatusBadge";
export {
  PageShell,
  type PageShellMaxWidth,
  type PageShellProps,
} from "./PageShell";
export {
  PageHeader,
  type PageHeaderBackAction,
  type PageHeaderBreadcrumb,
  type PageHeaderProps,
  type PageHeaderVariant,
} from "./PageHeader";
export {
  KpiStrip,
  type KpiCanonicalTone,
  type KpiItem,
  type KpiStripColumns,
  type KpiStripProps,
  type KpiTone,
} from "./KpiStrip";
export {
  SectionCard,
  type SectionCardPadding,
  type SectionCardProps,
  type SectionCardTone,
} from "./SectionCard";
export {
  InlineAlert,
  type InlineAlertProps,
  type InlineAlertTone,
} from "./InlineAlert";
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export {
  SkeletonBlock,
  TableSkeleton,
  type SkeletonBlockProps,
  type SkeletonVariant,
  type TableSkeletonProps,
} from "./SkeletonBlock";

// Wave 1b Interactive Table, Filter, Modal, Drawer, Split & Form Primitives (12)
export {
  DataView,
  MOBILE_QUERY,
  MobileCard,
  MobileCardActions,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  type DataViewProps,
  type MobileCardActionsProps,
  type MobileCardGridProps,
  type MobileCardHeaderProps,
  type MobileCardProps,
  type MobileCardRowProps,
} from "./DataView";
export {
  FilterBar,
  type FilterBarProps,
  type FilterBarSearch,
} from "./FilterBar";
export {
  ActionBar,
  type ActionBarOverflowItem,
  type ActionBarProps,
} from "./ActionBar";
export {
  ResponsiveTabs,
  type ResponsiveTabItem,
  type ResponsiveTabsProps,
  type ResponsiveTabsVariant,
} from "./ResponsiveTabs";
export {
  AppModal,
  type AppModalProps,
  type AppModalSize,
} from "./AppModal";
export {
  ConfirmDialog,
  ConfirmProvider,
  useConfirm,
  type ConfirmDialogProps,
  type ConfirmFn,
  type ConfirmOptions,
  type ConfirmTone,
} from "./ConfirmDialog";
export { PromptDialog, type PromptDialogProps } from "./PromptDialog";
export {
  DetailDrawer,
  type DetailDrawerProps,
  type DetailDrawerSize,
} from "./DetailDrawer";
export {
  SplitWorkspace,
  type SplitWorkspacePane,
  type SplitWorkspaceProps,
  type SplitWorkspaceVariant,
} from "./SplitWorkspace";
export {
  StepFlow,
  type StepFlowItem,
  type StepFlowProps,
} from "./StepFlow";
export {
  FormField,
  FormGrid,
  type FormFieldProps,
  type FormGridProps,
} from "./FormGrid";
export {
  ToastProvider,
  useToast,
  type ToastContextValue,
  type ToastTone,
} from "./ToastProvider";

// Power-User Shell, Theme & Error Boundary Primitives
export {
  ThemeProvider,
  useTheme,
  THEME_STORAGE_KEY,
  DENSITY_STORAGE_KEY,
  type DensityMode,
  type ThemeContextValue,
  type ThemeMode,
  type ThemeProviderProps,
} from "./ThemeProvider";
export {
  CommandPalette,
  type CommandPaletteItem,
  type CommandPaletteProps,
} from "./CommandPalette";
export {
  RouteErrorBoundary,
  type RouteErrorBoundaryProps,
} from "./RouteErrorBoundary";

// Backward-compatible auth re-export (moved to components/auth/PasswordModal.tsx)
export { PasswordModal, type PasswordModalProps } from "./PasswordModal";
