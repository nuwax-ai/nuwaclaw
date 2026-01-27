#Instructions

##Porject Alpha
### 想法
我需要开发跨平台的agent客户端,支持windows/mac/linux  平台. 我可以通过服务器的管理端程序,选择多个客户端中的1个,进行远程桌面操作,还可以在浏览器中的管理端页面, 发送prompt消息,会自动转发到对应的 agent客户端,在客户端执行任务,使用用户的个人电脑,来进行操作,期间客户端还会把agent端操作的消息,发送回服务器端,服务器端收到后,在用户的网页里发送sse消息,这样用户完全可以通过浏览器,来发送消息给agent,看到agent中间的执行任务消息,还可以在浏览器里远程桌面操作客户端的电脑。

而我这个工程，是客户端的工程的开发项目。项目结构是 workspace接口，我设想是有3个crates 模块:
1) agent-client 跨平台的客户端,有UI界面,客户端升级,以及和 `agent-server-admin`链接状态指示(比如界面的底部,显示和`agent-server-admin`连接是否通畅,绿色状态图标表示正常,红色状态图标表示异常)
2) agent-server-admin 服务器的管理端,用和多个`agent-client`客户端,进行通信,发送任务执行指令,可以双向通信,传输文件,图像等信息(借助于 nuwax-rustdesk 的通信功能,来实现)
3) data-server  数据中转server,基于 rustdesk-server 来实现的,用于`agent-server-admin` 和`agent-client`建立通信,为P2P交换信息使用,或者无法P2P进行websocket/TCP协议的数据中转使用.

### 工程要求
我调研了下，发现rustdesk作为基础，来进行改造开发使用，很合适，有远程桌面，还有数据通道的传输，所以我想基于 rustdesk的的逻辑，来进行使用，如果可以，rustdesk作为lib库来使用。


* 禁止 unsafe 代码,如果必须使用,请给出合理理由
* 优先开发实现客户端的UI,以及数据通信的接口设计,实现 `agent-server-admin`和`agent-client`可以双向通信,通过有公网ip的`data-server`服务,实现双发信息交换,从而实现P2P 直接通信能力,或者通过 `data-server`来中转双方数据。
* `agent-client` 和 `agent-server-admin` 可以双向通信， 参考 rustdesk 是怎么实现的，本地参考源码：vendors/nuwax-rustdesk ，看能否修改我们自己fork的项目`vendors/nuwax-rustdesk`,当做lib库的方式，来进行使用，实现需要的功能。
*  跟随系统自动启动 (Auto Launch)
推荐库：[`auto-launch`](https://crates.io/crates/auto-launch), github仓库地址： https://github.com/zzzgydi/auto-launch.git 。
参考源码位置： vendors/auto-launch

这是目前 Rust 社区最主流的跨平台自启库（Tauri 也在用它）。它会根据不同系统写入配置（Windows 注册表、macOS LaunchAgents、Linux .config/autostart）。

* 系统托盘菜单 (System Tray)
  推荐库：[`tray-icon`](https://crates.io/crates/tray-icon) + [`muda`](https://crates.io/crates/muda)

  github仓库地址： https://github.com/tauri-apps/tray-icon.git  。
  本地参考源码位置： vendors/tray-icon

  这两个库是 Tauri 团队从 Tauri 核心剥离出来的通用库：
   * `tray-icon`: 负责在系统栏显示图标。
   * `muda`: 负责创建原生的跨平台菜单（右键菜单）。
* UI界面使用 `gpui-component` 来实现,本地参考源码： vendors/gpui-component。
*


### `agent-client`客户端功能要求

UI界面通过 `gpui-component` 来实现,本地参考源码： vendors/gpui-component。

可以通过 features 配置,来控制客户端UI功能,因为初期,可能有的功能来不及完善,先屏蔽掉,不给用户使用.比如左侧有几个选项卡,如果某个功能通过 features 来控制,左侧则没有对应的选项卡可以点击,这样用户就无法使用对应功能了,比如 "agent聊天对话界面"是可选功能,如果后续我发现实现有问题,或者不完善,可以构建的时候,屏蔽掉这个功能,实现类似的效果。

大体的几个UI界面交互功能如下: 

* 有类似 ChatGTP 的和ai对话的聊天界面,中间可以看到agent执行任务的消息。 (功能优先级低)
* 设置界面,可以配置对应 `data-server` 的地址等信息,具体可以参考 `rustdesk` 私有部署的时候,指定私有部署的`rustdesk-server`的有哪些配置. 可以参考项目: "vendors/rustdesk-server","vendors/nuwax-rustdesk"这2个我fork官方的项目。 (功能优先级高)
* 显示当前客户端的“ID”,密码的界面，类似rustdesk ，远程连接是需要：唯一的ID数字，和密码的。 这样用户可以看到自己客户端的唯一ID和密码，然后去` agent-server-admin` 服务器的管理端来配置，这样管理端就可以远程控制客户端来使用了。另外允许用户可以自己修改密码， 但唯一ID不允许修改，这个是和服务器通信后，自动生成的。 (功能优先级高)
* 客户端要有状态栏，比如在界面底部，有和`agent-server-admin`连接状态的图标，知道自己当前和服务器通信状态。 (功能优先级高)
* 有个“About”的界面，通过切换可以查看，看到当前的客户端版本等信息。 (功能优先级低)
* 客户端安装启动后，有任务栏常驻功能。 (功能优先级高)
* 客户端可以跟随系统自动启动 (Auto Launch)，可以通过配置设置此功能。 (功能优先级高)
* 可以构建多平台客户端，这里使用`cargo-packager`来进行打包。 (功能优先级高)
* 客户端升级。 (功能优先级低)
* 客户端有tab卡片切换的方式（或者类似的功能），可以打开对应界面，比如设置界面，agent联调界面， About关于界面，客户端的唯一ID和密码界面等。 (功能优先级高)
* 权限设置界面，因为需要远程桌面，需要系统有对应的权限授权，才能截图，访问对应磁盘目录等操作，需要有提示用户操作授权的界面，可以参考 rustdesk 如何实现的。 (功能优先级高)
* 客户端可以设置主题，语言，工作目录（比如服务器传输文件给客户端，默认传输到此目录上，或者这个目录也可以给agent使用的目录）等。 (功能优先级低)













#### 可以参考的项目源码
*  vendors/nuwax-rustdesk 这个是我fork出来 rustdesk 项目
*  vendors/rustdesk-server 也是我fork官方的配套项目，作为 rustdesk的server端来使用
*  vendors/rcoder 是我的agent项目，这个项目里的rcoder模块，接受http请求，然后通过agent client protocol 协议来调用agent，agent可以是支持ACP协议就行，比如 opencode（opencode acp 开启acp协议），kimi等agent都可以，我不关注具体的agent，只要agent支持ACP协议，我作为acp协议客户端来使用就行。
agent逻辑,我想的是尽量复用 rcoder项目中的"crates/agent_runner"模块,来作为我们的agent操作代理使用,通过"crates/agent_runner"模块来操作agent(这个模块内部有agent闲置一定时间后,自动销毁等逻辑)
* vendors/mcp-proxy 这个是我开发的mcp 透明代理的项目，本地可能需要mcp服务，来使用我们管理端的mcp服务。
* vendors/enigo 是统一架构的输入项目，我看 rustdesk也使用的 enigo 这个库。
* vendors/cargo-packager 是跨平台打包项目，从tauri中拆分出来的，我们可以用打包我们的跨平台项目。
* vendors/gpui-component 是rust生态的UI组件库,我们可以用这个库,来进行客户端UI的开发。






