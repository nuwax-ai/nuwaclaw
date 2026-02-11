// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#![allow(unexpected_cfgs)]
#[macro_use]
extern crate log;

// ========== 模块声明 ==========
mod app;
mod commands;
mod models;
mod state;
mod tray;
mod utils;

// ========== 公共 API 导出 ==========
/// 主入口函数，启动 Tauri 应用
pub use app::run;
