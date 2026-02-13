import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { StructuralEditor } from "./pages/StructuralEditor";
import "./styles.css";

/**
 * 梁板柱结构构件编辑器的隐藏入口：通过 URL 查询参数 page 指定。
 * 默认：?page=editor
 * 可通过环境变量 VITE_STRUCTURAL_EDITOR_PAGE 修改（构建时生效），例如设为 structural-editor 则入口为 ?page=structural-editor
 */
const editorPageParam =
  (import.meta.env.VITE_STRUCTURAL_EDITOR_PAGE as string | undefined) || "editor";
const isEditorPage =
  new URLSearchParams(window.location.search).get("page") === editorPageParam;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isEditorPage ? <StructuralEditor /> : <App />}
  </React.StrictMode>
);

