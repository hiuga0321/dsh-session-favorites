/**
 * 包身份的唯一来源。
 *
 * 这个字符串同时出现在四个必须一致的地方：
 *   1. package.json 的 "name"（npm 安装身份）
 *   2. cordis.patch.yml 的 name（宿主装配）
 *   3. 宿主 index.js 的 typert contribution（package face 校验键）
 *   4. 客户端 client.js 的 $mount contribution（与宿主一一对应）
 *
 * typert 注册时以 `<package>#<face>` 作为全局唯一键（registry validatePackage），
 * 任何一处写错都会在运行时抛 "package face ... is already registered"
 * 或端点解析失败。此前四处各写一份字面量，改包名时极易漏改。
 *
 * 客户端 bundle 不能 ES import（它以 window.__ModuleLoader__.load 注册），
 * 因此那边仍保留字面量，但由 scripts/smoke.mjs 的断言强制与这里对齐。
 */

/** 发布包名。改这里即可，宿主侧全部派生自它。 */
export const PACKAGE_NAME = 'dsh-session-favorites'
