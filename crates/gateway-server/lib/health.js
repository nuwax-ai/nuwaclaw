/**
 * Gateway 统一健康检查
 *
 * 聚合所有已注册插件的 healthCheck 结果。
 */

/**
 * @param {import('./plugin.js').PluginRegistry} registry
 * @returns {Promise<{healthy: boolean, plugins: Record<string, {healthy: boolean, error?: string}>, timestamp: number}>}
 */
export async function aggregateHealth(registry) {
  const plugins = {};
  let allHealthy = true;

  for (const plugin of registry.getAll()) {
    if (plugin.healthCheck) {
      try {
        const result = await plugin.healthCheck();
        plugins[plugin.name] = result;
        if (!result.healthy) allHealthy = false;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        plugins[plugin.name] = { healthy: false, error: msg };
        allHealthy = false;
      }
    } else {
      plugins[plugin.name] = { healthy: true };
    }
  }

  return { healthy: allHealthy, plugins, timestamp: Date.now() };
}
