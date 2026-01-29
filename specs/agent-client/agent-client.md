# Instructions

## Project Alpha
### 想法
我需要开发跨平台的agent客户端,支持windows/mac/linux  平台. 我可以通过服务器的管理端程序,选择多个客户端中的1个,进行远程桌面操作,还可以在浏览器中的管理端页面, 发送prompt消息,会自动转发到对应的 agent客户端,在客户端执行任务,使用用户的个人电脑,来进行操作,期间客户端还会把agent端操作的消息,发送回服务器端,服务器端收到后,在用户的网页里发送sse消息,这样用户完全可以通过浏览器,来发送消息给agent,看到agent中间的执行任务消息,还可以在浏览器里远程桌面操作客户端的电脑。

而我这个工程，是客户端的工程的开发项目。项目结构是 workspace 结构，我设想是有3个crates 模块:
1) agent-client 跨平台的客户端,有UI界面,客户端升级,以及和 `agent-server-admin` 连接状态指示(比如界面的底部,显示和`agent-server-admin`连接是否通畅,绿色状态图标表示正常,红色状态图标表示异常)
2) agent-server-admin 服务器的管理端,用于和多个`agent-client`客户端进行通信,发送任务执行指令,可以双向通信,传输文件,图像等信息(借助于 nuwax-rustdesk 的通信功能来实现)
3) data-server  数据中转server,基于 rustdesk-server 来实现的,用于`agent-server-admin` 和`agent-client`建立通信,为P2P交换信息使用,或者无法P2P进行websocket/TCP协议的数据中转使用.

### 工程要求
我调研了下，发现rustdesk作为基础，来进行改造开发使用，很合适，有远程桌面，还有数据通道的传输，所以我想基于 rustdesk的的逻辑，来进行使用，如果可以，rustdesk作为lib库来使用。

#### 通信协议要求

* **使用 Protocol Buffers (protobuf) 作为消息序列化格式** (功能优先级高)
  - `agent-client` ↔ `agent-server-admin` 之间的所有消息使用 protobuf 进行序列化/反序列化
  - 参考 rustdesk 的 protobuf 定义方式（见 `vendors/nuwax-rustdesk` 项目中的 proto 文件）
  - 消息协议需要包含：
    - 协议版本号字段，用于版本兼容性检查
    - 消息类型标识（枚举）
    - 消息体（根据不同类型使用 oneof）
  - 大消息（如文件传输、截图）需要支持分片传输机制
  - 协议定义文件放在独立的 proto 目录，生成的 Rust 代码可被多个 crate 共享
  - 协议版本兼容策略：
    - 使用 protobuf 的向后兼容特性（字段编号不可变更）
    - 新增字段使用 optional，确保老版本客户端可以忽略
    - 协议重大变更时，需要版本号升级并进行兼容性检查

* 禁止 unsafe 代码,如果必须使用,请给出合理理由
* 优先开发实现客户端的UI,以及数据通信的接口设计,实现 `agent-server-admin`和`agent-client`可以双向通信,通过有公网ip的`data-server`服务,实现双方信息交换,从而实现P2P 直接通信能力,或者通过 `data-server`来中转双方数据。
* `agent-client` 和 `agent-server-admin` 可以双向通信，参考 rustdesk 是怎么实现的，本地参考源码：vendors/nuwax-rustdesk，看能否修改我们自己fork的项目`vendors/nuwax-rustdesk`,当做lib库的方式来进行使用，实现需要的功能。

* 跟随系统自动启动 (Auto Launch)
  - 推荐库：[`auto-launch`](https://crates.io/crates/auto-launch), github仓库地址： https://github.com/zzzgydi/auto-launch.git
  - **参考文档**: [@vendorsdoc/auto-launch.md](vendorsdoc/auto-launch.md)
  - 本地参考源码位置： vendors/auto-launch
  - 这是目前 Rust 社区最主流的跨平台自启库（Tauri 也在用它）。它会根据不同系统写入配置（Windows 注册表、macOS LaunchAgents、Linux .config/autostart）。

* 系统托盘菜单 (System Tray)
  - 推荐库：[`tray-icon`](https://crates.io/crates/tray-icon) + [`muda`](https://crates.io/crates/muda)
  - github仓库地址： https://github.com/tauri-apps/tray-icon.git
  - **参考文档**: [@vendorsdoc/tray-icon.md](vendorsdoc/tray-icon.md)
  - 本地参考源码位置： vendors/tray-icon
  - 这两个库是 Tauri 团队从 Tauri 核心剥离出来的通用库：
    - `tray-icon`: 负责在系统栏显示图标。
    - `muda`: 负责创建原生的跨平台菜单（右键菜单）。

* UI界面使用 `gpui-component` 来实现,**参考文档**: [@vendorsdoc/gpui-component.md](vendorsdoc/gpui-component.md)


### `agent-client`客户端功能要求

UI界面通过 `gpui-component` 来实现,本地参考源码： vendors/gpui-component。

可以通过 features 配置,来控制客户端UI功能,因为初期,可能有的功能来不及完善,先屏蔽掉,不给用户使用.比如左侧有几个选项卡,如果某个功能通过 features 来控制,左侧则没有对应的选项卡可以点击,这样用户就无法使用对应功能了,比如 "agent聊天对话界面"是可选功能,如果后续我发现实现有问题,或者不完善,可以构建的时候,屏蔽掉这个功能,实现类似的效果。

大体的几个UI界面交互功能如下：

* 有类似 ChatGPT 的和ai对话的聊天界面,中间可以看到agent执行任务的消息。 (功能优先级低)
* 设置界面,可以配置对应 `data-server` 的地址等信息,具体可以参考 `rustdesk` 私有部署的时候,指定私有部署的`rustdesk-server`的有哪些配置. 可以参考项目: "vendors/rustdesk-server","vendors/nuwax-rustdesk"这2个我fork官方的项目。 (功能优先级高)
* 显示当前客户端的"ID",密码的界面，类似rustdesk，远程连接是需要：唯一的ID数字，和密码的。 这样用户可以看到自己客户端的唯一ID和密码，然后去`agent-server-admin` 服务器的管理端来配置，这样管理端就可以远程控制客户端来使用了。另外允许用户可以自己修改密码，但唯一ID不允许修改，这个是和服务器通信后，自动生成的。 (功能优先级高)
* 客户端要有状态栏，比如在界面底部，有和`agent-server-admin`连接状态的图标，知道自己当前和服务器通信状态。 (功能优先级高)
* 有个“About”的界面，通过切换可以查看，看到当前的客户端版本等信息。 (功能优先级低)
* 客户端安装启动后，有任务栏常驻功能。 (功能优先级高)
* 客户端可以跟随系统自动启动 (Auto Launch)，可以通过配置设置此功能。 (功能优先级高)
* 可以构建多平台客户端，这里使用`cargo-packager`来进行打包。 (功能优先级高)
* 客户端升级。 (功能优先级低)
* 客户端有tab卡片切换的方式（或者类似的功能），可以打开对应界面，比如设置界面，agent联调界面，About关于界面，客户端的唯一ID和密码界面等。 (功能优先级高)
* **Agent 进程状态显示**，在状态栏显示当前有几个 agent 进程在运行（如 claude-code、opencode），以及各进程的执行状态。 (功能优先级中)
* 权限设置界面，因为需要远程桌面，需要系统有对应的权限授权，才能截图，访问对应磁盘目录等操作，需要有提示用户操作授权的界面，可以参考 rustdesk 如何实现的。 (功能优先级高)
* 客户端可以设置主题，语言，工作目录（比如服务器传输文件给客户端，默认传输到此目录上，或者这个目录也可以给agent使用的目录）等。 (功能优先级低)

#### 日志和调试功能

* **开发者模式日志控制** (功能优先级高)
  - 通过 cargo feature `dev-mode` 来控制日志输出
  - `dev-mode` 开启时：
    - 输出 debug 级别日志到控制台
    - 同时输出日志到文件（支持日志轮转）
    - 日志文件路径：用户目录下的日志文件夹（如 `~/.nuwax-agent/logs/`）
  - `dev-mode` 关闭时（生产环境）：
    - 只输出 info/warn/error 级别日志
  - 日志内容包括：网络连接状态、消息收发（敏感信息需脱敏）、agent 任务执行过程、性能指标、错误堆栈等
  - 在 UI 的设置界面中，提供"导出日志"功能，方便提交 bug 报告

* **构建配置示例**
  ```bash
  # 开发构建，带详细日志
  cargo build --features dev-mode

  # 生产构建，最小日志
  cargo build --release
  ```

#### Agent 自动安装功能

* **Agent 运行环境自动安装** (功能优先级高)
  - 客户端需要自动检测并安装 Agent 运行所需的依赖环境
  - **隔离安装原则**：所有安装的工具和依赖都安装到客户端应用数据目录，不污染用户的全局环境
    - 安装目录为各平台标准的应用数据目录（客户端内部管理，用户不可修改）：
      - macOS: `~/Library/Application Support/nuwax-agent/tools/`
      - Windows: `%LOCALAPPDATA%\nuwax-agent\tools\`（即 `C:\Users\<user>\AppData\Local\nuwax-agent\tools\`）
      - Linux: `~/.local/share/nuwax-agent/tools/`（遵循 XDG 规范）
    - 避免覆盖用户已有的全局安装（如用户自己安装的 node、npm、opencode 等）
  - 参考 Zed 编辑器安装 ACP 协议 Agent 的做法

* **Node.js 环境自动安装**
  - 检测顺序（优先使用已有环境，避免重复安装）：
    1. 先检查系统全局是否已有可用的 Node.js（用户自己安装的）
    2. 再检查客户端隔离目录内是否已安装
    3. 都没有时，才自动下载安装到隔离目录
  - 自动安装目录：`<APP_DATA_DIR>/tools/node/`
  - 推荐使用 Node.js 的预编译二进制包，避免编译安装
  - 支持的平台：
    - Windows: `node-vXX.XX.X-win-x64.zip`
    - macOS (Intel): `node-vXX.XX.X-darwin-x64.tar.gz`
    - macOS (Apple Silicon): `node-vXX.XX.X-darwin-arm64.tar.gz`
    - Linux: `node-vXX.XX.X-linux-x64.tar.xz`
  - 版本管理：记录安装的 Node.js 版本，支持后续升级

* **Agent 工具自动安装（通过 npm）**
  - 检测顺序（同 Node.js，优先使用全局已有的）：
    1. 先检查系统全局是否已有可用的 Agent 工具
    2. 再检查客户端隔离目录内是否已安装
    3. 都没有时，才通过 npm 安装到隔离目录
  - npm 安装目录（隔离）：`<APP_DATA_DIR>/tools/npm-global/`
  - 支持安装的 Agent 工具：
    - `opencode`：通过 `npm install -g opencode` 安装到隔离目录
    - `@anthropic-ai/claude-code`：Claude Code CLI
    - 其他支持 ACP 协议的 Agent 工具
  - 安装流程：
    1. 检查 Agent 是否已安装且版本符合要求
    2. 如未安装或版本过旧，自动执行安装/升级
    3. 安装完成后验证 Agent 可用性（如执行 `opencode --version`）

* **环境变量和 PATH 管理**
  - 如果使用系统全局的依赖，直接使用系统 PATH，无需额外设置
  - 如果使用隔离目录内的依赖，客户端运行时动态设置 PATH：
    - PATH 顺序：`<APP_DATA_DIR>/tools/node/bin` > `<APP_DATA_DIR>/tools/npm-global/bin` > 系统 PATH
  - 不修改用户的 shell 配置文件（如 `.bashrc`、`.zshrc`）
  - 仅在客户端进程及其子进程中生效

* **安装状态和 UI 反馈**
  - 在设置界面或专门的"Agent 管理"界面显示：
    - 已安装的 Agent 列表及版本
    - Node.js 版本
    - 安装状态（已安装/未安装/安装中/安装失败）
  - 支持手动触发安装/更新/卸载操作
  - 安装过程中显示进度条和日志
  - 安装失败时提供错误信息和重试选项

* **依赖管理界面** (功能优先级高)
  - 提供专门的"依赖管理"或"环境检查"界面，作为 Tab 页或设置子页面
  - **依赖状态列表展示**：
    | 依赖项 | 状态 | 版本 | 来源 | 操作 |
    |--------|------|------|------|------|
    | Node.js | 已安装 | v20.10.0 | 系统全局 | - |
    | npm | 已安装 | 10.2.0 | 系统全局 | - |
    | opencode | 安装失败 | - | - | 重试 / 手动安装 |
    | claude-code | 已安装 | 1.0.0 | 客户端目录 | 更新 / 卸载 |
  - **状态类型**：
    - 已安装（绿色）：正常可用
    - 安装中（蓝色/动画）：正在下载或安装
    - 安装失败（红色）：安装过程出错
    - 未安装（灰色）：尚未安装
    - 需要更新（黄色）：有新版本可用
  - **操作按钮**：
    - "安装"：对未安装的依赖进行安装
    - "重试"：对安装失败的依赖重新尝试安装
    - "更新"：更新到最新版本
    - "卸载"：移除已安装的依赖
    - "全部检查"：一键检查所有依赖状态
    - "全部安装"：一键安装所有缺失的依赖
  - **安装失败处理**：
    - 显示详细的错误信息（网络错误、磁盘空间不足、权限问题等）
    - 提供"查看日志"按钮，展示完整的安装日志
    - 提供"重试安装"按钮
    - 提供"手动安装指引"链接或弹窗，告诉用户如何手动安装：
      - 显示需要下载的文件 URL
      - 显示安装目录路径
      - 提供手动安装的命令示例
  - **手动安装支持**：
    - 用户可以自行在系统全局安装依赖（如通过 brew、apt、官网下载等方式）
    - 客户端检测依赖时，优先检查系统全局环境是否可用
    - 提供"刷新状态"按钮，重新检测系统环境
    - 检测到全局已安装后，更新状态显示为"已安装（系统全局）"

* **安装目录结构示例**
  - `<APP_DATA_DIR>` 为各平台应用数据目录（见上文）
  ```
  <APP_DATA_DIR>/                  # 客户端应用数据目录
  ├── tools/
  │   ├── node/                    # Node.js 安装目录
  │   │   ├── bin/
  │   │   │   ├── node
  │   │   │   └── npm
  │   │   └── lib/
  │   ├── npm-global/              # npm 全局安装目录（隔离）
  │   │   ├── bin/
  │   │   │   ├── opencode
  │   │   │   └── claude
  │   │   └── lib/
  │   └── versions.json            # 已安装工具的版本记录
  ├── config/                      # 配置文件
  ├── logs/                        # 日志文件
  └── cache/                       # 缓存文件（下载的安装包等）
  ```
  - 各平台实际路径：
    - macOS: `~/Library/Application Support/nuwax-agent/`
    - Windows: `%LOCALAPPDATA%\nuwax-agent\`
    - Linux: `~/.local/share/nuwax-agent/`






#### 可以参考的项目源码

**核心通信库**:
* [@vendorsdoc/nuwax-rustdesk.md](vendorsdoc/nuwax-rustdesk.md) - 远程桌面客户端核心库，提供双向通信、文件传输、远程控制能力
* [@vendorsdoc/rustdesk-server.md](vendorsdoc/rustdesk-server.md) - 服务器端（data-server），提供信令和中继服务

**AI Agent 运行时**:
* [@vendorsdoc/rcoder.md](vendorsdoc/rcoder.md) - AI 代理开发平台，提供 agent_runner 模块用于管理 agent 生命周期

**MCP 服务**:
* [@vendorsdoc/mcp-proxy.md](vendorsdoc/mcp-proxy.md) - MCP 代理服务，支持管理端的 MCP 工具调用

**基础组件库**:
* [@vendorsdoc/enigo.md](vendorsdoc/enigo.md) - 跨平台键盘鼠标输入模拟
* [@vendorsdoc/auto-launch.md](vendorsdoc/auto-launch.md) - 开机自启动
* [@vendorsdoc/tray-icon.md](vendorsdoc/tray-icon.md) - 系统托盘图标
* [@vendorsdoc/cargo-packager.md](vendorsdoc/cargo-packager.md) - 跨平台打包工具
* [@vendorsdoc/gpui-component.md](vendorsdoc/gpui-component.md) - GPUI UI 组件库


#### 项目审查
* 借鉴TDD的思路，应该有很好的测试用例，来进行测试验证功能点
* 代码设计应该易于测试



