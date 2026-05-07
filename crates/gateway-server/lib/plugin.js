/**
 * Gateway 插件接口与注册表
 *
 * 参考 OpenClaw Gateway 的模块化设计：
 * - 每个插件声明 name、prefix、handler
 * - Gateway 通过 prefix 路由分发到对应插件
 * - 插件通过 start/stop 管理生命周期
 */

/**
 * @typedef {Object} GatewayPlugin
 * @property {string} name - 插件唯一标识
 * @property {string} prefix - URL 路由前缀，如 "/chat2response"
 * @property {Function|null} handler - 处理匹配 prefix 的请求 (req, res) => void
 * @property {Function} start - 启动插件 (context: PluginContext) => Promise<void>
 * @property {Function} stop - 停止插件 () => Promise<void>
 * @property {Function} [healthCheck] - 健康检查 () => Promise<{healthy: boolean, error?: string}>
 */

/**
 * @typedef {Object} PluginContext
 * @property {string} resourcesDir - bundled 资源目录
 * @property {Record<string, string>} env - 环境变量
 */

export class PluginRegistry {
  /** @type {Map<string, GatewayPlugin>} */
  #plugins = new Map();

  /**
   * @param {GatewayPlugin} plugin
   */
  register(plugin) {
    if (!plugin.name || !plugin.prefix) {
      throw new Error(`[Gateway] Plugin must have name and prefix, got: ${JSON.stringify({ name: plugin.name, prefix: plugin.prefix })}`);
    }
    if (this.#plugins.has(plugin.name)) {
      throw new Error(`[Gateway] Plugin "${plugin.name}" already registered`);
    }
    this.#plugins.set(plugin.name, plugin);
  }

  /**
   * 根据请求路径匹配插件
   * @param {string} pathname
   * @returns {GatewayPlugin|null}
   */
  match(pathname) {
    for (const plugin of this.#plugins.values()) {
      if (pathname === plugin.prefix || pathname.startsWith(plugin.prefix + "/")) {
        return plugin;
      }
    }
    return null;
  }

  /**
   * @returns {GatewayPlugin[]}
   */
  getAll() {
    return [...this.#plugins.values()];
  }

  /**
   * 启动所有插件
   * @param {PluginContext} context
   */
  async startAll(context) {
    const errors = [];
    for (const plugin of this.#plugins.values()) {
      try {
        await plugin.start(context);
        console.log(`[Gateway] Plugin "${plugin.name}" started (prefix: ${plugin.prefix})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Gateway] Plugin "${plugin.name}" start failed: ${msg}`);
        errors.push({ name: plugin.name, error: msg });
      }
    }
    if (errors.length > 0) {
      const names = errors.map((e) => e.name).join(", ");
      console.warn(`[Gateway] Some plugins failed to start: ${names}`);
    }
  }

  /**
   * 停止所有插件
   */
  async stopAll() {
    for (const plugin of this.#plugins.values()) {
      try {
        await plugin.stop();
        console.log(`[Gateway] Plugin "${plugin.name}" stopped`);
      } catch (err) {
        console.error(`[Gateway] Plugin "${plugin.name}" stop failed:`, err);
      }
    }
  }
}
