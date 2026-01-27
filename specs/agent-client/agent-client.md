#Instructions

##Porject Alpha
### 想法
我需要开发跨平台的agent客户端,支持windows/mac/linux  平台. 我可以通过服务器的管理端程序,选择多个客户端中的1个,进行远程桌面操作,还可以在浏览器中的管理端页面, 发送prompt消息,会自动转发到对应的 agent客户端,在客户端执行任务,使用用户的个人电脑,来进行操作,期间客户端还会把agent端操作的消息,发送回服务器端,服务器端收到后,在用户的网页里发送sse消息,这样用户完全可以通过浏览器,来发送消息给agent,看到agent中间的执行任务消息,还可以在浏览器里远程桌面操作客户端的电脑。

而我这个工程，是客户端的工程的开发项目。项目结构是 workspace接口，但是暂时只有一个crates，使用 monorepo 的方式（这样方便我发布构建版本），来使用workspace项目结构。

### 工程要求
我调研了下，发现rustdesk作为基础，来进行改造开发使用，很合适，有远程桌面，还有数据通道的传输，所以我想基于 rustdesk的的逻辑，来进行使用，如果可以，rustdesk作为lib库来使用。


#### 可以参考的项目源码
*  vendors/nuwax-rustdesk 这个是我fork出来 rustdesk 项目
*  vendors/rustdesk-server 也是我fork官方的配套项目，作为 rustdesk的server端来使用
*  vendors/rcoder 是我的agent项目，这个项目里的rcoder模块，接受http请求，然后通过agent client protocol 协议来调用agent，agent可以是支持ACP协议就行，比如 opencode（opencode acp 开启acp协议），kimi等agent都可以，我不关注具体的agent，只要agent支持ACP协议，我作为acp协议客户端来使用就行。
* vendors/mcp-proxy 这个是我开发的mcp 透明代理的项目，本地可能需要mcp服务，来使用我们管理端的mcp服务。
* vendors/enigo 是统一架构的输入项目，我看 rustdesk也使用的 enigo 这个库。
* vendors/cargo-packager 是跨平台打包项目，从tauri中拆分出来的，我们可以用打包我们的跨平台项目。
* 

