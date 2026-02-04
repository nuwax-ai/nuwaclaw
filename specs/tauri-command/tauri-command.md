# Instructions

## Project Alpha

我需要提供接口给tauri UI前端的typescript来调用,目前已知的接口: 

```
/computer/agent/stop  ,  对应: commands::computer_agent_stop
/computer/agent/session/cancel ,对应: commands::computer_agent_session_cancel
/computer/agent/status   ,对应: command::computer_agent_status

```
其中 `command`只是tauri引用的 `command`,这样让ts来调用对应的接口 ,看下 : crates/nuwax-agent-core/src/api/traits/agent_runner.rs 这个当前接口,这里应该需要改造


然后还有服务: 
```
服务重启:
command::restart_nuwax_file_server()
command::stop_nuwax_file_server()
command::stop_rcoder()
command::restart_rcoder()
command::stop_all()
command::restart_all()
```
这里的rcoder服务,对应的是我们的 `crates/nuwax-agent-core/src/http_server` 这个服务, `crates/nuwax-agent-core/src/http_server/mod.rs`下的start服务,启动http服务,如果调用: restart_rcoder ,就停止http服务,然后重新启动; stop_rcoder 就是停止http服务就行; 


nuwax-file服务,是通过npm在安装的依赖命令,不要安装到全局,避免影响用户使用
```
npm i -g nuwax-file-server@latest
# 示例 3：修改所有路径（完整配置）
nuwax-file-server start \
  --env production \
  --port 60000 \
  INIT_PROJECT_NAME=my-template \
  INIT_PROJECT_DIR=/data/init \
  UPLOAD_PROJECT_DIR=/data/zips \
  PROJECT_SOURCE_DIR=/data/workspace \
  DIST_TARGET_DIR=/var/www/nginx \
  LOG_BASE_DIR=/var/logs/project_logs \
  COMPUTER_WORKSPACE_DIR=/data/computer \
  COMPUTER_LOG_DIR=/var/logs/computer
```
我们通过 process_wrap 这个库,用进程组的方式来启动服务, `command::restart_nuwax_file_server()`对应的业务逻辑,就是重启服务`nuwax-file-server` ,如果已启动,就停止,然后启动服务;  `stop_nuwax_file_server` 就是停止`nuwax-file-server`服务


`command::stop_all()`,就是对 `nuwax-file-server`服务,`crates/nuwax-agent-core/src/http_server` 服务,全都进行停止服务;
`command::restart_all()`,就是重启 `nuwax-file-server`服务,`crates/nuwax-agent-core/src/http_server` 服务,已启动,就停止掉,然后再启动;



npm依赖安装,我还需要提供几个接口,参考示意如下:
```
Command::install_dependency("nuwax_code")
command::query_version("nuwax_code")
command::reinstall_dependency("nuwax_code")
```
install_dependency就是根据名字,使用npm 来安装这个依赖, 并指定阿里云镜像仓库来安装,装最新的 latest 版本;
query_version 是根据名字,查询当前使用的版本号;
reinstall_dependency 就是软件已经存在,但可能有新版本,进行重装.
