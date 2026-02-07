# Instructions

## Project Alpha

我需要提供接口给tauri UI前端的typescript来调用,目前已知的接口: 

```
/rcoder/start   ,对应: commands::rcoder_start
/rcoder/stop    ,对应: commands::rcoder_stop
/rcoder/restart ,对应: commands::rcoder_restart
/services/status/all ,对应: commands::services_status_all

```
其中 `command`只是tauri引用的 `command`,这样让ts来调用对应的接口 ,看下 : crates/nuwax-agent-core/src/api/traits/agent_runner.rs 这个当前接口,这里应该需要改造


然后还有服务: 
```
服务重启:
commands::file_server_start()
commands::file_server_stop()
commands::file_server_restart()
commands::rcoder_start()
commands::rcoder_stop()
commands::rcoder_restart()
commands::services_stop_all()
commands::services_restart_all()
commands::services_status_all()
```
这里的rcoder服务,对应的是我们的 `crates/nuwax-agent-core/src/http_server` 这个服务, `crates/nuwax-agent-core/src/http_server/mod.rs`下的start服务,启动http服务,如果调用: `rcoder_restart` ,就停止http服务,然后重新启动; `rcoder_stop` 就是停止http服务就行; 


nuwax-file服务,是通过npm在安装的依赖命令,不要安装到全局,避免影响用户使用
```
npm i nuwax-file-server@latest --prefix <APP_DATA_DIR>
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
我们通过 process_wrap 这个库,用进程组的方式来启动服务, `commands::file_server_restart()`对应的业务逻辑,就是重启服务`nuwax-file-server` ,如果已启动,就停止,然后启动服务;  `commands::file_server_stop()` 就是停止`nuwax-file-server`服务


`commands::services_stop_all()`,就是对 `nuwax-file-server`服务,`crates/nuwax-agent-core/src/http_server` 服务,全都进行停止服务;
`commands::services_restart_all()`,就是重启 `nuwax-file-server`服务,`crates/nuwax-agent-core/src/http_server` 服务,已启动,就停止掉,然后再启动;



npm依赖安装,我还需要提供几个接口,参考示意如下:
```
commands::dependency_npm_install("nuwax-file-server")
commands::dependency_npm_query_version("nuwaxcode")
commands::dependency_npm_reinstall("claude-code-acp-ts")
```
`dependency_npm_install` 就是根据名字,使用npm 来安装这个依赖, 并指定阿里云镜像仓库来安装,装最新的 latest 版本;
`dependency_npm_query_version` 是根据名字,查询当前使用的版本号;
`dependency_npm_reinstall` 就是软件已经存在,但可能有新版本,进行重装.
