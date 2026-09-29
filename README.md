# SillyTavern QQ 式回复通知

给 SillyTavern 手机网页端使用的系统通知扩展。

## 功能

- 角色回复完成后发送 Android/浏览器系统通知
- 自动读取当前角色头像
- 显示角色名
- 显示回复前一小段内容
- 默认使用常驻通知（点击前不会主动关闭）
- 可选震动
- 可选仅在 SillyTavern 不处于前台时通知
- 通知点击后返回 SillyTavern
- 相同聊天使用同一个通知 tag，连续回复会更新通知而不是无限堆积
- 设置面板提供通知权限按钮和测试通知按钮

## 安装

SillyTavern → Extensions → Install Extension → 粘贴本仓库地址：

https://github.com/1614130601zjs-del/st-qq-notification

安装后刷新/重新打开扩展面板，在“QQ式回复通知”中配置。

## Android 注意事项

浏览器必须允许本网站发送通知。Android 也可能根据浏览器和系统的通知策略调整震动、声音以及后台保活行为。

“常驻”使用 Web Notification API 的 `requireInteraction`。部分 Android 浏览器可能仍会根据系统通知策略自动折叠或管理通知，这是浏览器/系统层限制，不是扩展可以强制覆盖的。

通知声音通常由 Android 的通知渠道控制，网页扩展不能可靠地单独指定系统通知声音。

## 兼容

扩展使用 SillyTavern 的 `SillyTavern.getContext()` 和 `MESSAGE_RECEIVED` 事件。SillyTavern 官方文档支持从 Git 仓库安装第三方扩展；官方仓库中的扩展也使用 `manifest.json + index.js + style.css` 结构。

