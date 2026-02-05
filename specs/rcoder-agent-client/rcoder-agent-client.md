# Instructions

## Project Alpha

/Volumes/soddygo/git_work/rcoder 是我的rcoder项目,分支: nuwax-client , 模块: crates/agent_runner , 是我们的 crates/nuwax-agent-core/src/http_server 这个http服务模块,需要使用的, 还有 crates/agent-tauri-client/src-tauri/src/lib.rs 中涉及agent的相关服务,也是使用的这个模块,现在需要 模块: crates/agent_runner ,暴露对应的服务,在不影响之前的业务逻辑情况下,可以暴露增加一些逻辑, 给我们当前项目来使用,当前项目通过 git 分支来引入依赖进行使用和开发调试.


当前 crates/agent-tauri-client/src-tauri/src/lib.rs  中,涉及的服务,我知道的有: 
```
  rcoder_start,
  rcoder_stop,
  rcoder_restart,
  services_stop_all,
  services_restart_all,
  services_status_all,
```
