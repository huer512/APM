import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import * as api from "../lib/api";
import * as desktop from "../lib/desktop";
import { useApp } from "../context/AppContext";
import type { Catalog, CatalogItem } from "../lib/types";
import {
  parseConfigDocument,
  serializeConfigDocument,
  type ConfigData,
  type ConfigDocument,
  type EntryDoc,
  type HostDoc,
  type PromptDoc,
  type StageDoc,
} from "../lib/configDocuments";
import { PageHeader } from "../components/UI";
import { MarkdownContent } from "../components/MarkdownContent";

type Category = "prompts" | "stages" | "hosts" | "entries";
type StudioDialog =
  | { type: "create"; value: string }
  | { type: "rename"; value: string; item: CatalogItem }
  | { type: "delete"; item: CatalogItem }
  | null;

const CATEGORIES: Array<{ id: Category; label: string }> = [
  { id: "prompts", label: "提示词" },
  { id: "stages", label: "阶段" },
  { id: "hosts", label: "主机" },
  { id: "entries", label: "入口" },
];

const APM_TOOL_PRESETS = [
  { value: "off", label: "关闭", description: "不向该提示词注入 APM 控制工具" },
  { value: "inspect", label: "只读查看", description: "查看工作流、实例、消息和系统状态" },
  { value: "control", label: "运行控制", description: "允许暂停、恢复、停止、接管消息等操作" },
  { value: "orchestrate", label: "编排控制", description: "允许修改当前实例后续阶段计划" },
  { value: "admin", label: "管理权限", description: "包含配置写入等高风险操作" },
  { value: "custom", label: "自定义", description: "只启用下方显式列出的 op" },
];

const APM_TOOL_OPS = [
  "help",
  "capabilities",
  "schema.get",
  "context.current",
  "workflow.list",
  "workflow.get",
  "entry.get",
  "stage.get",
  "prompt.get",
  "host.get",
  "run.list",
  "run.current",
  "run.get",
  "run.events",
  "run.messages",
  "run.outputs",
  "run.variables",
  "run.pause",
  "run.resume",
  "run.stop",
  "run.rerun",
  "run.start",
  "run.set_note",
  "run.set_tag",
  "stage_plan.get",
  "stage_plan.update",
  "attach.status",
  "attach.request",
  "attach.release",
  "attach.next",
  "attach.message",
  "system.health",
  "system.limits",
  "daemon.status",
  "config.validate",
  "config.preview_patch",
  "config.apply_patch",
  "control.confirm",
  "control.cancel",
  "audit.write",
];

const EDITOR_THEME = EditorView.theme({
  "&": {
    minHeight: "100%",
    backgroundColor: "#071019",
    color: "#d7e4f2",
    fontSize: "13px",
  },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    lineHeight: "1.7",
  },
  ".cm-content": {
    padding: "14px 0",
  },
  ".cm-line": {
    padding: "0 18px",
  },
  ".cm-gutters": {
    backgroundColor: "#071019",
    color: "#526780",
    borderRight: "1px solid #173048",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(47, 129, 255, 0.12)",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(47, 129, 255, 0.07)",
  },
  ".cm-selectionBackground": {
    backgroundColor: "rgba(47, 129, 255, 0.28) !important",
  },
});

function validateFrontmatter(content: string): string | null {
  if (!content.startsWith("---")) {
    return null;
  }
  const end = content.indexOf("---", 3);
  if (end < 0) {
    return "frontmatter 缺少结束 ---";
  }
  const block = content.slice(3, end).trim();
  if (block.length === 0) {
    return null;
  }
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (!trimmed.includes(":")) {
      return `frontmatter 行格式无效: ${trimmed}`;
    }
  }
  return null;
}

export function Studio() {
  const { daemonStatus } = useApp();
  const [searchParams] = useSearchParams();
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [category, setCategory] = useState<Category>("entries");
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [content, setContent] = useState("");
  const [document, setDocument] = useState<ConfigDocument | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [editorHost, setEditorHost] = useState<HTMLDivElement | null>(null);
  const [editorMode, setEditorMode] = useState<"visual" | "source">("visual");
  const [previewMode, setPreviewMode] = useState<"preview" | "source">("preview");
  const [dialog, setDialog] = useState<StudioDialog>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [editorPercent, setEditorPercent] = useState(62);
  const viewRef = useRef<EditorView | null>(null);
  const lastAutoOpenRef = useRef("");

  useEffect(() => {
    if (!daemonStatus?.httpReachable) {
      return;
    }
    void api.fetchCatalog().then(setCatalog);
  }, [daemonStatus?.httpReachable]);

  useEffect(() => {
    if (!catalog) {
      return;
    }
    const requestedCategory = searchParams.get("category") as Category | null;
    const requestedFile = searchParams.get("file");
    if (!requestedCategory || !CATEGORIES.some((item) => item.id === requestedCategory)) {
      return;
    }
    const key = `${requestedCategory}:${requestedFile ?? ""}`;
    if (lastAutoOpenRef.current === key) {
      return;
    }
    lastAutoOpenRef.current = key;
    setCategory(requestedCategory);
    const candidates = catalog[requestedCategory] ?? [];
    const item = requestedFile
      ? candidates.find((candidate) => candidate.path === requestedFile || candidate.name === requestedFile.replace(/\.md$/i, ""))
      : candidates[0];
    if (item) {
      void loadFile(item, requestedCategory);
    }
  }, [catalog, searchParams]);

  useEffect(() => {
    if (!editorHost) {
      return;
    }
    const v = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          markdown(),
          EditorView.lineWrapping,
          EDITOR_THEME,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              setContent(u.state.doc.toString());
            }
          }),
        ],
      }),
      parent: editorHost,
    });
    viewRef.current = v;
    return () => {
      v.destroy();
      viewRef.current = null;
    };
  }, [editorHost, selected?.path]);

  const items = catalog?.[category] ?? [];
  const charCount = content.length;
  const lineCount = content.length === 0 ? 1 : content.split("\n").length;

  const refreshCatalog = async () => {
    const cat = await api.fetchCatalog();
    setCatalog(cat);
    return cat;
  };

  const replaceEditorText = (text: string) => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    });
  };

  const setStructuredDocument = (doc: ConfigDocument) => {
    setDocument(doc);
    setContent(doc.raw);
    replaceEditorText(doc.raw);
  };

  const loadFile = async (item: CatalogItem, kind: Category = category) => {
    setSelected(item);
    setValidationError(null);
    setLoadError(null);
    setStatus("");
    setLoadingFile(true);
    try {
      const text = await desktop.readApmTextFile(item.path);
      setStructuredDocument(parseConfigDocument(kind, item, text));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setContent("");
      setDocument(null);
      setLoadError(message);
      replaceEditorText("");
    } finally {
      setLoadingFile(false);
    }
  };

  const saveFile = async () => {
    if (!selected) {
      return;
    }
    const raw = editorMode === "source" ? content : document ? serializeConfigDocument(document) : content;
    const err = validateFrontmatter(raw);
    setValidationError(err);
    if (err) {
      return;
    }
    try {
      await desktop.writeApmTextFile(selected.path, raw);
      setStructuredDocument(parseConfigDocument(category, selected, raw));
      setStatus(`已保存 ${selected.path}（对进行中的 run 不生效，请新开 run）`);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveAndApply = async () => {
    await saveFile();
    setStatus("已保存。新的 run 会加载最新配置。进行中的 run 不会被热更新。");
  };

  const insertText = (before: string, after = "") => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const range = view.state.selection.main;
    const selectedText = view.state.doc.sliceString(range.from, range.to);
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: `${before}${selectedText}${after}` },
      selection: { anchor: range.from + before.length, head: range.from + before.length + selectedText.length },
    });
    view.focus();
  };

  const createNew = async (rawName: string) => {
    const name = sanitizeFileStem(rawName);
    if (!name) {
      return;
    }
    const rel = `${category}/${name}.md`;
    const template =
      category === "entries"
        ? `---\nentry: stage_a\nhost: local\ntask: 描述任务\n---\n# ${name}\n`
        : category === "hosts"
          ? `---\nhost: localhost\nworkspace: .\n---\n# ${name}\n`
          : category === "stages"
            ? `## 提示词\n- prompt_a\n\n## 后继阶段\n`
            : `---\nmodel: auto\n---\n# ${name}\n`;
    await desktop.writeApmTextFile(rel, template);
    const cat = await refreshCatalog();
    const item = cat[category].find((i) => i.name === name);
    if (item) {
      await loadFile(item);
    }
  };

  const renameSelected = async (item: CatalogItem, rawName: string) => {
    const name = sanitizeFileStem(rawName);
    if (!name) {
      return;
    }
    const newPath = `${category}/${name}.md`;
    await desktop.renameApmFile(item.path, newPath);
    const cat = await refreshCatalog();
    const next = cat[category].find((entry) => entry.path === newPath);
    if (next) {
      await loadFile(next);
    }
  };

  const deleteSelected = async (item: CatalogItem) => {
    await desktop.deleteApmFile(item.path);
    setSelected(null);
    setContent("");
    setDocument(null);
    replaceEditorText("");
    await refreshCatalog();
  };

  const updateVisualDocument = (data: ConfigData) => {
    if (!document) {
      return;
    }
    const raw = serializeConfigDocument({ ...document, data });
    const parsed = parseConfigDocument(document.kind, document.item, raw);
    const next = { ...parsed, data, raw };
    setDocument(next);
    setContent(next.raw);
    replaceEditorText(next.raw);
  };

  const toggleEditorMode = () => {
    if (editorMode === "source") {
      if (selected) {
        setDocument(parseConfigDocument(category, selected, content));
      }
      setEditorMode("visual");
      return;
    }
    setEditorMode("source");
  };

  const submitDialog = async () => {
    if (!dialog) {
      return;
    }
    setDialogBusy(true);
    setLoadError(null);
    try {
      if (dialog.type === "create") {
        await createNew(dialog.value);
      } else if (dialog.type === "rename") {
        await renameSelected(dialog.item, dialog.value);
      } else {
        await deleteSelected(dialog.item);
      }
      setDialog(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setDialogBusy(false);
    }
  };

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const layout = layoutRef.current;
    if (!layout) {
      return;
    }
    event.preventDefault();
    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(pointerId);
    const onMove = (moveEvent: PointerEvent) => {
      const rect = layout.getBoundingClientRect();
      const leftPaneWidth = treeCollapsed ? 12 : 270;
      const available = rect.width - leftPaneWidth - 10;
      const editorWidth = moveEvent.clientX - rect.left - leftPaneWidth;
      const next = Math.round((editorWidth / available) * 100);
      setEditorPercent(Math.min(72, Math.max(38, next)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  return (
    <div className="studio-page">
      <PageHeader
        title="配置管理"
        description="编辑 APM_HOME 下的 Markdown 配置。保存后需新启动 run 才会加载新配置。"
        actions={
          <>
            <button type="button" disabled={!selected || loadingFile} onClick={() => void saveFile()}>
              保存
            </button>
            <button type="button" className="primary" disabled={!selected || loadingFile} onClick={() => void saveAndApply()}>
              保存并应用
            </button>
            <button type="button" disabled={!selected} onClick={toggleEditorMode}>
              {editorMode === "visual" ? "编辑源代码" : "返回可视化"}
            </button>
          </>
        }
      />

      <div
        ref={layoutRef}
        className={`studio-layout ${treeCollapsed ? "tree-collapsed" : ""} ${editorMode === "source" ? "source-mode" : "visual-mode"}`}
        style={{
          gridTemplateColumns:
            editorMode === "source"
              ? treeCollapsed
                ? `0 12px minmax(360px, ${editorPercent}fr) 10px minmax(320px, ${100 - editorPercent}fr)`
                : `260px 10px minmax(420px, ${editorPercent}fr) 10px minmax(320px, ${100 - editorPercent}fr)`
              : treeCollapsed
                ? "0 12px minmax(0, 1fr)"
                : "260px 10px minmax(0, 1fr)",
        }}
      >
        <aside className="studio-tree">
          {!treeCollapsed && (
            <>
              <div className="studio-space">
                <label>选择配置空间</label>
                <CustomSelectBox value="demo" options={[{ value: "demo", label: "demo" }]} onChange={() => undefined} />
                <button type="button" className="primary subtle" onClick={() => setDialog({ type: "create", value: "" })}>
                  + 新建配置
                </button>
              </div>
              <div className="studio-category-list">
                <span>配置文件</span>
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={category === c.id ? "active" : ""}
                    onClick={() => {
                      setCategory(c.id);
                      setSelected(null);
                      setDocument(null);
                      setContent("");
                      replaceEditorText("");
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <div className="studio-file-list">
                {items.map((item) => (
                  <button
                    key={item.path}
                    type="button"
                    className={selected?.path === item.path ? "active" : ""}
                    onClick={() => void loadFile(item)}
                  >
                    <strong>{item.name}</strong>
                    <small>{item.path}</small>
                  </button>
                ))}
                {items.length === 0 && <div className="empty-state">暂无 {category} 文件</div>}
              </div>
              <div className="studio-tree-actions">
                <button
                  type="button"
                  disabled={!selected}
                  onClick={() => selected && setDialog({ type: "rename", item: selected, value: selected.name })}
                >
                  重命名
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={!selected}
                  onClick={() => selected && setDialog({ type: "delete", item: selected })}
                >
                  删除
                </button>
              </div>
            </>
          )}
        </aside>
        <div className="studio-tree-collapse-rail">
          <button
            type="button"
            className="studio-tree-toggle"
            onClick={() => setTreeCollapsed((value) => !value)}
            title={treeCollapsed ? "展开配置栏" : "收起配置栏"}
            aria-label={treeCollapsed ? "展开配置栏" : "收起配置栏"}
          />
        </div>

        <section className="studio-editor-panel">
          {selected ? (
            <>
              <div className="studio-file-header">
                <div>
                  <strong>{displayFileName(selected)}</strong>
                  <span>{selected.path}</span>
                </div>
                <span className="mode-pill">{editorMode === "visual" ? "可视化编辑" : "源码编辑"}</span>
              </div>
              {editorMode === "source" && (
                <div className="markdown-toolbar">
                  <button type="button" onClick={() => insertText("# ")}>H</button>
                  <button type="button" onClick={() => insertText("**", "**")}>B</button>
                  <button type="button" onClick={() => insertText("_", "_")}>I</button>
                  <button type="button" onClick={() => insertText("`", "`")}>{"</>"}</button>
                  <button type="button" onClick={() => insertText("[", "](url)")}>Link</button>
                  <button type="button" onClick={() => insertText("![alt](", ")")}>Img</button>
                  <button type="button" onClick={() => insertText("- ")}>List</button>
                  <button type="button" onClick={() => insertText("> ")}>Quote</button>
                  <button type="button" onClick={() => insertText("\n```yaml\n", "\n```\n")}>YAML</button>
                </div>
              )}
              {(loadingFile || loadError || validationError || status) && (
                <div className="studio-message-row">
                  {loadingFile && <span className="muted">正在加载 {selected.path}...</span>}
                  {loadError && <span className="danger-text">{loadError}</span>}
                  {validationError && <span className="danger-text">{validationError}</span>}
                  {status && <span className="success-text">{status}</span>}
                </div>
              )}
              {editorMode === "visual" ? (
                <>
                  <VisualConfigEditor doc={document} catalog={catalog} onChange={updateVisualDocument} />
                  <div className="editor-statusbar">
                    <span>{document?.errors.length ? `${document.errors.length} 个配置问题` : "结构化配置"}</span>
                    <span>{selected.path}</span>
                    <strong>{category}</strong>
                  </div>
                </>
              ) : (
                <>
                  <div className="editor-wrap" ref={setEditorHost} />
                  <div className="editor-statusbar">
                    <span>行 {lineCount}</span>
                    <span>{charCount} 字符</span>
                    <span>{selected.path}</span>
                    <strong>Markdown</strong>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="studio-empty-editor">
              <h2>选择配置文件</h2>
              <p>从左侧选择一个 Markdown 配置，或新建工作流、阶段、Prompt、主机配置。</p>
            </div>
          )}
        </section>

        {editorMode === "source" && (
          <>
            <div
              className="studio-resizer"
              role="separator"
              aria-orientation="vertical"
              title="拖动调整编辑器和预览宽度"
              onPointerDown={beginResize}
            />

            <aside className="studio-preview-panel">
              <div className="studio-preview-tabs">
                <button type="button" className={previewMode === "preview" ? "active" : ""} onClick={() => setPreviewMode("preview")}>
                  预览
                </button>
                <button type="button" className={previewMode === "source" ? "active" : ""} onClick={() => setPreviewMode("source")}>
                  源代码
                </button>
              </div>
              {selected ? (
                previewMode === "preview" ? (
                  <MarkdownPreview content={content} />
                ) : (
                  <pre className="json-box studio-source-preview">{content}</pre>
                )
              ) : (
                <div className="studio-preview-empty">选择文件后显示实时预览。</div>
              )}
            </aside>
          </>
        )}
      </div>
      <StudioModal
        dialog={dialog}
        busy={dialogBusy}
        onChange={(value) => {
          if (dialog?.type === "create") {
            setDialog({ ...dialog, value });
          } else if (dialog?.type === "rename") {
            setDialog({ ...dialog, value });
          }
        }}
        onCancel={() => setDialog(null)}
        onSubmit={() => void submitDialog()}
      />
    </div>
  );
}

function sanitizeFileStem(input: string): string {
  return input.trim().replace(/\.md$/i, "").replace(/[\\/]/g, "");
}

function VisualConfigEditor({
  doc,
  catalog,
  onChange,
}: {
  doc: ConfigDocument | null;
  catalog: Catalog | null;
  onChange: (data: ConfigData) => void;
}) {
  if (!doc) {
    return (
      <div className="visual-editor empty">
        <h2>无法解析配置</h2>
        <p>切换到源码编辑检查文件内容。</p>
      </div>
    );
  }

  return (
    <div className="visual-editor">
      {doc.errors.length > 0 && (
        <div className="visual-errors">
          <strong>配置需要处理</strong>
          {doc.errors.map((error) => (
            <span key={error}>{error}</span>
          ))}
        </div>
      )}
      {doc.kind === "entries" && (
        <EntryVisualEditor doc={doc.data as EntryDoc} catalog={catalog} onChange={(data) => onChange(data)} />
      )}
      {doc.kind === "stages" && (
        <StageVisualEditor doc={doc.data as StageDoc} catalog={catalog} onChange={(data) => onChange(data)} />
      )}
      {doc.kind === "prompts" && <PromptVisualEditor doc={doc.data as PromptDoc} onChange={(data) => onChange(data)} />}
      {doc.kind === "hosts" && <HostVisualEditor doc={doc.data as HostDoc} onChange={(data) => onChange(data)} />}
    </div>
  );
}

function EntryVisualEditor({
  doc,
  catalog,
  onChange,
}: {
  doc: EntryDoc;
  catalog: Catalog | null;
  onChange: (data: EntryDoc) => void;
}) {
  const stageNames = catalog?.stages.map((item) => item.name) ?? [];
  const hostNames = catalog?.hosts.map((item) => item.name) ?? [];
  return (
    <>
      <div className="visual-section">
        <h3>入口</h3>
        <div className="visual-grid two">
          <ConfigField label="入口阶段" hint="工作流启动时进入的第一个阶段">
            <ComboInput value={doc.entry} options={stageNames} placeholder="stage_a" onChange={(entry) => onChange({ ...doc, entry })} />
          </ConfigField>
          <ConfigField label="默认主机" hint="运行该入口时优先使用的执行环境">
            <ComboInput value={doc.host} options={hostNames} placeholder="local" onChange={(host) => onChange({ ...doc, host })} />
          </ConfigField>
        </div>
      </div>
      <div className="visual-section">
        <h3>变量</h3>
        <PairList
          items={doc.variables}
          keyPlaceholder="变量名，例如 task"
          valuePlaceholder="默认值"
          onChange={(variables) => onChange({ ...doc, variables })}
        />
      </div>
      <div className="visual-section grow">
        <h3>说明文档</h3>
        <textarea
          className="visual-textarea"
          value={doc.description}
          placeholder="入口配置说明，支持 Markdown。"
          onChange={(event) => onChange({ ...doc, description: event.target.value })}
        />
      </div>
    </>
  );
}

function StageVisualEditor({
  doc,
  catalog,
  onChange,
}: {
  doc: StageDoc;
  catalog: Catalog | null;
  onChange: (data: StageDoc) => void;
}) {
  const promptNames = catalog?.prompts.map((item) => item.name) ?? [];
  const stageNames = catalog?.stages.map((item) => item.name) ?? [];
  return (
    <>
      <div className="visual-section">
        <h3>阶段执行</h3>
        <div className="visual-grid two">
          <ConfigField label="Prompt 队列" hint="阶段会按顺序调用这些 Prompt">
            <StringList items={doc.prompts} options={promptNames} placeholder="prompt_a" onChange={(prompts) => onChange({ ...doc, prompts })} />
          </ConfigField>
          <ConfigField label="后继阶段" hint="本阶段完成后可进入的下一组阶段">
            <StringList
              items={doc.nextStages}
              options={stageNames}
              placeholder="next_stage"
              onChange={(nextStages) => onChange({ ...doc, nextStages })}
            />
          </ConfigField>
        </div>
      </div>
    </>
  );
}

function PromptVisualEditor({ doc, onChange }: { doc: PromptDoc; onChange: (data: PromptDoc) => void }) {
  return (
    <>
      <div className="visual-section">
        <h3>提示词参数</h3>
        <div className="visual-grid two">
          <div className="prompt-params">
            <ConfigField label="模型" hint="使用 auto 时由 Daemon 选择默认模型">
              <input value={doc.model} placeholder="auto" onChange={(event) => onChange({ ...doc, model: event.target.value })} />
            </ConfigField>
            <div className="param-toggle-row">
              <div>
                <strong>项目 Skills</strong>
                <span>开启后 Cursor SDK 会加载项目级设置和 Skills。</span>
              </div>
              <label className="switch">
                <input type="checkbox" checked={doc.skills} onChange={(event) => onChange({ ...doc, skills: event.target.checked })} />
                <span />
              </label>
            </div>
            <ConfigField label="APM 工具" hint="开启后会向该 Prompt 注入单个 apm({op,args}) 工具，用于查看或控制当前工作流实例。">
              <CustomSelectBox
                value={doc.apmTools}
                options={APM_TOOL_PRESETS}
                onChange={(apmTools) => onChange({ ...doc, apmTools })}
              />
            </ConfigField>
          </div>
          <ConfigField label="自定义字段" hint="这些 frontmatter 字段会作为变量注入 Prompt，可在正文中用 {字段名} 引用。">
            <PairList
              items={doc.metadata}
              keyPlaceholder="字段名，例如 topic"
              valuePlaceholder="字段值，可使用 {task}"
              onChange={(metadata) => onChange({ ...doc, metadata })}
            />
          </ConfigField>
        </div>
      </div>
      {doc.apmTools !== "off" && (
        <div className="visual-section">
          <h3>APM 工具权限</h3>
          <ConfigField label="显式 op 列表" hint="留空时使用上方预设；填写后只启用这里列出的操作。可在下拉中选择，也可输入自定义 op。">
            <StringList
              items={doc.apmOps}
              options={APM_TOOL_OPS}
              placeholder="stage_plan.update"
              onChange={(apmOps) => onChange({ ...doc, apmOps })}
            />
          </ConfigField>
        </div>
      )}
      <div className="visual-section grow">
        <h3>Prompt 内容</h3>
        <textarea
          className="visual-textarea code"
          value={doc.body}
          placeholder="在这里编写 Prompt 正文，可使用 {task} 等变量。"
          onChange={(event) => onChange({ ...doc, body: event.target.value })}
        />
      </div>
    </>
  );
}

function HostVisualEditor({ doc, onChange }: { doc: HostDoc; onChange: (data: HostDoc) => void }) {
  return (
    <>
      <div className="visual-section">
        <h3>连接信息</h3>
        <div className="visual-grid three">
          <ConfigField label="主机" hint="本机可使用 localhost">
            <input value={doc.host} placeholder="localhost" onChange={(event) => onChange({ ...doc, host: event.target.value })} />
          </ConfigField>
          <ConfigField label="端口" hint="SSH 或自定义连接端口">
            <input value={doc.port} placeholder="22" onChange={(event) => onChange({ ...doc, port: event.target.value })} />
          </ConfigField>
          <ConfigField label="用户名" hint="远程主机登录用户">
            <input value={doc.username} placeholder="root" onChange={(event) => onChange({ ...doc, username: event.target.value })} />
          </ConfigField>
        </div>
      </div>
      <div className="visual-section">
        <h3>运行环境</h3>
        <div className="visual-grid two">
          <ConfigField label="工作目录" hint="Agent 执行任务时使用的 workspace">
            <input value={doc.workspace} placeholder="." onChange={(event) => onChange({ ...doc, workspace: event.target.value })} />
          </ConfigField>
          <ConfigField label="虚拟环境" hint="可选，例如 .venv/bin/activate">
            <input value={doc.virtualEnv} placeholder=".venv" onChange={(event) => onChange({ ...doc, virtualEnv: event.target.value })} />
          </ConfigField>
        </div>
      </div>
      <div className="visual-section grow">
        <h3>凭据</h3>
        <div className="visual-grid two stretch">
          <ConfigField label="密码" hint="可留空，保存时仍写入 Markdown frontmatter">
            <textarea
              className="visual-textarea compact"
              value={doc.password}
              placeholder="password"
              onChange={(event) => onChange({ ...doc, password: event.target.value })}
            />
          </ConfigField>
          <ConfigField label="私钥" hint="支持粘贴 PEM 私钥内容或路径">
            <textarea
              className="visual-textarea compact code"
              value={doc.privateKey}
              placeholder="~/.ssh/id_rsa"
              onChange={(event) => onChange({ ...doc, privateKey: event.target.value })}
            />
          </ConfigField>
        </div>
      </div>
    </>
  );
}

function ConfigField({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <label className="visual-field">
      <span>{label}</span>
      {children}
      <small>{hint}</small>
    </label>
  );
}

function ComboInput({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string;
  options: string[];
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <CustomSelectBox
      value={value}
      options={options.map((option) => ({ value: option, label: option }))}
      placeholder={placeholder}
      allowCustom
      customLabel="自定义"
      onChange={onChange}
    />
  );
}

function StringList({
  items,
  options,
  placeholder,
  onChange,
}: {
  items: string[];
  options: string[];
  placeholder: string;
  onChange: (items: string[]) => void;
}) {
  const nextItems = items.length > 0 ? items : [""];
  return (
    <div className="visual-list">
      {nextItems.map((item, index) => (
        <div className="visual-list-row" key={index}>
          <ComboInput
            value={item}
            options={options}
            placeholder={placeholder}
            onChange={(value) => onChange(nextItems.map((current, i) => (i === index ? value : current)))}
          />
          <button type="button" disabled={nextItems.length === 1} onClick={() => onChange(nextItems.filter((_, i) => i !== index))}>
            删除
          </button>
        </div>
      ))}
      <button type="button" className="subtle-action" onClick={() => onChange([...nextItems, ""])}>
        + 添加
      </button>
    </div>
  );
}

function PairList({
  items,
  keyPlaceholder,
  valuePlaceholder,
  onChange,
}: {
  items: Array<{ key: string; value: string }>;
  keyPlaceholder: string;
  valuePlaceholder: string;
  onChange: (items: Array<{ key: string; value: string }>) => void;
}) {
  const rows = items.length > 0 ? items : [{ key: "", value: "" }];
  return (
    <div className="visual-pairs">
      {rows.map((item, index) => (
        <div className="visual-pair-row" key={index}>
          <input
            value={item.key}
            placeholder={keyPlaceholder}
            onChange={(event) => onChange(rows.map((row, i) => (i === index ? { ...row, key: event.target.value } : row)))}
          />
          <input
            value={item.value}
            placeholder={valuePlaceholder}
            onChange={(event) => onChange(rows.map((row, i) => (i === index ? { ...row, value: event.target.value } : row)))}
          />
          <button type="button" disabled={rows.length === 1} onClick={() => onChange(rows.filter((_, i) => i !== index))}>
            删除
          </button>
        </div>
      ))}
      <button type="button" className="subtle-action" onClick={() => onChange([...rows, { key: "", value: "" }])}>
        + 添加字段
      </button>
    </div>
  );
}

function CustomSelectBox({
  value,
  options,
  placeholder = "请选择",
  allowCustom = false,
  customLabel = "自定义",
  customPlaceholder = "输入自定义值",
  customValueLabel,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string; description?: string }>;
  placeholder?: string;
  allowCustom?: boolean;
  customLabel?: string;
  customPlaceholder?: string;
  customValueLabel?: (value: string) => string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);
  const label = selected?.label ?? (value ? (customValueLabel ? customValueLabel(value) : value) : placeholder);

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const submitCustom = () => {
    const next = customValue.trim();
    if (!next) {
      return;
    }
    onChange(next);
    setCustomValue("");
    setOpen(false);
  };

  return (
    <div className="custom-select" ref={rootRef}>
      <button type="button" className="custom-select-trigger" onClick={() => setOpen((next) => !next)}>
        <span>{label}</span>
        <b aria-hidden="true" />
      </button>
      {open && (
        <div className="custom-select-menu">
          <div className="custom-select-options">
            {options.map((option) => (
              <button
                type="button"
                key={option.value}
                className={option.value === value ? "active" : ""}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <strong>{option.label}</strong>
                {option.description && <small>{option.description}</small>}
              </button>
            ))}
          </div>
          {allowCustom && (
            <div className="custom-select-custom">
              <span>+ {customLabel}</span>
              <div>
                <input
                  value={customValue}
                  placeholder={customPlaceholder}
                  onChange={(event) => setCustomValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitCustom();
                    }
                  }}
                />
                <button type="button" disabled={!customValue.trim()} onClick={submitCustom}>
                  添加
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StudioModal({
  dialog,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  dialog: StudioDialog;
  busy: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  if (!dialog) {
    return null;
  }
  const isDelete = dialog.type === "delete";
  const title = dialog.type === "create" ? "新建配置" : dialog.type === "rename" ? "重命名配置" : "删除配置";
  const description =
    dialog.type === "create"
      ? "输入文件名即可创建当前分类下的 Markdown 配置。"
      : dialog.type === "rename"
        ? `将 ${dialog.item.path} 重命名为新的 Markdown 文件。`
        : `确认删除 ${dialog.item.path}。删除后无法从桌面端恢复。`;
  const value = dialog.type === "delete" ? "" : dialog.value;
  const canSubmit = isDelete || sanitizeFileStem(value).length > 0;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section className="app-modal" role="dialog" aria-modal="true" aria-labelledby="studio-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2 id="studio-modal-title">{title}</h2>
            <p>{description}</p>
          </div>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="关闭">
            x
          </button>
        </header>
        {!isDelete && (
          <label className="modal-field">
            <span>文件名</span>
            <input
              autoFocus
              value={value}
              placeholder="例如 review_structure"
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canSubmit) {
                  onSubmit();
                }
              }}
            />
            <small>会自动保存为 `.md`，不允许包含路径分隔符。</small>
          </label>
        )}
        {isDelete && (
          <div className="delete-summary">
            <strong>{dialog.item.name}</strong>
            <span>{dialog.item.path}</span>
          </div>
        )}
        <footer>
          <button type="button" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button type="button" className={isDelete ? "danger" : "primary"} disabled={busy || !canSubmit} onClick={onSubmit}>
            {busy ? "处理中..." : isDelete ? "删除" : "确认"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function displayFileName(item: CatalogItem): string {
  const parts = item.path.split("/");
  return parts[parts.length - 1] ?? item.name;
}

function MarkdownPreview({ content }: { content: string }) {
  return <MarkdownContent content={content} className="markdown-preview" />;
}
