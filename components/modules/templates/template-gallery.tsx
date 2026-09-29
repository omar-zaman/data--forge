"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, FileText, Globe, Landmark, Loader2, Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  CURRENCIES,
  DOCUMENT_MAPPING_KEYS,
  DOCUMENT_TEMPLATE_PRESETS,
  DOCUMENT_TYPE_LABELS,
  PDF_FONT_FAMILIES,
  normalizeMappingKeys,
  readDocumentLayout,
  validateDocumentLayoutFields,
  type DocumentLayoutStyle,
  type DocumentTemplatePreset,
  type DocumentType,
  type PdfFontFamily,
} from "@/lib/validations/document-template";

// ============================================
// Types
// ============================================

/** Serializable VisualTemplate handed to client components. */
export interface TemplateSummary {
  id: string;
  name: string;
  category: string | null;
  isPublic: boolean;
  isOwner: boolean;
  layoutConfig: Record<string, unknown>;
  updatedAt: string;
}

interface ApiTemplate {
  id: string;
  userId: string;
  name: string;
  category: string | null;
  isPublic: boolean;
  layoutConfig: unknown;
  updatedAt: string;
}

function toSummary(raw: ApiTemplate): TemplateSummary {
  return {
    id: raw.id,
    name: raw.name,
    category: raw.category,
    isPublic: raw.isPublic,
    isOwner: true,
    layoutConfig: (raw.layoutConfig ?? {}) as Record<string, unknown>,
    updatedAt: raw.updatedAt,
  };
}

// ============================================
// Thumbnail — a miniature, CSS-drawn rendition of the PDF layout
// ============================================

const FONT_CLASS: Record<PdfFontFamily, string> = {
  Helvetica: "font-sans",
  "Times-Roman": "font-serif",
  Courier: "font-mono",
};

const LAYOUT_STYLE_INFO: Record<DocumentLayoutStyle, { label: string; description: string }> = {
  classic: { label: "Classic", description: "Rule under the header, bordered table" },
  modern: { label: "Modern", description: "Full-bleed colour band, striped rows" },
  minimal: { label: "Minimal", description: "Light tints and generous whitespace" },
};

export function TemplateThumbnail({
  config,
  className,
}: {
  config: Record<string, unknown>;
  className?: string;
}) {
  const layout = readDocumentLayout(config);

  if (!layout) {
    return (
      <div
        className={cn(
          "flex aspect-[1/1.3] w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-muted)] text-xs text-[var(--color-muted-foreground)]",
          className
        )}
      >
        <FileText className="size-5" />
        Generic layout
      </div>
    );
  }

  const { colors, layoutStyle, documentType, branding, typography } = layout;
  const accent = colors.accent ?? "#f3f4f6";
  const modern = layoutStyle === "modern";
  const classic = layoutStyle === "classic";
  const lineRows = documentType === "invoice" ? 5 : 7;

  return (
    <div
      aria-hidden
      className={cn(
        "relative flex aspect-[1/1.3] w-full flex-col overflow-hidden rounded-md border border-slate-200 bg-white text-[6px] leading-tight text-slate-800 shadow-sm",
        FONT_CLASS[typography.fontFamily],
        className
      )}
    >
      {/* Header */}
      <div
        className="flex items-start justify-between px-3 pb-2 pt-3"
        style={
          modern
            ? { backgroundColor: colors.primary, color: "#fff" }
            : classic
              ? { borderBottom: `1.5px solid ${colors.primary}` }
              : undefined
        }
      >
        <div className="flex items-center gap-1">
          {branding.logoUrl ? (
            <span className="size-3 rounded-sm bg-current opacity-30" />
          ) : null}
          <span className="max-w-[70px] truncate text-[7px] font-bold" style={modern ? undefined : { color: colors.primary }}>
            {branding.companyName}
          </span>
        </div>
        <span className="text-[9px] font-bold tracking-wider" style={modern ? undefined : { color: colors.primary }}>
          {documentType === "invoice" ? "INVOICE" : "STATEMENT"}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 px-3 pt-2">
        {/* Addressee / meta */}
        <div className="flex justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="h-1 w-8 rounded bg-slate-300" />
            <span className="h-1 w-12 rounded bg-slate-200" />
            <span className="h-1 w-10 rounded bg-slate-200" />
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="h-1 w-10 rounded bg-slate-200" />
            <span className="h-1 w-7 rounded bg-slate-200" />
          </div>
        </div>

        {documentType === "statement" && (
          <div
            className="grid grid-cols-4 gap-1 rounded-sm p-1"
            style={{ backgroundColor: accent, ...(classic && { border: `0.5px solid ${colors.primary}` }) }}
          >
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="h-1.5 rounded-sm" style={{ backgroundColor: colors.primary, opacity: 0.6 }} />
            ))}
          </div>
        )}

        {/* Table */}
        <div className="flex flex-col">
          <div
            className="h-2"
            style={
              modern
                ? { backgroundColor: colors.primary }
                : classic
                  ? { borderTop: `0.5px solid ${colors.primary}`, borderBottom: `0.5px solid ${colors.primary}` }
                  : { backgroundColor: accent }
            }
          />
          {Array.from({ length: lineRows }, (_, i) => (
            <div
              key={i}
              className="flex h-2 items-center justify-between gap-2 px-0.5"
              style={{
                ...(modern && i % 2 === 1 && { backgroundColor: accent }),
                ...(classic && { borderBottom: "0.5px solid #e5e7eb" }),
              }}
            >
              <span className="h-0.5 rounded bg-slate-300" style={{ width: `${40 + ((i * 17) % 35)}%` }} />
              <span className="h-0.5 w-4 rounded bg-slate-300" />
            </div>
          ))}
        </div>

        {documentType === "invoice" && (
          <div className="ml-auto mt-0.5 flex w-1/2 flex-col gap-0.5">
            <span className="h-0.5 w-full rounded bg-slate-200" />
            <span
              className="h-2 w-full rounded-sm"
              style={modern ? { backgroundColor: colors.primary } : { borderTop: `1px solid ${colors.primary}` }}
            />
          </div>
        )}
      </div>

      <div className="mx-3 mb-2 border-t border-slate-200 pt-1 text-[5px] text-slate-400">
        <span className="block truncate">{branding.footerText || branding.companyName}</span>
      </div>
    </div>
  );
}

// ============================================
// Editor
// ============================================

interface EditorState {
  name: string;
  isPublic: boolean;
  documentType: DocumentType;
  layoutStyle: DocumentLayoutStyle;
  currency: string;
  pageSize: "A4" | "LETTER";
  companyName: string;
  logoUrl: string;
  address: string;
  footerText: string;
  fontFamily: PdfFontFamily;
  baseSize: number;
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  mappingKeys: string[];
}

function stateFromPreset(preset: DocumentTemplatePreset, name = preset.name): EditorState {
  const c = preset.layoutConfig;
  return {
    name,
    isPublic: false,
    documentType: c.documentType,
    layoutStyle: c.layoutStyle,
    currency: c.currency,
    pageSize: c.pageSize,
    companyName: c.branding.companyName,
    logoUrl: c.branding.logoUrl ?? "",
    address: c.branding.address ?? "",
    footerText: c.branding.footerText ?? "",
    fontFamily: c.typography.fontFamily,
    baseSize: c.typography.baseSize,
    primary: c.colors.primary,
    secondary: c.colors.secondary,
    accent: c.colors.accent,
    text: c.colors.text,
    mappingKeys: c.mappingKeys,
  };
}

function stateFromTemplate(template: TemplateSummary, name = template.name): EditorState {
  const layout = readDocumentLayout(template.layoutConfig);
  // Legacy (non-document) templates are upgraded to a document layout on save
  if (!layout) return { ...stateFromPreset(DOCUMENT_TEMPLATE_PRESETS[0], name), isPublic: template.isPublic };
  const raw = template.layoutConfig as { pageSize?: string };
  return {
    name,
    isPublic: template.isPublic,
    documentType: layout.documentType,
    layoutStyle: layout.layoutStyle,
    currency: layout.currency,
    pageSize: raw.pageSize === "LETTER" ? "LETTER" : "A4",
    companyName: layout.branding.companyName,
    logoUrl: layout.branding.logoUrl ?? "",
    address: layout.branding.address ?? "",
    footerText: layout.branding.footerText ?? "",
    fontFamily: layout.typography.fontFamily,
    baseSize: layout.typography.baseSize,
    primary: layout.colors.primary,
    secondary: layout.colors.secondary ?? "#6b7280",
    accent: layout.colors.accent ?? "#f3f4f6",
    text: layout.colors.text ?? "#111827",
    mappingKeys: layout.mappingKeys,
  };
}

function toLayoutConfig(state: EditorState): Record<string, unknown> {
  const branding: Record<string, string> = { companyName: state.companyName.trim() };
  if (state.logoUrl.trim()) branding.logoUrl = state.logoUrl.trim();
  if (state.address.trim()) branding.address = state.address.trim();
  if (state.footerText.trim()) branding.footerText = state.footerText.trim();

  return {
    pageSize: state.pageSize,
    orientation: "portrait",
    documentType: state.documentType,
    mappingKeys: normalizeMappingKeys(state.documentType, state.mappingKeys),
    layoutStyle: state.layoutStyle,
    currency: state.currency,
    branding,
    typography: { fontFamily: state.fontFamily, baseSize: state.baseSize },
    colors: { primary: state.primary, secondary: state.secondary, accent: state.accent, text: state.text },
  };
}

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-[var(--color-muted-foreground)]">{hint}</p>}
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
      />
      <span className="flex-1">{label}</span>
      <span className="font-mono text-[var(--color-muted-foreground)]">{value}</span>
    </label>
  );
}

interface TemplateEditorProps {
  open: boolean;
  /** Template being edited; null creates a new one from `initial`. */
  editing: TemplateSummary | null;
  initial: EditorState;
  onOpenChange: (open: boolean) => void;
  onSaved: (template: TemplateSummary) => void;
}

function TemplateEditorDialog({ open, editing, initial, onOpenChange, onSaved }: TemplateEditorProps) {
  const [state, setState] = useState<EditorState>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const set = <K extends keyof EditorState>(key: K, value: EditorState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  const layoutConfig = useMemo(() => toLayoutConfig(state), [state]);
  const specs = DOCUMENT_MAPPING_KEYS[state.documentType];

  function changeType(type: DocumentType) {
    // Switching type resets the keys to the matching preset's selection
    const preset = DOCUMENT_TEMPLATE_PRESETS.find((p) => p.category === type)!;
    setState((s) => ({ ...s, documentType: type, mappingKeys: preset.layoutConfig.mappingKeys }));
  }

  function toggleKey(key: string, enabled: boolean) {
    setState((s) => ({
      ...s,
      mappingKeys: enabled ? [...s.mappingKeys, key] : s.mappingKeys.filter((k) => k !== key),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problems = [
      ...(state.name.trim() ? [] : ["Template name is required"]),
      ...validateDocumentLayoutFields(layoutConfig),
    ];
    setErrors(problems);
    if (problems.length) return;

    setIsSaving(true);
    try {
      const res = await fetch(editing ? `/api/templates/${editing.id}` : "/api/templates", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: state.name.trim(),
          category: state.documentType,
          isPublic: state.isPublic,
          layoutConfig,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = (body as { details?: string[] }).details;
        if (details?.length) setErrors(details);
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      onSaved(toSummary(body as ApiTemplate));
      toast.success(editing ? "Template updated" : "Template created");
      onOpenChange(false);
    } catch (err) {
      toast.error("Could not save template", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isSaving && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <form onSubmit={handleSubmit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit template" : "New document template"}</DialogTitle>
            <DialogDescription>
              Branding, colours and typography for generated PDFs, plus the fields the
              template expects from your data.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_260px]">
            <div className="grid gap-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Template name" htmlFor="tpl-name">
                  <Input id="tpl-name" value={state.name} maxLength={80} onChange={(e) => set("name", e.target.value)} />
                </Field>
                <Field label="Document type">
                  <Select value={state.documentType} onValueChange={(v) => changeType(v as DocumentType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[]).map((t) => (
                        <SelectItem key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {/* Layout style picker */}
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">Layout</span>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(LAYOUT_STYLE_INFO) as DocumentLayoutStyle[]).map((style) => (
                    <button
                      key={style}
                      type="button"
                      onClick={() => set("layoutStyle", style)}
                      aria-pressed={state.layoutStyle === style}
                      className={cn(
                        "rounded-md border p-2 text-left text-xs transition-colors",
                        state.layoutStyle === style
                          ? "border-[var(--color-primary)] bg-[var(--color-accent)]"
                          : "border-[var(--color-border)] hover:bg-[var(--color-accent)]"
                      )}
                    >
                      <span className="block font-semibold">{LAYOUT_STYLE_INFO[style].label}</span>
                      <span className="text-[var(--color-muted-foreground)]">{LAYOUT_STYLE_INFO[style].description}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Branding */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Company name" htmlFor="tpl-company">
                  <Input id="tpl-company" value={state.companyName} maxLength={80} onChange={(e) => set("companyName", e.target.value)} />
                </Field>
                <Field label="Logo URL" htmlFor="tpl-logo" hint="https:// PNG or JPEG, up to 2 MB.">
                  <Input id="tpl-logo" type="url" placeholder="https://example.com/logo.png" value={state.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} />
                </Field>
                <Field label="Company address" htmlFor="tpl-address">
                  <Input id="tpl-address" value={state.address} maxLength={300} onChange={(e) => set("address", e.target.value)} />
                </Field>
                <Field label="Footer text" htmlFor="tpl-footer">
                  <Input id="tpl-footer" value={state.footerText} maxLength={300} onChange={(e) => set("footerText", e.target.value)} />
                </Field>
              </div>

              {/* Colours & typography */}
              <div className="grid gap-2 sm:grid-cols-2">
                <ColorField label="Primary" value={state.primary} onChange={(v) => set("primary", v)} />
                <ColorField label="Secondary text" value={state.secondary} onChange={(v) => set("secondary", v)} />
                <ColorField label="Accent / tint" value={state.accent} onChange={(v) => set("accent", v)} />
                <ColorField label="Body text" value={state.text} onChange={(v) => set("text", v)} />
              </div>

              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="Font">
                  <Select value={state.fontFamily} onValueChange={(v) => set("fontFamily", v as PdfFontFamily)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PDF_FONT_FAMILIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Base size (pt)" htmlFor="tpl-size">
                  <Input id="tpl-size" type="number" min={8} max={14} step={1} value={state.baseSize} onChange={(e) => set("baseSize", Number(e.target.value))} />
                </Field>
                <Field label="Currency">
                  <Select value={state.currency} onValueChange={(v) => set("currency", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Page size">
                  <Select value={state.pageSize} onValueChange={(v) => set("pageSize", v as "A4" | "LETTER")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A4">A4</SelectItem>
                      <SelectItem value="LETTER">US Letter</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {/* Mapping keys */}
              <div className="grid gap-2">
                <span className="text-sm font-medium">Fields this template expects</span>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Saved as <code>layoutConfig.mappingKeys</code>. Required fields are always on;
                  each enabled field is mapped to a schema column in the workspace Documents tab.
                </p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {specs.map((spec) => {
                    const checked = spec.required || state.mappingKeys.includes(spec.key);
                    return (
                      <label
                        key={spec.key}
                        className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm"
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{spec.label}</span>
                          <span className="font-mono text-[10px] text-[var(--color-muted-foreground)]">
                            {spec.scope === "line" ? "line item · " : ""}{spec.key}
                          </span>
                        </span>
                        {spec.required ? (
                          <Badge variant="muted">Required</Badge>
                        ) : (
                          <Switch checked={checked} onCheckedChange={(v) => toggleKey(spec.key, v)} />
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>

              <label className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm">
                <span>
                  <span className="block font-medium">Share publicly</span>
                  <span className="text-xs text-[var(--color-muted-foreground)]">Other users can browse and duplicate it.</span>
                </span>
                <Switch checked={state.isPublic} onCheckedChange={(v) => set("isPublic", v)} />
              </label>
            </div>

            {/* Live preview */}
            <div className="md:sticky md:top-0 md:self-start">
              <span className="mb-2 block text-sm font-medium">Preview</span>
              <TemplateThumbnail config={layoutConfig} />
              <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
                Layout sketch. The PDF renders one page per record with your real data.
              </p>
            </div>
          </div>

          {errors.length > 0 && (
            <ul className="list-disc rounded-md border border-[var(--color-destructive)] p-3 pl-6 text-sm text-[var(--color-destructive)]" role="alert">
              {errors.map((err) => <li key={err}>{err}</li>)}
            </ul>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="animate-spin" />}
              {editing ? "Save changes" : "Create template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// Gallery
// ============================================

type Filter = "all" | DocumentType;

function TypeIcon({ type }: { type: DocumentType | null }) {
  const Icon = type === "statement" ? Landmark : type === "invoice" ? Receipt : FileText;
  return <Icon className="size-3.5" />;
}

function TemplateCard({
  template,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  template: TemplateSummary;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const layout = readDocumentLayout(template.layoutConfig);
  return (
    <Card className="group flex flex-col overflow-hidden">
      <div className="bg-[var(--color-muted)] p-4">
        <TemplateThumbnail config={template.layoutConfig} className="mx-auto max-w-[180px]" />
      </div>
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <h3 className="truncate font-semibold" title={template.name}>{template.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="gap-1">
              <TypeIcon type={layout?.documentType ?? null} />
              {layout ? DOCUMENT_TYPE_LABELS[layout.documentType] : template.category ?? "Layout"}
            </Badge>
            {layout && (
              <Badge variant="muted">
                {LAYOUT_STYLE_INFO[layout.layoutStyle].label} · {layout.typography.fontFamily}
              </Badge>
            )}
            {template.isPublic && (
              <Badge variant="muted" className="gap-1"><Globe className="size-3" />Public</Badge>
            )}
          </div>
          {layout && (
            <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
              {layout.mappingKeys.length} mapped fields · {layout.currency}
            </p>
          )}
        </div>
        <div className="mt-auto flex gap-2">
          {template.isOwner ? (
            <>
              <Button size="sm" variant="outline" className="flex-1" onClick={onEdit}>
                <Pencil />Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={onDuplicate} aria-label={`Duplicate ${template.name}`}>
                <Copy />
              </Button>
              <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Delete ${template.name}`}>
                <Trash2 />
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" className="flex-1" onClick={onDuplicate}>
              <Copy />Duplicate to my templates
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface TemplateGalleryProps {
  initialTemplates: TemplateSummary[];
  /** Public templates owned by other users (read-only, can be duplicated). */
  publicTemplates: TemplateSummary[];
}

export default function TemplateGallery({ initialTemplates, publicTemplates }: TemplateGalleryProps) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [filter, setFilter] = useState<Filter>("all");
  const [editor, setEditor] = useState<{ key: number; editing: TemplateSummary | null; initial: EditorState } | null>(null);
  const [deleting, setDeleting] = useState<TemplateSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const matches = (t: TemplateSummary) =>
    filter === "all" || readDocumentLayout(t.layoutConfig)?.documentType === filter;
  const mine = templates.filter(matches);
  const shared = publicTemplates.filter(matches);

  const openEditor = (editing: TemplateSummary | null, initial: EditorState) =>
    setEditor({ key: Date.now(), editing, initial });

  function handleSaved(saved: TemplateSummary) {
    setTemplates((current) => {
      const index = current.findIndex((t) => t.id === saved.id);
      if (index === -1) return [saved, ...current];
      const next = current.slice();
      next[index] = saved;
      return next;
    });
  }

  async function handleDelete() {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/templates/${deleting.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setTemplates((current) => current.filter((t) => t.id !== deleting.id));
      toast.success("Template deleted");
      setDeleting(null);
    } catch (err) {
      toast.error("Could not delete template", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsDeleting(false);
    }
  }

  const filters: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "invoice", label: "Invoices" },
    { value: "statement", label: "Statements" },
  ];

  return (
    <div className="flex flex-col gap-10">
      {/* Presets */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Start from a layout</h2>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Pick a starting point, then adjust branding, colours and fields.
            </p>
          </div>
          <Button onClick={() => openEditor(null, stateFromPreset(DOCUMENT_TEMPLATE_PRESETS[0], "Untitled template"))}>
            <Plus />New Template
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {DOCUMENT_TEMPLATE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => openEditor(null, stateFromPreset(preset))}
              className="flex items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-left transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-accent)]"
            >
              <TemplateThumbnail config={preset.layoutConfig as unknown as Record<string, unknown>} className="w-20 shrink-0" />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-semibold">
                  <TypeIcon type={preset.category} />{preset.name}
                </span>
                <span className="mt-1 block text-xs text-[var(--color-muted-foreground)]">{preset.description}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Filter */}
      <div className="flex gap-1 rounded-md border border-[var(--color-border)] p-1 self-start" role="tablist">
        {filters.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "rounded px-3 py-1 text-sm transition-colors",
              filter === f.value
                ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">My Templates</h2>
        {mine.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-[var(--color-muted-foreground)]">
              {templates.length === 0
                ? "You haven't created any templates yet. Start from a layout above."
                : "No templates match this filter."}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {mine.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                onEdit={() => openEditor(t, stateFromTemplate(t))}
                onDuplicate={() => openEditor(null, stateFromTemplate(t, `${t.name} (copy)`))}
                onDelete={() => setDeleting(t)}
              />
            ))}
          </div>
        )}
      </section>

      {shared.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Public Templates</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {shared.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                onEdit={() => undefined}
                onDuplicate={() => openEditor(null, { ...stateFromTemplate(t, `${t.name} (copy)`), isPublic: false })}
                onDelete={() => undefined}
              />
            ))}
          </div>
        </section>
      )}

      {editor && (
        <TemplateEditorDialog
          key={editor.key}
          open
          editing={editor.editing}
          initial={editor.initial}
          onOpenChange={(open) => !open && setEditor(null)}
          onSaved={handleSaved}
        />
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && !isDeleting && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The template is removed permanently. PDFs that were already generated are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={isDeleting}
              className="bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)]"
            >
              {isDeleting && <Loader2 className="animate-spin" />}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
