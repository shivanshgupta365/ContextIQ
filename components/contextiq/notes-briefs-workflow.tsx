"use client";

import { useMemo, useState, useTransition } from "react";
import { FileText, LoaderCircle, NotebookPen, Sparkles, UploadCloud } from "lucide-react";

import {
  saveWorkspaceDocumentAction,
  transformNotesBriefContentAction,
} from "@/lib/actions/contextiq";
import { Badge, SurfaceCard } from "@/components/contextiq/primitives";
import type {
  NotesBriefTransformMode,
  NotesBriefTransformResult,
  ProviderReadinessStatus,
} from "@/types";

const TRANSFORM_OPTIONS: Array<{
  mode: NotesBriefTransformMode;
  label: string;
  description: string;
  kind: string;
}> = [
  {
    mode: "summarize",
    label: "Summarize",
    description: "Condense the source into the key points only.",
    kind: "summary",
  },
  {
    mode: "paraphrase",
    label: "Paraphrase",
    description: "Rewrite the source while preserving meaning.",
    kind: "paraphrase",
  },
  {
    mode: "brief",
    label: "Brief",
    description: "Turn the source into an executive-style brief.",
    kind: "brief",
  },
  {
    mode: "email_draft",
    label: "Email Draft",
    description: "Convert the source into a polished email draft.",
    kind: "email_draft",
  },
];

function getDefaultKind(mode: NotesBriefTransformMode) {
  return TRANSFORM_OPTIONS.find((option) => option.mode === mode)?.kind ?? "brief";
}

function trimFileExtension(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

export function NotesBriefsWorkflow({
  workspaceId,
  accounts,
  notionReadiness,
}: {
  workspaceId: string;
  accounts: Array<{ id: string; name: string }>;
  notionReadiness: ProviderReadinessStatus | null;
}) {
  const [title, setTitle] = useState("");
  const [sourceContent, setSourceContent] = useState("");
  const [mode, setMode] = useState<NotesBriefTransformMode>("brief");
  const [kind, setKind] = useState(getDefaultKind("brief"));
  const [accountId, setAccountId] = useState("");
  const [saveAsNote, setSaveAsNote] = useState(false);
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null);
  const [result, setResult] = useState<NotesBriefTransformResult | null>(null);
  const [transformError, setTransformError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [generatedFrom, setGeneratedFrom] = useState<string | null>(null);
  const [isTransformPending, startTransformTransition] = useTransition();
  const [isSavePending, startSaveTransition] = useTransition();

  const currentFingerprint = useMemo(
    () => JSON.stringify([title.trim(), sourceContent, mode]),
    [title, sourceContent, mode],
  );
  const activeTransform = TRANSFORM_OPTIONS.find((option) => option.mode === mode) ?? TRANSFORM_OPTIONS[2];
  const resultIsStale = Boolean(result) && generatedFrom !== currentFingerprint;
  const displayContent =
    result && !resultIsStale ? result.content : sourceContent;
  const notionConnected = notionReadiness?.status === "connected";

  const handleModeChange = (nextMode: NotesBriefTransformMode) => {
    setMode(nextMode);
    setKind(getDefaultKind(nextMode));
    setTransformError(null);
    setSaveError(null);
    setSaveSuccess(null);
  };

  const handleFileLoad = async (file: File | null) => {
    if (!file) return;

    setTransformError(null);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      const text = await file.text();
      if (!text.trim()) {
        throw new Error("The selected file is empty.");
      }
      if (text.length > 40000) {
        throw new Error("The selected file is too large for this workflow. Keep it under 40,000 characters.");
      }

      setLoadedFileName(file.name);
      setTitle((current) => current.trim() || trimFileExtension(file.name));
      setSourceContent(text);
      setResult(null);
      setGeneratedFrom(null);
    } catch (error) {
      setTransformError(error instanceof Error ? error.message : "Failed to read the selected file.");
    }
  };

  const handleTransform = () => {
    setTransformError(null);
    setSaveError(null);
    setSaveSuccess(null);

    if (!title.trim()) {
      setTransformError("Add a document title before transforming.");
      return;
    }
    if (sourceContent.trim().length < 20) {
      setTransformError("Paste or load at least 20 characters before transforming.");
      return;
    }

    startTransformTransition(async () => {
      try {
        const transformed = await transformNotesBriefContentAction({
          workspaceId,
          title: title.trim(),
          content: sourceContent,
          mode,
        });
        setResult(transformed);
        setGeneratedFrom(currentFingerprint);
      } catch (error) {
        setTransformError(error instanceof Error ? error.message : "Transform failed.");
      }
    });
  };

  const handleSave = () => {
    setSaveError(null);
    setSaveSuccess(null);
    setTransformError(null);

    const contentToSave = displayContent.trim();
    if (!title.trim()) {
      setSaveError("Add a document title before saving.");
      return;
    }
    if (contentToSave.length < 8) {
      setSaveError("Paste, load, or transform content before saving.");
      return;
    }
    if (saveAsNote && !accountId) {
      setSaveError("Choose an account before saving this document as a note.");
      return;
    }

    startSaveTransition(async () => {
      try {
        const saved = await saveWorkspaceDocumentAction({
          workspaceId,
          accountId: accountId || null,
          contactId: null,
          title: title.trim(),
          content: contentToSave,
          kind,
          saveAsNote,
        });
        setSaveSuccess(
          saved.noteId
            ? "Saved to Brief Documents and created a linked note."
            : "Saved to Brief Documents.",
        );
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Save failed.");
      }
    });
  };

  return (
    <div className="mb-6">
      <SurfaceCard title="Upload And Transform" icon={<NotebookPen size={14} />} memoryCount={0}>
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
                <label className="space-y-2">
                  <span className="text-[12px] font-bold uppercase tracking-widest text-slate-500">
                    Title
                  </span>
                  <input
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setSaveSuccess(null);
                      setSaveError(null);
                    }}
                    placeholder="QBR follow-up notes"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] font-medium text-slate-800 outline-none focus:border-[#2563EB]/40"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-[12px] font-bold uppercase tracking-widest text-slate-500">
                    Load Local File
                  </span>
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5">
                    <input
                      type="file"
                      accept=".txt,.md,.markdown,.csv,.json,.eml,.html,.htm,text/plain,text/markdown,text/csv,application/json,text/html,message/rfc822"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        void handleFileLoad(file);
                        event.currentTarget.value = "";
                      }}
                      className="block w-full text-[13px] font-medium text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-[12px] file:font-bold file:text-white"
                    />
                    <div className="mt-2 flex items-center gap-2 text-[12px] font-medium text-slate-500">
                      <UploadCloud size={14} />
                      <span>{loadedFileName ? `Loaded ${loadedFileName}` : "Text-based files only."}</span>
                    </div>
                  </div>
                </label>
              </div>

              <label className="block space-y-2">
                <span className="text-[12px] font-bold uppercase tracking-widest text-slate-500">
                  Source Content
                </span>
                <textarea
                  value={sourceContent}
                  onChange={(event) => {
                    setSourceContent(event.target.value);
                    setSaveSuccess(null);
                    setSaveError(null);
                  }}
                  placeholder="Paste meeting notes, customer emails, rough bullets, or load a local text file."
                  className="min-h-[260px] w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[14px] font-medium text-slate-800 outline-none focus:border-[#2563EB]/40"
                />
              </label>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-[#2563EB]" />
                  <p className="text-[13px] font-bold uppercase tracking-widest text-slate-500">
                    Transform
                  </p>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                  <label className="space-y-2">
                    <span className="text-[12px] font-bold uppercase tracking-widest text-slate-500">
                      Mode
                    </span>
                    <select
                      value={mode}
                      onChange={(event) =>
                        handleModeChange(event.target.value as NotesBriefTransformMode)
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] font-semibold text-slate-800 outline-none focus:border-[#2563EB]/40"
                    >
                      {TRANSFORM_OPTIONS.map((option) => (
                        <option key={option.mode} value={option.mode}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="text-[12px] font-bold uppercase tracking-widest text-slate-500">
                      Save Kind
                    </span>
                    <select
                      value={kind}
                      onChange={(event) => setKind(event.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] font-semibold text-slate-800 outline-none focus:border-[#2563EB]/40"
                    >
                      <option value="summary">summary</option>
                      <option value="paraphrase">paraphrase</option>
                      <option value="brief">brief</option>
                      <option value="email_draft">email_draft</option>
                    </select>
                  </label>
                </div>
                <p className="mt-3 text-[13px] font-medium text-slate-600">
                  {activeTransform.description}
                </p>
                <button
                  type="button"
                  onClick={handleTransform}
                  disabled={isTransformPending}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-60"
                >
                  {isTransformPending ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {isTransformPending ? "Transforming..." : `Run ${activeTransform.label}`}
                </button>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-bold uppercase tracking-widest text-slate-500">
                      Output
                    </p>
                    <p className="mt-1 text-[13px] font-medium text-slate-600">
                      {result
                        ? `Showing ${activeTransform.label.toLowerCase()} output.`
                        : "No transformed output yet. Saving uses the current draft content."}
                    </p>
                  </div>
                  {result ? <Badge>{result.mode.replaceAll("_", " ")}</Badge> : null}
                </div>
                {resultIsStale ? (
                  <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-800">
                    Source content changed after the last transform. Run the transform again before saving if you want a fresh output.
                  </p>
                ) : null}
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-2 flex items-center gap-2 text-[12px] font-bold uppercase tracking-widest text-slate-500">
                    <FileText size={13} />
                    Preview
                  </div>
                  <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap break-words text-[13px] font-medium text-slate-700">
                    {displayContent || "Paste or load content to start."}
                  </pre>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1.2fr]">
            <label className="space-y-2">
              <span className="text-[12px] font-bold uppercase tracking-widest text-slate-500">
                Link To Account
              </span>
              <select
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] font-semibold text-slate-800 outline-none focus:border-[#2563EB]/40"
              >
                <option value="">No linked account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <input
                type="checkbox"
                checked={saveAsNote}
                onChange={(event) => setSaveAsNote(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <div>
                <p className="text-[13px] font-bold text-slate-800">Also save as note</p>
                <p className="text-[12px] font-medium text-slate-500">
                  Requires a linked account.
                </p>
              </div>
            </label>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-bold uppercase tracking-widest text-slate-500">
                  Notion
                </p>
                <Badge
                  className={
                    notionConnected
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-slate-50 text-slate-500"
                  }
                >
                  {notionConnected ? "connected" : "unavailable"}
                </Badge>
              </div>
              <p className="mt-2 text-[12px] font-medium text-slate-600">
                {notionConnected
                  ? "Notion is connected, but this workflow currently saves inside ContextIQ only."
                  : "Notion export is not available here until the provider is actually connected."}
              </p>
            </div>
          </div>

          {transformError ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] font-medium text-rose-700">
              {transformError}
            </p>
          ) : null}
          {saveError ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] font-medium text-rose-700">
              {saveError}
            </p>
          ) : null}
          {saveSuccess ? (
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-medium text-emerald-700">
              {saveSuccess}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSavePending}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-bold text-white disabled:opacity-60"
            >
              {isSavePending ? <LoaderCircle size={14} className="animate-spin" /> : <NotebookPen size={14} />}
              {isSavePending ? "Saving..." : "Save To Notes / Briefs"}
            </button>
            <p className="text-[12px] font-medium text-slate-500">
              Saves the transformed output when available, otherwise saves the current source content.
            </p>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
