import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import * as api from "../lib/api";
import { useApp } from "../context/AppContext";
import type { Catalog, CatalogItem } from "../lib/types";

type Category = "prompts" | "stages" | "hosts" | "entries";

const CATEGORIES: Array<{ id: Category; label: string }> = [
  { id: "prompts", label: "Prompts" },
  { id: "stages", label: "Stages" },
  { id: "hosts", label: "Hosts" },
  { id: "entries", label: "Entries" },
];

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
  const { context, daemonStatus } = useApp();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [category, setCategory] = useState<Category>("entries");
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [content, setContent] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [editorHost, setEditorHost] = useState<HTMLDivElement | null>(null);
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
          markdown(),
          EditorView.lineWrapping,
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

  const loadFile = async (item: CatalogItem) => {
    if (!context?.apmHome) {
      return;
    }
    const full = await join(context.apmHome, item.path);
    const text = await readTextFile(full);
    setSelected(item);
    setContent(text);
    setValidationError(null);
    setStatus("");
    viewRef.current?.dispatch({
      changes: { from: 0, to: viewRef.current.state.doc.length, insert: text },
    });
  };

  const saveFile = async () => {
    if (!selected || !context?.apmHome) {
      return;
    }
    const err = validateFrontmatter(content);
    setValidationError(err);
    if (err) {
      return;
    }
    const full = await join(context.apmHome, selected.path);
    await writeTextFile(full, content);
    setStatus(`已保存 ${selected.path}（对进行中的 run 不生效，请新开 run）`);
  };

  const createNew = async () => {
    const name = window.prompt("新文件名称（不含扩展名）");
    if (!name?.trim() || !context?.apmHome) {
      return;
    }
    const rel = `${category}/${name.trim()}.md`;
    const full = await join(context.apmHome, rel);
    const template =
      category === "entries"
        ? `---\nentry: stage_a\nhost: local\ntask: 描述任务\n---\n# ${name}\n`
        : category === "hosts"
          ? `---\nhost: localhost\nworkspace: .\n---\n# ${name}\n`
          : category === "stages"
            ? `## 提示词\n- prompt_a\n\n## 后继阶段\n`
            : `---\nmodel: auto\n---\n# ${name}\n`;
    await writeTextFile(full, template);
    const cat = await api.fetchCatalog();
    setCatalog(cat);
    const item = cat[category].find((i) => i.name === name.trim());
    if (item) {
      await loadFile(item);
    }
  };

  return (
    <div>
      <h1 className="page-title">配置工作室</h1>
      <p style={{ color: "var(--text-muted)", marginTop: -12, marginBottom: 16 }}>
        编辑 ~/.apm 下的 Markdown 配置。保存后需重新启动 run 才会加载新配置。
      </p>

      <div className="studio-layout">
        <div className="studio-tree">
          <div style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
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
          {items.map((item) => (
            <button
              key={item.path}
              type="button"
              className={selected?.path === item.path ? "active" : ""}
              onClick={() => void loadFile(item)}
            >
              {item.name}
            </button>
          ))}
          <div style={{ padding: 8 }}>
            <button type="button" className="primary" onClick={() => void createNew()}>
              新建
            </button>
          </div>
        </div>

        <div>
          {selected ? (
            <>
              <div className="toolbar">
                <strong>{selected.path}</strong>
                <button type="button" className="primary" onClick={() => void saveFile()}>
                  保存
                </button>
              </div>
              {validationError && <p style={{ color: "var(--danger)" }}>{validationError}</p>}
              {status && <p style={{ color: "var(--success)" }}>{status}</p>}
              <div className="editor-wrap" ref={setEditorHost} />
            </>
          ) : (
            <div className="card">
              <p style={{ color: "var(--text-muted)" }}>从左侧选择或新建配置文件</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
