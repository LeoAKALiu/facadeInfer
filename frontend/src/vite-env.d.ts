/// <reference types="vite/client" />

/** 梁板柱结构构件编辑器隐藏入口的 URL 查询参数值，默认 "editor"，访问 ?page=<该值> 进入编辑器 */
interface ImportMetaEnv {
  readonly VITE_STRUCTURAL_EDITOR_PAGE?: string;
}