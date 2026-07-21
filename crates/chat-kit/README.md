# @nuwax-ai/chat-kit

Nuwa 产品共享的轻量聊天内核。目标消费者是 NuwaClaw 的 Agent Mode 与
Nuwax Web `/app/chat`。

## Public interfaces

- `@nuwax-ai/chat-kit/core`：领域模型、Adapter interface、流事件归并和 reducer。
- `@nuwax-ai/chat-kit/react`：`ChatComposer`、`ChatMessageList`、
  `ChatConversationList`、`useChatSession`。
- `@nuwax-ai/chat-kit/styles.css`：基于 CSS variables 的无框架默认样式。

宿主能力通过 Adapter 和 React slot 注入。该包不得依赖 Umi、Ant Design、
Electron、订阅、VNC 或具体认证实现。
