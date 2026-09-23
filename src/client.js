/**
 * 会话收藏夹客户端 bundle。以 window.__ModuleLoader__.load 注册，不 ES import。
 * 样式对齐 DSH 原生：
 *   - footer 入口照 packages/extensions/ui-cordis/src/client/CordisPanel.module.css
 *   - 搜索框照 packages/client/ui-workspace/src/client/WorkspaceBrowser.module.css
 *   - 面板/分组/行照 CordisPanel 的 panel/header/title/group 度量
 * 通过注入一份 <style> 落地（本 bundle 无构建步骤，不能使用 CSS Modules）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-favorites',
  factory: (require) => {
    const React = require('react')
    // react-dom 与 react 同样是 loader 预置模块（见 packages/client/web/src/seed.ts）。
    // 仅在能拿到 createPortal 时才启用 portal，否则就地渲染。
    const { createPortal } = (() => {
      try {
        return require('react-dom')
      } catch {
        return {}
      }
    })()
    const { useState, useRef, useEffect, useLayoutEffect, useMemo } = React

    const PKG = 'dsh-session-favorites'

    // ---------- 原生风格样式表 ----------
    const CSS = `
.dsf_layer { position: relative; flex: none; display: flex; align-items: center; width: 100%; height: 42px; margin: 8px 0 0; }
.dsf_layerRail { width: 36px; height: 36px; margin: 0; }
.dsf_trigger { display: inline-flex; align-items: center; gap: 8px; width: calc(100% + 4px); height: 42px; margin: 0 -2px; padding: 0 10px 0 8px; border: none; border-radius: 12px; background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 14px; cursor: pointer; overflow: hidden; }
.dsf_trigger:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsf_trigger[data-open] { background: var(--dsw-alias-interactive-bg-hover); }
.dsf_layerRail .dsf_trigger { justify-content: center; gap: 0; width: 36px; height: 36px; padding: 0; border-radius: 50%; corner-shape: round; }
.dsf_triggerLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsf_triggerCount { flex: none; margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 16px; font-variant-numeric: tabular-nums; }
.dsf_icon { flex: none; display: inline-flex; align-items: center; justify-content: center; }
.dsf_panel { position: fixed; z-index: 30; display: flex; flex-direction: column; width: 320px; max-width: calc(100vw - 24px); max-height: 60vh; overflow: hidden; border: 0; border-radius: 12px; background: var(--dsw-specific-menu); --dsw-elevation-stroke-color: var(--dsw-alias-border-l1); box-shadow: var(--dsw-elevation-prominent); --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2); }
.dsf_header { flex: none; display: flex; align-items: center; justify-content: space-between; min-height: 44px; padding: 10px 12px; box-sizing: border-box; }
.dsf_title { font-size: 14px; font-weight: 500; line-height: 20px; color: var(--dsw-alias-label-primary); }
.dsf_headerButton { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: 999px; corner-shape: round; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.dsf_headerButton:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.dsf_search { box-sizing: border-box; display: flex; align-items: center; gap: 0; height: 32px; margin: 0 12px 8px; padding: 0 4px 0 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }
.dsf_searchInput { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 13px; line-height: 18px; }
.dsf_searchInput::placeholder { color: var(--dsw-alias-label-tertiary); }
.dsf_clearButton { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 24px; height: 24px; padding: 0; border: none; border-radius: 50%; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dsf_clearButton:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsf_body { flex: 1; min-height: 0; overflow-y: auto; padding: 0 12px 12px; }
.dsf_group { margin: 8px 0; font-size: 11px; font-weight: 500; line-height: 16px; color: var(--dsw-alias-label-caption); text-transform: uppercase; letter-spacing: 0.04em; }
.dsf_row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 8px; border: none; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 13px; line-height: 20px; text-align: left; cursor: pointer; }
.dsf_row:hover { background: var(--dsw-alias-interactive-bg-hover); }
/* 选中态 = 当前正在查看的会话。原生 .sessionRow.selected 用的是 hover 一档，这里取
   更重的 active 一档，否则与 :hover 无法区分；带 hover 回退以兼容旧主题。 */
.dsf_rowSelected, .dsf_rowSelected:hover { background: var(--dsw-alias-interactive-bg-active, var(--dsw-alias-interactive-bg-hover)); }
.dsf_rowSelected .dsf_rowTitle { font-weight: 600; }
.dsf_rowStar { flex: none; display: inline-flex; color: var(--dsw-alias-state-business-primary); }
.dsf_rowTitle { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 行尾操作：对齐原生 .rowActions（Rows.module.css）—— 悬停才出现、裸图标、gap 12、tertiary 灰。
   display:none → inline-flex 而非改 opacity，这样图标不占位、不参与点击命中。 */
.dsf_rowActions { flex: none; display: none; align-items: center; gap: 12px; }
.dsf_row:hover .dsf_rowActions, .dsf_row:focus-within .dsf_rowActions { display: inline-flex; }
/* 失效行的会话已不存在，重命名无从谈起；删除也走"清理"横幅。 */
.dsf_rowGone .dsf_rowActions { display: none; }
.dsf_rowAction { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 20px; height: 20px; padding: 0; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.dsf_rowAction:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsf_rowActionDanger:hover { color: var(--dsw-alias-state-error-primary); }
.dsf_rowGone { opacity: 0.55; cursor: default; }
.dsf_rowGone:hover { background: transparent; }
/* 模态：逐项对齐 ui-primitives/Modal.module.css 与 WorkspaceBrowser 的删除弹窗。
   .dsf_modalLayer = .root（flex 居中 + padding 24），.dsf_modalMask = .mask（bg-mask-1 + blur），
   .dsf_modal = .dialog（r24 / bg-layer-2 / elevation-prominent / pb 24 / width min(380px,100%)）。 */
.dsf_modalLayer { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; }
.dsf_modalMask { position: absolute; inset: 0; background: var(--dsw-alias-bg-mask-1); backdrop-filter: var(--dsw-mask-blur); }
.dsf_modal { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 20px; width: min(380px, 100%); padding: 0 0 24px; overflow: hidden; border: 0; border-radius: 24px; background: var(--dsw-alias-bg-layer-2); box-shadow: var(--dsw-elevation-prominent); }
.dsf_modalContent { display: flex; flex-direction: column; width: 100%; }
.dsf_modalHeader { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 22px 14px 12px 24px; }
.dsf_modalTitle { margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dsf_modalClose { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dsf_modalClose:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsf_modalDesc { margin: 0; padding: 0 24px; font-size: 14px; line-height: 22px; font-weight: 400; color: var(--dsw-alias-label-primary); }
.dsf_modalBody { display: flex; flex-direction: column; min-width: 0; margin-top: 20px; padding: 0 24px; }
/* 对齐原生 .renameInput：h44 / r22 / 0.5px border-l4。 */
.dsf_modalInput { box-sizing: border-box; width: 100%; height: 44px; padding: 7px 14px; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: 22px; outline: none; background: transparent; font-family: inherit; font-size: 14px; font-weight: 400; line-height: 22px; color: var(--dsw-alias-label-primary); }
.dsf_modalInput:disabled { color: var(--dsw-alias-label-dimmed); }
.dsf_modalError { margin-top: 8px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
.dsf_modalStatus { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsf_modalFooter { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 0 24px; }
/* 对齐原生 Button（Button.module.css）：胶囊 r18 / h36 / pad 0 14 / 14px，
   outline 用 0.5px border-l3，primary 用 button-primary-fill。 */
.dsf_modalButton { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 36px; padding: 0 14px; border: none; border-radius: 18px; background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 14px; line-height: 22px; cursor: pointer; }
.dsf_modalButton:disabled { cursor: not-allowed; opacity: 0.4; }
.dsf_modalButtonOutline { border: 0.5px solid var(--dsw-alias-border-l3); }
.dsf_modalButtonOutline:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsf_modalButtonPrimary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
.dsf_modalButtonPrimary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
/* 破坏性操作：与原生 .deleteAction 一致，仅改文字色。 */
.dsf_modalButtonDanger:not(:disabled) { color: var(--dsw-alias-state-error-primary); }
.dsf_badge { flex: none; padding: 0 6px; border-radius: 8px; background: var(--dsw-alias-state-warn-tertiary); color: var(--dsw-alias-state-warn-label); font-size: 11px; line-height: 16px; }
.dsf_badgeMuted { flex: none; padding: 0 6px; border-radius: 8px; background: var(--dsw-alias-button-ghost-active-fill); color: var(--dsw-alias-label-caption); font-size: 11px; line-height: 16px; }
.dsf_banner { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 12px 8px; padding: 6px 8px; border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover); }
.dsf_bannerText { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsf_bannerError { background: var(--dsw-alias-interactive-bg-hover-danger); }
.dsf_bannerError .dsf_bannerText { color: var(--dsw-alias-state-error-primary); }
.dsf_cleanup { flex: none; height: 24px; padding: 0 8px; border: none; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 12px; line-height: 24px; cursor: pointer; }
.dsf_cleanup:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsf_empty { padding: 16px 0; text-align: center; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dsf_error { color: var(--dsw-alias-state-error-primary); }
`
    // 样式表只注入一次；返回清理函数供插件卸载时移除，避免热重载后残留。
    const CSS_MARKER = 'session-favorites/styles.css'
    function installStyles() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector(`style[data-plugin-css="${CSS_MARKER}"]`)
      if (existing !== null) {
        // 已被本次会话中的其他 fiber 注入：不重复插入，也不负责移除
        // （移除权归创建者，否则先卸载的实例会把仍在使用的样式删掉）。
        return () => {}
      }
      const tag = document.createElement('style')
      tag.dataset.plugin = PKG
      tag.dataset.pluginCss = CSS_MARKER
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }

    // ---------- 图标（16px 描边风格，对齐 DSH 图标库） ----------
    function icon(children, { size = 16, filled = false } = {}) {
      return React.createElement('svg', {
        viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, focusable: 'false',
        fill: filled ? 'currentColor' : 'none', stroke: 'currentColor',
        strokeWidth: filled ? 0 : 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
      }, children)
    }
    const STAR_PATH = 'M8 2.4l1.72 3.62 3.88.5-2.86 2.71.73 3.92L8 11.25l-3.47 1.9.73-3.92-2.86-2.71 3.88-.5z'
    const starIcon = (filled, size) => icon(React.createElement('path', { d: STAR_PATH }), { size, filled })
    const closeIcon = (size = 16) => icon(React.createElement('path', { d: 'M4 4l8 8M12 4l-8 8' }), { size })
    const trashIcon = (size = 16) => icon([
      React.createElement('path', { key: 'a', d: 'M3 4.5h10' }),
      React.createElement('path', { key: 'b', d: 'M6.5 4.5V3h3v1.5' }),
      React.createElement('path', { key: 'c', d: 'M4.6 4.5l.6 8h5.6l.6-8' }),
    ], { size })
    // 与 DSH ui-primitives 的 IconEditOutline16 同一条 path（实心填充，非描边）。
    const EDIT_PATH = 'M9.94076 1.34942C10.7047 0.90231 11.6503 0.902415 12.4143 1.34942C12.7061 1.52015 12.9688 1.79118 13.3104 2.13284C13.6521 2.47448 13.9231 2.73721 14.0939 3.02894C14.5408 3.79294 14.5409 4.73856 14.0939 5.50251C13.9231 5.79415 13.652 6.05704 13.3104 6.39861L6.65932 13.0497C6.28068 13.4284 6.00695 13.7108 5.66543 13.9097C5.32391 14.1085 4.94315 14.2074 4.42705 14.3498L3.24394 14.6761C2.77527 14.8054 2.34538 14.9262 2.00131 14.9684C1.65196 15.0112 1.17964 15.0013 0.810764 14.6325C0.441921 14.2637 0.432107 13.7913 0.47486 13.442C0.517035 13.0979 0.6379 12.668 0.767181 12.1993L1.09352 11.0162C1.23588 10.5001 1.33481 10.1193 1.5336 9.77784C1.7325 9.43632 2.0149 9.1626 2.39355 8.78395L9.04466 2.13284C9.38625 1.79126 9.64911 1.52016 9.94076 1.34942ZM15.5427 14.8398H7.55223L8.96707 13.425H15.5427V14.8398ZM3.39382 9.78422C2.965 10.213 2.84244 10.3436 2.75709 10.49C2.67183 10.6366 2.61862 10.8079 2.45733 11.3925L2.13099 12.5756C2.00183 13.0439 1.92194 13.3419 1.88863 13.5536C2.10041 13.5204 2.39872 13.4416 2.86764 13.3123L4.05075 12.9859C4.63544 12.8246 4.80669 12.7715 4.95323 12.6862C5.09968 12.6008 5.23022 12.4783 5.65905 12.0494L10.721 6.98644L8.45577 4.72121L3.39382 9.78422ZM11.7 2.57079C11.3774 2.38198 10.9777 2.38198 10.6551 2.57079C10.5602 2.62647 10.4487 2.72931 10.0449 3.13311L9.45604 3.72094L11.7213 5.98617L12.3102 5.39833C12.7139 4.99457 12.8168 4.88307 12.8725 4.78818C13.0613 4.46561 13.0612 4.06585 12.8725 3.74326C12.8169 3.64827 12.7146 3.53752 12.3102 3.13311C11.9057 2.72863 11.795 2.6264 11.7 2.57079Z'
    const editIcon = (size = 16) => icon(React.createElement('path', { d: EDIT_PATH }), { size, filled: true })

    // ---------- 远程 codec + 客户端描述符（与宿主 invocations 一一对应） ----------
    function strictCodec(typeSymbol, schema) {
      return { mode: 'strict', typeSymbol, create: () => schema, schema }
    }
    const sessionIdCodec = strictCodec('@deepseek-ai/dsh-session/types#SessionId', {
      parse(v) { if (typeof v !== 'string' || !v) throw new TypeError('sessionId'); return v },
    })
    // 与宿主一致：非空校验必须在 codec 上，否则坏记录会落盘、
    // 并在下次打开域时让 schema 校验失败（存储只在 load 路径校验 schema）。
    const titleCodec = strictCodec('String', {
      parse(v) {
        if (typeof v !== 'string') throw new TypeError('title')
        if (v.trim().length === 0) throw new TypeError('title must be a non-empty string')
        return v
      },
    })
    // 字段整体缺失时网关不会调用 parse；这里只保证「传了就得是对的」，
    // 因此显式 null 必须抛错而不是被静默当作缺省。
    const workspaceIdCodec = strictCodec('String?', {
      parse(v) {
        if (v === undefined) return undefined
        if (typeof v !== 'string') throw new TypeError('workspaceId')
        return v
      },
    })
    const listCodec = strictCodec(`${PKG}/types#FavoriteRowList`, {
      parse(v) { if (!Array.isArray(v)) throw new TypeError('rows'); return v },
    })

    const FAVORITES_REMOTE = {
      package: PKG,
      descriptors: [
        { id: `${PKG}#favorites/list`, service: 'favorites', namespace: 'favorites', method: 'list',
          invocation: { kind: 'direct' }, parameters: [], result: listCodec,
          sourceLocation: { file: `${PKG}/src/index.js`, line: 1, column: 1 } },
        { id: `${PKG}#favorites/add`, service: 'favorites', namespace: 'favorites', method: 'add',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'sessionId', wire: 'sessionId', source: 'json', codec: sessionIdCodec },
            { name: 'title', wire: 'title', source: 'json', codec: titleCodec },
            { name: 'workspaceId', wire: 'workspaceId', source: 'json', codec: workspaceIdCodec, acceptsUndefined: true },
          ],
          result: listCodec,
          sourceLocation: { file: `${PKG}/src/index.js`, line: 1, column: 1 } },
        { id: `${PKG}#favorites/unfavorite`, service: 'favorites', namespace: 'favorites', method: 'unfavorite',
          invocation: { kind: 'direct' },
          parameters: [ { name: 'sessionId', wire: 'sessionId', source: 'json', codec: sessionIdCodec } ],
          result: listCodec,
          sourceLocation: { file: `${PKG}/src/index.js`, line: 1, column: 1 } },
        { id: `${PKG}#favorites/rename`, service: 'favorites', namespace: 'favorites', method: 'rename',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'sessionId', wire: 'sessionId', source: 'json', codec: sessionIdCodec },
            { name: 'title', wire: 'title', source: 'json', codec: titleCodec },
          ],
          result: listCodec,
          sourceLocation: { file: `${PKG}/src/index.js`, line: 1, column: 1 } },
      ],
    }

    // ---------- 本地可观察镜像 ----------
    function createStore(remote) {
      let snapshot = { rows: [], byId: new Map(), ready: false, error: null }
      const listeners = new Set()
      const publish = () => { for (const l of listeners) l() }
      const apply = (rows) => {
        snapshot = { rows, byId: new Map(rows.map(r => [r.sessionId, r])), ready: true, error: null }
        publish()
      }
      const fail = (error) => {
        snapshot = { ...snapshot, ready: true, error: error?.message ?? String(error) }
        publish()
      }
      const unwrap = async (promise) => {
        const result = await promise
        if (result && typeof result === 'object' && 'ok' in result) {
          if (!result.ok) throw result.error
          return result.value
        }
        return result
      }
      return {
        getSnapshot: () => snapshot,
        subscribe: (l) => { listeners.add(l); return () => listeners.delete(l) },
        async refresh() { try { apply(await unwrap(remote.list())) } catch (e) { fail(e) } },
        async add(sessionId, title, workspaceId) { apply(await unwrap(remote.add(sessionId, title, workspaceId))) },
        async remove(sessionId) { apply(await unwrap(remote.unfavorite(sessionId))) },
        /**
         * 重命名：先改 DSH 会话名，成功后再同步本地标题副本。
         *
         * 顺序不能反 —— 会话名才是事实来源，本地副本只是兜底/搜索用；
         * 反过来会在 DSH 改名失败时留下一个对不上的副本。
         *
         * 第二步失败**不能**让整个操作报失败：DSH 侧已经改完了，抛错会让用户
         * 以为没改成（实际改了），而对话框还会停在打开状态显示一个误导性的错误。
         * 副本只是「兜底/搜索」用途，失同步只降级为本地告警 —— 会话名的事实
         * 来源始终是 DSH，UI 显示的也是 DSH 的名字（sessionsById 优先）。
         */
        async rename(sessionId, title, renameSession) {
          await renameSession(sessionId, title)
          try {
            apply(await unwrap(remote.rename(sessionId, title)))
          } catch (error) {
            console.warn(
              `[session-favorites] title copy for "${sessionId}" not synced (session itself was renamed):`,
              error,
            )
          }
        },
        /**
         * 逐个取消收藏；每次调用都返回权威全量列表。
         * 关键：**每次成功都立即落地**，而不是只取最后一次——旧实现把结果攒到
         * 循环外统一 apply，任一 reject 都会让整批已完成的删除在本地镜像里丢失，
         * 表现为「点了清理但列表没变」。
         */
        async removeMany(sessionIds) {
          if (sessionIds.length === 0) return
          for (const sessionId of sessionIds) {
            try {
              apply(await unwrap(remote.unfavorite(sessionId)))
            } catch (error) {
              // 先把失败前的删除结果落地，再报告失败，避免状态回退。
              fail(error)
              throw error
            }
          }
        },
      }
    }

    // ---------- 按工作区分组 ----------
    /** 拼接类名，忽略假值（避免为了几个类名引入 clsx 依赖）。 */
    function clsx(...values) {
      return values.filter(Boolean).join(' ')
    }

    function groupRows(rows, workspaces) {
      const live = new Set(workspaces.map(w => w.workspaceId))
      const buckets = new Map()
      for (const row of rows) {
        const key = row.workspaceId !== undefined && live.has(row.workspaceId) ? row.workspaceId : '__ungrouped__'
        if (!buckets.has(key)) buckets.set(key, [])
        buckets.get(key).push(row)
      }
      const groups = []
      for (const ws of workspaces) {
        const members = buckets.get(ws.workspaceId)
        if (members && members.length > 0) groups.push({ workspaceId: ws.workspaceId, title: ws.title, rows: members })
      }
      const ungrouped = buckets.get('__ungrouped__')
      if (ungrouped && ungrouped.length > 0) groups.push({ workspaceId: undefined, title: '未分组', rows: ungrouped })
      return groups
    }

    // ---------- 行状态 ----------
    // 收藏行有四种状态：正常、选中（当前正在查看）、已归档（仍可打开）、已失效（会话已删除，点不动）。
    // 判据抽成纯函数，便于自检覆盖。
    const GONE_HINT = '该会话已不存在，可点右侧删除清理'
    const ARCHIVED_HINT = '该会话已归档，点击仍可打开'

    function rowState(row, { listReady, sessionsById, archivedIds, currentId }) {
      // 会话列表未就绪时不做"已失效"判定，避免启动瞬间把全部收藏标灰。
      const gone = listReady && sessionsById[row.sessionId] === undefined
      // 已失效优先于已归档：会话都没了，归档与否不再有意义。
      const archived = !gone && archivedIds.includes(row.sessionId)
      // 选中态只认"当前正在查看的会话"，与原生侧边栏判定一致。
      const selected = row.sessionId === currentId
      return {
        gone,
        archived,
        selected,
        hint: gone ? GONE_HINT : archived ? ARCHIVED_HINT : undefined,
      }
    }

    // ---------- 对话框外壳 ----------
    // 逐项对齐 ui-primitives/Modal.tsx：portal 到 body、Escape 关闭、
    // 独立遮罩层（点遮罩关闭）、header（标题 + 关闭按钮）、可选 description、
    // body 与 footer。遮罩单独成层而不是给整层加背景，这样 blur 只作用在遮罩上。
    function Dialog({ title, description, children, footer, onClose, busy }) {
      const close = () => { if (!busy) onClose() }
      // Escape 关闭：原生在 document 上监听（见 Modal.tsx 的 useEffect）。
      useEffect(() => {
        if (typeof document === 'undefined') return
        const onKeyDown = (e) => { if (e.key === 'Escape') close() }
        document.addEventListener('keydown', onKeyDown)
        return () => { document.removeEventListener('keydown', onKeyDown) }
      })

      const tree = React.createElement('div', { className: 'dsf_modalLayer', role: 'presentation' },
        React.createElement('div', { className: 'dsf_modalMask', 'aria-hidden': true, onClick: close }),
        React.createElement('div', {
          className: 'dsf_modal', role: 'dialog', 'aria-modal': true, 'aria-label': title,
        },
          React.createElement('div', { className: 'dsf_modalContent' },
            React.createElement('div', { className: 'dsf_modalHeader' },
              React.createElement('h2', { className: 'dsf_modalTitle' }, title),
              React.createElement('button', {
                type: 'button', className: 'dsf_modalClose', 'aria-label': '关闭', onClick: close,
              }, closeIcon(14)),
            ),
            description !== undefined && description !== ''
              ? React.createElement('p', { className: 'dsf_modalDesc' }, description)
              : null,
            children !== undefined && children !== null
              ? React.createElement('div', { className: 'dsf_modalBody' }, children)
              : null,
          ),
          React.createElement('div', { className: 'dsf_modalFooter' }, footer),
        ),
      )
      // portal 到 body：原生 Modal 就是这么做的，避免被侧边栏的 overflow/层叠上下文裁掉。
      // 拿不到 createPortal / document 时退化为就地渲染（视觉一致，只是仍受父级层叠上下文约束）。
      return typeof createPortal === 'function' && typeof document !== 'undefined'
        ? createPortal(tree, document.body)
        : tree
    }

    /**
     * 统一的提交状态机：busy / error / 成功回调。
     *
     * 两个必须由 ref 承担的职责（state 做不到）：
     *   1. 重入锁：setBusy(true) 要到下次渲染才生效，而「重命名」按钮与
     *      Enter 走同一个 confirm，同一帧内连点会读到旧的 busy=false 而提交两次。
     *      用 ref 做同步闸门。
     *   2. 卸载保护：用户在请求飞行中按 Escape 关掉对话框后，promise 落地时
     *      不能再 setState / 调 onDone，否则会二次关闭并作用到已失效的组件。
     * @param onSuccess - 提交成功后的回调（通常是关闭对话框）。
     * @returns busy/error 状态与 run 执行器。
     */
    function useSubmit(onSuccess) {
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const inFlight = useRef(false)
      const alive = useRef(true)
      useEffect(() => {
        // 必须在 setup 里重新置 true：StrictMode 的开发期重放会先跑一次
        // cleanup（挂载→卸载→再挂载），只清不设会让 alive 永久为 false，
        // 之后所有提交都不再 setBusy(false)/onSuccess/显示错误 ——
        // 表现为「点了按钮一直转圈、对话框永不关闭」。
        // 与 DSH 自身 ui-directory-picker-native/flow.ts 的写法一致。
        alive.current = true
        return () => { alive.current = false }
      }, [])
      const run = (task) => {
        // 同步闸门：同一帧内的第二次调用直接丢弃。
        if (inFlight.current) return Promise.resolve()
        inFlight.current = true
        setBusy(true)
        setError(null)
        return Promise.resolve()
          .then(task)
          .then(() => {
            inFlight.current = false
            if (!alive.current) return
            setBusy(false)
            onSuccess()
          })
          .catch((reason) => {
            inFlight.current = false
            if (!alive.current) return
            setBusy(false)
            setError(reason instanceof Error ? reason.message : String(reason))
          })
      }
      return { busy, error, setError, run }
    }

    // ---------- 重命名对话框 ----------
    // 对齐原生「重命名会话」：打开即聚焦并全选、空标题禁用提交、Enter 提交、
    // 输入法组合期间 Enter 不提交、失败以 role="alert" 显示而不关闭、成功才关闭。
    function RenameDialog({ target, onClose, onConfirm }) {
      const [draft, setDraft] = useState(target.currentTitle)
      const composingRef = useRef(false)
      const trimmed = draft.trim()
      // 成功即关闭：这里传 onClose（成功与取消都走同一条关闭路径）。
      const submit = useSubmit(onClose)
      const blocked = submit.busy || trimmed === ''

      const confirm = () => {
        if (blocked) return
        submit.run(() => onConfirm(target.sessionId, trimmed))
      }

      return React.createElement(Dialog, {
        title: '重命名会话',
        busy: submit.busy,
        onClose,
        footer: React.createElement(React.Fragment, null,
          React.createElement('button', {
            type: 'button', className: 'dsf_modalButton dsf_modalButtonOutline',
            disabled: submit.busy, onClick: onClose,
          }, '取消'),
          React.createElement('button', {
            type: 'button', className: 'dsf_modalButton dsf_modalButtonPrimary',
            disabled: blocked, onClick: confirm,
          }, '重命名'),
        ),
      },
        React.createElement('input', {
          className: 'dsf_modalInput',
          value: draft,
          'aria-label': '会话名称',
          autoFocus: true,
          disabled: submit.busy,
          onFocus: (e) => e.target.select(),
          onChange: (e) => { setDraft(e.target.value); submit.setError(null) },
          onCompositionStart: () => { composingRef.current = true },
          onCompositionEnd: () => { composingRef.current = false },
          onKeyDown: (e) => {
            if (e.key === 'Enter' && !composingRef.current) { e.preventDefault(); confirm() }
          },
        }),
        submit.error !== null
          ? React.createElement('div', { className: 'dsf_modalError', role: 'alert' }, submit.error)
          : null,
      )
    }

    // ---------- 移除收藏确认对话框 ----------
    // 取消收藏虽有「已失效」兜底，但误删会丢掉收藏与排序位置，故与原生删除一样二次确认。
    // 结构/文案风格对齐原生删除弹窗：outline 取消 + 破坏性按钮（仅文字变红）。
    // 单条与批量共用：批量时 title 换成条数描述。
    function DeleteConfirmDialog({ title, description, confirmLabel, onClose, onConfirm }) {
      const submit = useSubmit(onClose)
      const confirm = () => { if (!submit.busy) submit.run(() => onConfirm()) }

      return React.createElement(Dialog, {
        title,
        description,
        busy: submit.busy,
        onClose,
        footer: React.createElement(React.Fragment, null,
          React.createElement('button', {
            type: 'button', className: 'dsf_modalButton dsf_modalButtonOutline',
            disabled: submit.busy, onClick: onClose,
          }, '取消'),
          React.createElement('button', {
            type: 'button', className: 'dsf_modalButton dsf_modalButtonOutline dsf_modalButtonDanger',
            disabled: submit.busy, onClick: confirm,
          }, confirmLabel),
        ),
      },
        submit.busy
          ? React.createElement('div', { className: 'dsf_modalStatus', role: 'status' }, '正在移除…')
          : null,
        submit.error !== null
          ? React.createElement('div', { className: 'dsf_modalError', role: 'alert' }, submit.error)
          : null,
      )
    }

    // ---------- footer 入口 + 弹出层 ----------
    function FavoritesButton(props) {
      const { wide, useFavorites, useSessions, useWorkspaces, onOpen, onRemove, onRemoveMany, onRename } = props
      const favorites = useFavorites(s => s)
      const sessionsById = useSessions(s => s.byId)
      // 「已失效」判定需要两侧都就绪：会话列表就绪只说明我们知道有哪些会话，
      // 若收藏自身刷新失败（favorites.error 非空），rows 会是空/陈旧快照，
      // 此时做失效判定会得出错误结论——所以把 favorites 就绪一并纳入。
      const sessionsReady = useSessions(s => s.phase === 'ready')
      const listReady = sessionsReady && favorites.ready && favorites.error === null
      // 当前正在查看的会话：与原生侧边栏同源（list.current），用于行选中态。
      const currentId = useSessions(s => s.current)
      const workspaces = useWorkspaces(s => s.items)
      const archivedIds = useWorkspaces(s => s.archivedSessionIds)
      const [open, setOpen] = useState(false)
      const [query, setQuery] = useState('')
      const [notice, setNotice] = useState(null)
      // 正在重命名的目标行（null = 对话框关闭）。
      const [renameTarget, setRenameTarget] = useState(null)
      // 正在等待移除确认的目标行。
      const [deleteTarget, setDeleteTarget] = useState(null)
      // 批量清理失效收藏的确认开关 + 打开那一刻的名单快照。
      const [cleanupOpen, setCleanupOpen] = useState(false)
      const [cleanupIds, setCleanupIds] = useState([])
      const rootRef = useRef(null)
      const [anchor, setAnchor] = useState(null)

      useLayoutEffect(() => {
        if (!open) return
        const place = () => {
          const rect = rootRef.current?.getBoundingClientRect()
          if (rect) setAnchor({ left: rect.left, bottom: window.innerHeight - rect.top + 8 })
        }
        place()
        window.addEventListener('resize', place)
        return () => window.removeEventListener('resize', place)
      }, [open])

      const title = (row) => sessionsById[row.sessionId]?.displayTitle ?? row.title
      const goneIds = favorites.rows
        .filter(row => rowState(row, { listReady, sessionsById, archivedIds }).gone)
        .map(row => row.sessionId)
      const q = query.trim().toLowerCase()
      const groups = useMemo(() => groupRows(favorites.rows, workspaces), [favorites.rows, workspaces])
      const filtered = q === ''
        ? null
        : favorites.rows.filter(r => title(r).toLowerCase().includes(q))

      const rowEl = (row) => {
        const state = rowState(row, { listReady, sessionsById, archivedIds, currentId })
        const { gone, archived, selected, hint } = state
        return React.createElement('button', {
          key: row.sessionId,
          className: clsx('dsf_row', selected && 'dsf_rowSelected', gone && 'dsf_rowGone'),
          type: 'button',
          title: hint,
          'aria-selected': selected,
          // 失效行不触发 open（sessions.open 对未知 id 会 fail loud）；
          // 成功打开也不关闭弹出层——只有关闭按钮能关。
          onClick: () => {
            if (gone) return
            // onOpen 返回 null 表示成功，否则是要展示给用户的原因。
            setNotice(onOpen(row.sessionId) ?? null)
          },
        },
          React.createElement('span', { className: 'dsf_rowStar' }, starIcon(true, 14)),
          React.createElement('span', { className: 'dsf_rowTitle' }, title(row)),
          gone ? React.createElement('span', { className: 'dsf_badge' }, '已失效') : null,
          archived ? React.createElement('span', { className: 'dsf_badgeMuted' }, '已归档') : null,
          // 行尾操作：悬停出现（与原生 .rowActions 一致）。失效行的会话已不存在，
          // 两个操作都无意义，整组隐藏——清理走顶部横幅。
          React.createElement('span', { className: 'dsf_rowActions' },
            React.createElement('span', {
              className: 'dsf_rowAction', role: 'button', 'aria-label': '重命名会话', title: '重命名会话',
              onClick: (e) => {
                e.stopPropagation()
                setRenameTarget({ sessionId: row.sessionId, currentTitle: title(row) })
              },
            }, editIcon(14)),
            React.createElement('span', {
              className: 'dsf_rowAction dsf_rowActionDanger', role: 'button',
              'aria-label': '移除收藏', title: '移除收藏',
              // 二次确认：误删会丢掉收藏与排序位置，不能一次点击就生效。
              onClick: (e) => {
                e.stopPropagation()
                setDeleteTarget({ sessionId: row.sessionId, title: title(row) })
              },
            }, trashIcon(14)),
          ),
        )
      }

      const errorEl = favorites.error
        ? React.createElement('div', { className: 'dsf_empty dsf_error' }, `加载失败：${favorites.error}`)
        : null
      // 打开失败（归档、会话被删等）不静默：在弹出层顶部给出原因。
      const noticeEl = notice
        ? React.createElement('div', { className: 'dsf_banner dsf_bannerError' },
          React.createElement('span', { className: 'dsf_bannerText' }, notice),
          React.createElement('button', {
            type: 'button', className: 'dsf_cleanup', 'aria-label': '关闭提示', title: '关闭提示',
            onClick: () => setNotice(null),
          }, '知道了'),
        )
        : null
      // 失效收藏一键清理：逐个取消收藏，避免悬空条目长期占位。
      const goneEl = goneIds.length > 0
        ? React.createElement('div', { className: 'dsf_banner' },
          React.createElement('span', { className: 'dsf_bannerText' }, `${goneIds.length} 个收藏的会话已不存在`),
          React.createElement('button', {
            type: 'button', className: 'dsf_cleanup', title: '清理已失效的收藏',
            // 批量移除同样是破坏性的，先确认再执行；
            // 名单在这里定格，之后后台刷新不再影响这次确认的范围。
            onClick: () => { setCleanupIds(goneIds); setCleanupOpen(true) },
          }, '清理'),
        )
        : null
      const bodyEl = favorites.rows.length === 0
        ? React.createElement('div', { className: 'dsf_empty' }, '暂无收藏会话')
        : filtered !== null
          ? (filtered.length === 0
            ? React.createElement('div', { className: 'dsf_empty' }, '无匹配会话')
            : filtered.map(rowEl))
          : groups.map(g => React.createElement('div', { key: g.workspaceId ?? '__ungrouped__' },
            React.createElement('div', { className: 'dsf_group' }, g.title),
            g.rows.map(rowEl)))

      return React.createElement('div', { ref: rootRef, className: wide ? 'dsf_layer' : 'dsf_layer dsf_layerRail' },
        React.createElement('button', {
          type: 'button', className: 'dsf_trigger',
          'aria-label': '收藏夹', 'aria-expanded': open, 'data-open': open || undefined,
          onClick: () => { setOpen(v => !v); setNotice(null) },
        },
          React.createElement('span', { className: 'dsf_icon' }, starIcon(favorites.rows.length > 0, wide ? 16 : 18)),
          wide ? React.createElement('span', { className: 'dsf_triggerLabel' }, '收藏夹') : null,
          wide && favorites.rows.length > 0
            ? React.createElement('span', { className: 'dsf_triggerCount' }, String(favorites.rows.length))
            : null,
        ),
        open && anchor
          ? React.createElement('section', {
            className: 'dsf_panel',
            style: { left: anchor.left, bottom: anchor.bottom },
            'aria-label': '收藏夹',
          },
            React.createElement('header', { className: 'dsf_header' },
              React.createElement('span', { className: 'dsf_title' }, '收藏夹'),
              React.createElement('button', {
                type: 'button', className: 'dsf_headerButton', 'aria-label': '关闭', title: '关闭',
                onClick: () => { setOpen(false); setNotice(null) },
              }, closeIcon(16)),
            ),
            React.createElement('div', { className: 'dsf_search' },
              React.createElement('input', {
                className: 'dsf_searchInput', type: 'text', placeholder: '搜索会话名称',
                value: query,
                onChange: (e) => setQuery(e.target.value),
                onKeyDown: (e) => { if (e.key === 'Escape') setQuery('') },
              }),
              React.createElement('button', {
                type: 'button', className: 'dsf_clearButton', 'aria-label': '清空搜索', title: '清空搜索',
                onClick: () => setQuery(''),
              }, closeIcon(14)),
            ),
            noticeEl,
            goneEl,
            React.createElement('div', { className: 'dsf_body' }, errorEl, bodyEl),
          )
          : null,
        // 对话框放在弹出层之外：它是 portal 到 body 的独立模态，不受面板裁剪影响。
        renameTarget !== null
          ? React.createElement(RenameDialog, {
            key: `rename:${renameTarget.sessionId}`,
            target: renameTarget,
            onClose: () => setRenameTarget(null),
            onConfirm: (sessionId, title) => onRename(sessionId, title),
          })
          : null,
        deleteTarget !== null
          ? React.createElement(DeleteConfirmDialog, {
            key: `delete:${deleteTarget.sessionId}`,
            title: '移除收藏',
            description: `将把“${deleteTarget.title}”从收藏夹中移除。会话本身与聊天记录都会保留，之后可以重新收藏。`,
            confirmLabel: '移除收藏',
            onClose: () => setDeleteTarget(null),
            onConfirm: () => onRemove(deleteTarget.sessionId).then(() => setNotice(null)),
          })
          : null,
        cleanupOpen
          ? React.createElement(DeleteConfirmDialog, {
            key: 'cleanup',
            title: '清理已失效的收藏',
            // description 与确认动作都绑定到**打开对话框那一刻**的名单，
            // 而不是渲染时重算的 goneIds：对话框开着时若某条被后台刷新判定为
            // 已恢复（或用户手动删掉了），实时 goneIds 会和用户看到的条数不一致，
            // 出现「说好清理 3 个，实际动了 2 个」。
            description: `将把 ${cleanupIds.length} 个已不存在的会话移出收藏夹。这只会影响收藏记录，不会删除任何会话或聊天数据。`,
            confirmLabel: '全部清理',
            onClose: () => { setCleanupOpen(false); setCleanupIds([]) },
            onConfirm: () => onRemoveMany(cleanupIds)
              .then(() => setNotice(null))
              // 批量清理失败不能只进控制台：把原因抬到提示条，否则用户看到
              // 「点了清理但列表还剩几条」却没有任何解释。
              .catch((error) => {
                console.error('[session-favorites] cleanup failed:', error)
                setNotice(`清理未全部完成：${error?.message ?? String(error)}`)
              }),
          })
          : null,
      )
    }

    // ---------- 会话头部星标 ----------
    function HeaderFavoriteToggle(props) {
      const { sessionId, useFavorites, useSessions, useWorkspaces, onAdd, onRemove } = props
      const fav = useFavorites(s => s.byId.has(sessionId))
      const summary = useSessions(s => s.byId[sessionId])
      const workspaces = useWorkspaces(s => s.items)
      if (summary?.blank === true) return null
      const title = summary?.displayTitle ?? sessionId
      // 归属工作区用于分组；不属于任何工作区时为 undefined（描述符已声明可缺省）。
      const workspaceId = workspaces.find(w => w.sessionIds?.includes(sessionId))?.workspaceId
      return React.createElement('button', {
        type: 'button', className: 'dsf_headerButton',
        style: fav ? { color: 'var(--dsw-alias-state-business-primary)' } : undefined,
        'aria-label': fav ? '取消收藏' : '收藏',
        'aria-pressed': fav,
        title: fav ? '取消收藏' : '收藏',
        onClick: () => {
          // 头部星标没有提示条可用，失败只能上报；但必须带上是「收藏」还是
          // 「取消收藏」，否则无法从日志判断哪一步失败。
          Promise.resolve(fav ? onRemove(sessionId) : onAdd(sessionId, title, workspaceId))
            .catch(error => console.error(
              `[session-favorites] ${fav ? 'unfavorite' : 'favorite'} "${sessionId}" failed:`,
              error,
            ))
        },
      }, starIcon(fav, 16))
    }

    // ---------- @ 触发源 ----------
    // 候选完全来自本地收藏镜像：输入 @ 即列出全部收藏，继续输入按标题过滤。
    // 不再把查询词交给 sessionReferenceResolver —— 那会把分组名当成会话标题
    // 去匹配，导致结果为空；mention 也按官方编码本地构造。
    const SECTION_TITLE = 'favorites'
    const CANDIDATE_LIMIT = 50
    // 分组顺序按 order 升序（越低越靠前）。已发布的 @ 来源：reference=0、cordis=1，
    // 故用 -1 让 favorites 稳定置顶。
    const SOURCE_ORDER = -1

    function base64UrlJson(value) {
      const bytes = new TextEncoder().encode(JSON.stringify(value))
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
    }

    /** 与 @deepseek-ai/dsh-session-reference/uri 的 formatSessionReferenceMention 等价。 */
    function sessionMention(sessionId, label) {
      const text = String(label ?? sessionId).replace(/[\\\]]/gu, match => `\\${match}`)
      return `@[${text}](dsh-session:${base64UrlJson(sessionId)})`
    }

    function favoritesSource(ctx, store) {
      return {
        trigger: '@',
        name: 'favorites',
        order: SOURCE_ORDER,
        async candidates(session, { query }) {
          const needle = query.trim().toLowerCase()
          const rows = store.getSnapshot().rows
          const matched = needle === ''
            ? rows
            : rows.filter(row => row.title.toLowerCase().includes(needle))
          return matched.slice(0, CANDIDATE_LIMIT).map(row => {
            const label = row.title
            return {
              name: label,
              label,
              section: SECTION_TITLE,
              icon: 'session',
              value: JSON.stringify({ kind: 'session', label, mention: sessionMention(row.sessionId, label) }),
            }
          })
        },
        onPick({ candidate }) {
          const v = JSON.parse(candidate.value ?? '{}')
          if (v.kind !== 'session') return undefined
          return {
            insert: { source: 'reference', ref: v.mention, label: v.label, appearance: 'session', clipboardText: v.mention },
          }
        },
        lexicon() { return store.getSnapshot().rows.map(r => r.title) },
        subscribeLexicon(_s, l) { return store.subscribe(l) },
        codec: { clipboardText: r => r, serialize: r => Promise.resolve(r) },
      }
    }

    // ---------- 归档会话导航适配 ----------
    // DSH 的 UiWorkspaceService.watchNavigation() 会在每次会话/工作区列表变化时
    // 调用 clearArchivedCurrent()：只要"当前会话"落在 archivedSessionIds 里，就立刻
    // sessions.clear()。因此对归档会话调用 sessions.open() 会被马上撤销，表现为
    // "点了打不开"。官方恢复入口（workspaces.unarchiveSession）在 0.1.6+ 才有。
    // 这里只对"本次显式点击的那个 id"让 clearArchivedCurrent 返回 false，
    // 其余归档清理行为原样保留 —— 本插件自带这套适配，**不依赖任何其它插件**
    // （例如 @michengai/dsh-archive-manager 装不装都一样）。
    const ARCHIVED_OPEN_FAILED = '该会话已归档，当前 DSH 版本无法直接打开'

    const archivedSessionIds = workspaces => workspaces.list.getSnapshot().archivedSessionIds

    /**
     * 安装归档导航适配。返回的 open() 在补丁尚未就绪时也能正确工作：
     * 它自己会再确认一次，实在不行就抛出可见原因。
     *
     * 关键点：**uiWorkspace 服务由 ui-workspace 插件在自己的 apply 里创建**，
     * 而它与本插件的 apply 之间没有 inject 依赖，因此先后顺序无保证。
     * 只探测一次会在竞态里静默降级（表现为"归档会话打不开"），
     * 所以这里等到服务真正出现为止。
     */
    function allowArchivedNavigation(ctx, sessions, workspaces) {
      let navigation
      let restore = null
      let allowed
      let disposed = false

      const archived = id => archivedSessionIds(workspaces).includes(id)
      const viewing = id => {
        const list = sessions.list.getSnapshot()
        // 新版 DSH 用按视图的 retain 计数表达"谁是当前会话"；旧版只有 current。
        const retained = list.byId[id]?.retainedBy?.mainView
        if (typeof retained === 'number') return retained > 0
        return list.current === id
      }

      /** 打补丁；拿不到服务时返回 false（等待后续重试）。 */
      const install = () => {
        if (disposed || navigation !== undefined) return navigation !== undefined
        const candidate = ctx.get('uiWorkspace')
        const original = candidate?.clearArchivedCurrent
        if (candidate === undefined || typeof original !== 'function') return false

        // 必须是普通函数：Cordis 读取服务方法时会绑定代理，
        // 用自有描述符核对补丁是否真的落在实例上。
        const wrapped = function (...args) {
          if (allowed !== undefined && viewing(allowed) && archived(allowed)) return false
          allowed = undefined
          return original.apply(this, args)
        }
        // 给补丁打标记，便于判断"当前生效的还是不是我这份补丁"。
        // 不能用函数名判断：打包/压缩会改掉 name。
        wrapped.__sessionFavoritesPatch = true
        try {
          candidate.clearArchivedCurrent = wrapped
        } catch {
          return false
        }
        if (Object.getOwnPropertyDescriptor(candidate, 'clearArchivedCurrent')?.value !== wrapped) {
          return false
        }
        navigation = candidate
        restore = () => {
          if (Object.getOwnPropertyDescriptor(candidate, 'clearArchivedCurrent')?.value !== wrapped) return
          // 原方法在原型上，删掉自有属性即可还原。
          delete candidate.clearArchivedCurrent
        }
        return true
      }
      install()

      /**
       * 没有补丁时的唯一正确姿势：**不要假装成功**。
       *
       * 归档会话在原生语义下会被 watchNavigation 的 clearArchivedCurrent() 清掉，
       * 而那次清理发生在我们返回之后的某一个微任务里 —— 此刻立刻读 current 一定是
       * "还在"，据此返回成功就是撒谎，用户随后会看到会话自己跳走（这正是原先
       * 「归档会话打不开」的现象）。所以归档会话直接给出可见原因，不碰 sessions.open；
       * 普通会话照常打开。
       */
      const openUnpatched = (sessionId) => {
        if (archived(sessionId)) throw new Error(ARCHIVED_OPEN_FAILED)
        sessions.open(sessionId)
      }

      return {
        get installed() { return navigation !== undefined },
        /** 幂等安装；服务尚未出现时调用是安全的空操作。 */
        install,
        open(sessionId) {
          if (!install()) {
            openUnpatched(sessionId)
            return
          }
          // 补丁可能在安装后被宿主替换/重建服务而失效。
          const current = Object.getOwnPropertyDescriptor(navigation, 'clearArchivedCurrent')?.value
          if (current?.__sessionFavoritesPatch !== true) {
            // 已不是我们的补丁（被还原成原型方法，或被别的插件覆盖）：重装一次。
            restore?.()
            navigation = undefined
            restore = null
            if (!install()) {
              openUnpatched(sessionId)
              return
            }
          }
          allowed = sessionId
          try {
            sessions.open(sessionId)
            // open 之后宿主若没把该会话保留为当前会话，说明补丁没起作用。
            if (!viewing(sessionId)) throw new Error(ARCHIVED_OPEN_FAILED)
          } catch (error) {
            allowed = undefined
            throw error
          }
        },
        dispose() {
          disposed = true
          allowed = undefined
          restore?.()
          navigation = undefined
          restore = null
        },
      }
    }

    // ---------- 插件入口 ----------
    // 自家 favorites 命名空间是运行时 $mount 的，不进 inject（见 apply 内的 ctx.get）。
    // workspaces 用于判断收藏是否归档，以及归档导航适配。
    const inject = ['slots', 'sessions', 'layout', 'inputTriggers', 'remote', 'workspaces']

    function apply(ctx) {
      // 样式随插件生命周期注册，卸载时移除（避免热重载后残留）。
      ctx.effect(() => installStyles(), 'session-favorites: stylesheet')

      const mounted = ctx.remote.$mount(FAVORITES_REMOTE)
      // 运行时挂载的命名空间注册为 Cordis 服务键 `remote.favorites`。该键在 apply 期间才诞生，
      // 无法写进 inject（声明了会自锁等待），因此用非 inject 门控的 ctx.get 查找。
      const namespace = () => {
        const service = ctx.get('remote.favorites')
        if (service === undefined) {
          throw new Error('session-favorites: remote namespace "favorites" is not mounted yet')
        }
        return service
      }
      const remote = {
        list: () => namespace().list(),
        add: (sessionId, title, workspaceId) => namespace().add(sessionId, title, workspaceId),
        unfavorite: (sessionId) => namespace().unfavorite(sessionId),
        rename: (sessionId, title) => namespace().rename(sessionId, title),
      }
      const store = createStore(remote)
      Promise.resolve(mounted).then(
        () => store.refresh(),
        (error) => { console.error('[session-favorites] remote mount failed:', error) },
      )

      // 归档导航适配：允许"本次显式点击的归档收藏"成为当前会话。
      // uiWorkspace 由 ui-workspace 插件在自己的 apply 里创建，与本插件无 inject 依赖，
      // 先后顺序无保证；因此除了在 open() 时按需安装，这里再等一次服务出现，
      // 避免竞态下静默降级。
      const navigation = allowArchivedNavigation(ctx, ctx.sessions, ctx.workspaces)
      ctx.effect(() => () => navigation.dispose(), 'session-favorites: archived navigation patch')
      // inject 回调只在服务**首次**可用时触发一次，正好用来兜住启动竞态。
      // 拿不到 ctx.inject（老版本/精简上下文）也没关系：open() 里仍会按需安装。
      ctx.inject?.(['uiWorkspace'], () => { navigation.install() })

      // 重命名会话：走 DSH 官方的 per-session rename（与原生侧边栏完全同一条路径），
      // 成功后同步收藏里的标题副本。无效/未知会话按原生语义抛错，由对话框展示。
      const renameSession = async (sessionId, title) => {
        const session = ctx.sessions.binding(sessionId)?.session
        if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
        const result = await session.rename(title)
        if (!result.ok) throw new Error(result.error.message)
      }

      // sessions.open 对不在列表中的 id 会 fail loud；失效收藏（会话已被删除）
      // 在这里静默跳过，而不是让点击抛错。
      // 返回 null 表示成功，否则返回给用户看的原因（由弹出层渲染成提示条）。
      const openSession = (sessionId) => {
        if (ctx.sessions.list.getSnapshot().byId[sessionId] === undefined) {
          console.warn(`[session-favorites] session "${sessionId}" no longer exists; skipping open`)
          return GONE_HINT
        }
        try {
          navigation.open(sessionId)
        } catch (error) {
          console.error('[session-favorites] open failed:', error)
          const reason = error?.message ?? String(error)
          // 归档提示已经是面向用户的成品文案，不要再套一层前缀。
          return reason === ARCHIVED_OPEN_FAILED ? reason : `无法打开该会话：${reason}`
        }
        ctx.layout.selectPanel(null)
        return null
      }

      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'favorites',
        inject: () => ({
          hooks: { favorites: store },
          onOpen: openSession,
          onRemove: store.remove,
          onRemoveMany: store.removeMany,
          onRename: (sessionId, title) => store.rename(sessionId, title, renameSession),
        }),
      }, FavoritesButton))

      ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
        name: 'conversation.session.header.actions',
        id: 'favorites',
        inject: () => ({ hooks: { favorites: store }, onAdd: store.add, onRemove: store.remove }),
      }, HeaderFavoriteToggle))

      ctx.effect(() => ctx.inputTriggers.registerSource(favoritesSource(ctx, store)), 'session-favorites: @ source')
    }

    // 纯逻辑子集，仅供 scripts/smoke.mjs 与单测直接调用；运行时不消费。
    const testing = { groupRows, rowState, sessionMention, base64UrlJson, GONE_HINT, ARCHIVED_HINT }

    return { inject, apply, testing }
  },
})
