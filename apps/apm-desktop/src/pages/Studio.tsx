import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import * as api from "../lib/api";
import * as desktop from "../lib/desktop";
import { useApp } from "../context/AppContext";
import type { Catalog, CatalogItem } from "../lib/types";
import { PageHeader } from "../components/UI";

type Category = "prompts" | "stages" | "hosts" | "entries";
type StudioDialog =
  | { type: "create"; value: string }
  | { type: "rename"; value: string; item: CatalogItem }
  | { type: "delete"; item: CatalogItem }
  | null;

const CATEGORIES: Array<{ id: Category; label: string }> = [
  { id: "prompts", label: "Prompts" },
  { id: "stages", label: "Stages" },
  { id: "hosts", label: "Hosts" },
  { id: "entries", label: "Entries" },
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
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [category, setCategory] = useState<Category>("entries");
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [content, setContent] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [editorHost, setEditorHost] = useState<HTMLDivElement | null>(null);
  const [previewMode, setPreviewMode] = useState<"preview" | "source">("preview");
  const [dialog, setDialog] = useState<StudioDialog>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [editorPercent, setEditorPercent] = useState(62);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!daemonStatus?.httpReachable) {
      return;
    }
    void api.fetchCatalog().then(setCatalog);
  }, [daemonStatus?.httpReachable]);

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

  const loadFile = async (item: CatalogItem) => {
    setSelected(item);
    setValidationError(null);
    setLoadError(null);
    setStatus("");
    setLoadingFile(true);
    try {
      const text = await desktop.readApmTextFile(item.path);
      setContent(text);
      viewRef.current?.dispatch({
        changes: { from: 0, to: viewRef.current.state.doc.length, insert: text },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setContent("");
      setLoadError(message);
      viewRef.current?.dispatch({
        changes: { from: 0, to: viewRef.current.state.doc.length, insert: "" },
      });
    } finally {
      setLoadingFile(false);
    }
  };

  const saveFile = async () => {
    if (!selected) {
      return;
    }
    const err = validateFrontmatter(content);
    setValidationError(err);
    if (err) {
      return;
    }
    try {
      await desktop.writeApmTextFile(selected.path, content);
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
    viewRef.current?.dispatch({
      changes: { from: 0, to: viewRef.current.state.doc.length, insert: "" },
    });
    await refreshCatalog();
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
      const leftPaneWidth = treeCollapsed ? 58 : 270;
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
        title="配置工作室"
        description="编辑 APM_HOME 下的 Markdown 配置。保存后需新启动 run 才会加载新配置。"
        actions={
          <>
            <button type="button" disabled={!selected || loadingFile} onClick={() => void saveFile()}>
              保存
            </button>
            <button type="button" className="primary" disabled={!selected || loadingFile} onClick={() => void saveAndApply()}>
              保存并应用
            </button>
            <button type="button" disabled={!selected} onClick={() => setPreviewMode((mode) => (mode === "preview" ? "source" : "preview"))}>
              {previewMode === "preview" ? "源代码" : "预览"}
            </button>
          </>
        }
      />

      <div
        ref={layoutRef}
        className={`studio-layout ${treeCollapsed ? "tree-collapsed" : ""}`}
        style={{
          gridTemplateColumns: treeCollapsed
            ? `48px 10px minmax(360px, ${editorPercent}fr) 10px minmax(320px, ${100 - editorPercent}fr)`
            : `260px 10px minmax(420px, ${editorPercent}fr) 10px minmax(320px, ${100 - editorPercent}fr)`,
        }}
      >
        <aside className="studio-tree">
          {!treeCollapsed && (
            <>
              <div className="studio-space">
                <label>选择配置空间</label>
                <select value="demo" onChange={() => undefined}>
                  <option value="demo">demo</option>
                </select>
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
              <div className="studio-tabs">
                <button type="button" className="active">
                  {displayFileName(selected)}
                </button>
                <button type="button" onClick={() => setDialog({ type: "create", value: "" })}>
                  +
                </button>
              </div>
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
              {(loadingFile || loadError || validationError || status) && (
                <div className="studio-message-row">
                  {loadingFile && <span className="muted">正在加载 {selected.path}...</span>}
                  {loadError && <span className="danger-text">{loadError}</span>}
                  {validationError && <span className="danger-text">{validationError}</span>}
                  {status && <span className="success-text">{status}</span>}
                </div>
              )}
              <div className="editor-wrap" ref={setEditorHost} />
              <div className="editor-statusbar">
                <span>行 {lineCount}</span>
                <span>{charCount} 字符</span>
                <span>{selected.path}</span>
                <strong>Markdown</strong>
              </div>
            </>
          ) : (
            <div className="studio-empty-editor">
              <h2>选择配置文件</h2>
              <p>从左侧选择一个 Markdown 配置，或新建工作流、阶段、Prompt、主机配置。</p>
            </div>
          )}
        </section>

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
              可视化预览
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
  const blocks = parseMarkdownBlocks(content);
  return (
    <div className="markdown-preview">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Tag = `h${Math.min(block.level, 3)}` as "h1" | "h2" | "h3";
          return <Tag key={index}>{block.text}</Tag>;
        }
        if (block.type === "code") {
          return <pre key={index}><code>{block.text}</code></pre>;
        }
        if (block.type === "list") {
          return <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>;
        }
        if (block.type === "table") {
          return <PreviewTable key={index} rows={block.rows} />;
        }
        return <p key={index}>{block.text}</p>;
      })}
    </div>
  );
}

type PreviewBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; rows: string[][] };

function parseMarkdownBlocks(input: string): PreviewBlock[] {
  const lines = input.split("\n");
  const blocks: PreviewBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        code.push(lines[i] ?? "");
        i += 1;
      }
      blocks.push({ type: "code", text: code.join("\n") });
      i += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }
    if (line.trim().startsWith("|") && line.includes("|")) {
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) {
        const raw = lines[i] ?? "";
        if (!/^\s*\|?\s*:?-{3,}/.test(raw)) {
          rows.push(raw.split("|").map((cell) => cell.trim()).filter(Boolean));
        }
        i += 1;
      }
      blocks.push({ type: "table", rows });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }
    const paragraph: string[] = [line.trim()];
    i += 1;
    while (i < lines.length && (lines[i] ?? "").trim() && !/^(#{1,6})\s+/.test(lines[i] ?? "")) {
      if ((lines[i] ?? "").trim().startsWith("```") || /^\s*[-*]\s+/.test(lines[i] ?? "")) {
        break;
      }
      paragraph.push((lines[i] ?? "").trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}

function PreviewTable({ rows }: { rows: string[][] }) {
  if (rows.length === 0) {
    return null;
  }
  const [head, ...body] = rows;
  return (
    <table>
      <thead>
        <tr>{head.map((cell, index) => <th key={index}>{cell}</th>)}</tr>
      </thead>
      <tbody>
        {body.map((row, rowIndex) => (
          <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}
