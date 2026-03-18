# NuwaClaw GUI Agent - 使用示例

> 如何在主 Agent 中使用 GUI Agent

## 快速开始

### 1. 配置 MCP

在主 Agent 配置中添加：

```json
{
  "mcpServers": {
    "nuwaclaw-gui-agent": {
      "command": "python3",
      "args": ["/path/to/mcp_server.py"],
      "env": {
        "ZHIPU_API_KEY": "your-key"
      }
    }
  }
}
```

### 2. 基础用法

#### 执行单个操作

```typescript
// 点击操作
await ctx.tools['gui_execute']({
  action_type: 'CLICK',
  parameters: {
    x: 100,
    y: 200,
    button: 'left'
  }
});

// 输入文本
await ctx.tools['gui_execute']({
  action_type: 'TYPING',
  parameters: {
    text: 'Hello, NuwaClaw!'
  }
});

// 按键
await ctx.tools['gui_execute']({
  action_type: 'HOTKEY',
  parameters: {
    keys: ['command', 'c']
  }
});
```

#### 批量操作

```typescript
// 批量执行多个操作
const result = await ctx.tools['gui_batch']({
  actions: [
    {
      action_type: 'MOVE_TO',
      parameters: { x: 100, y: 100 }
    },
    {
      action_type: 'CLICK',
      parameters: { button: 'left' }
    },
    {
      action_type: 'TYPING',
      parameters: { text: '搜索内容' }
    },
    {
      action_type: 'PRESS',
      parameters: { key: 'enter' }
    }
  ]
});

console.log(`成功: ${result.succeeded}/${result.total}`);
```

#### 图像定位

```typescript
// 定位图片
const location = await ctx.tools['gui_locate']({
  image_path: '/path/to/button.png',
  confidence: 0.9
});

if (location.success) {
  console.log(`找到图片: (${location.x}, ${location.y})`);
  console.log(`置信度: ${location.confidence}`);
}
```

#### 点击图片

```typescript
// 查找并点击图片
const result = await ctx.tools['gui_click_image']({
  image_path: '/path/to/button.png',
  confidence: 0.9,
  button: 'left'
});

if (result.success) {
  console.log('点击成功');
}
```

### 3. VLM 自然语言控制

```typescript
// 使用自然语言控制 GUI
const result = await ctx.tools['gui_vlm_execute']({
  instruction: '点击登录按钮',
  auto_confirm: false
});

console.log(result.reasoning);
console.log(`执行了 ${result.action_count} 个操作`);
```

#### 示例：自动化登录

```typescript
// 使用 VLM 自动登录
await ctx.tools['gui_vlm_execute']({
  instruction: '在用户名输入框输入 admin，密码输入框输入 password123，然后点击登录'
});
```

#### 示例：搜索并点击

```typescript
// 搜索并点击第一个结果
await ctx.tools['gui_vlm_execute']({
  instruction: '搜索 NuwaClaw 并点击第一个搜索结果'
});
```

### 4. 操作录制回放

```typescript
// 开始录制
await ctx.tools['gui_record_start']({
  session_id: 'test_session_1'
});

// ... 用户手动操作 ...

// 停止录制
const session = await ctx.tools['gui_record_stop']();
console.log(`录制了 ${session.action_count} 个操作`);

// 回放
await ctx.tools['gui_playback']({
  session_id: session.session_id,
  speed: 1.0
});
```

## 完整示例

### 示例 1：自动化表单填写

```typescript
async function fillForm() {
  // 1. 截图查看当前状态
  const screenshot = await ctx.tools['gui_screenshot']({});
  
  // 2. 使用 VLM 填写表单
  const result = await ctx.tools['gui_vlm_execute']({
    instruction: '填写表单：姓名张三，邮箱 test@example.com，电话 13800138000',
    auto_confirm: true
  });
  
  // 3. 提交表单
  await ctx.tools['gui_execute']({
    action_type: 'CLICK',
    parameters: {
      x: 500, // 提交按钮位置
      y: 600,
      button: 'left'
    }
  });
  
  return result;
}
```

### 示例 2：批量数据处理

```typescript
async function processBatchData(data: any[]) {
  for (const item of data) {
    // 打开新记录
    await ctx.tools['gui_execute']({
      action_type: 'HOTKEY',
      parameters: { keys: ['command', 'n'] }
    });
    
    // 填写数据
    await ctx.tools['gui_batch']({
      actions: [
        {
          action_type: 'TYPING',
          parameters: { text: item.name }
        },
        {
          action_type: 'PRESS',
          parameters: { key: 'tab' }
        },
        {
          action_type: 'TYPING',
          parameters: { text: item.value }
        },
        {
          action_type: 'PRESS',
          parameters: { key: 'enter' }
        }
      ]
    });
    
    // 等待处理完成
    await ctx.tools['gui_execute']({
      action_type: 'WAIT',
      parameters: { seconds: 1.0 }
    });
  }
}
```

### 示例 3：基于图像的自动化

```typescript
async function automateWithImages() {
  // 1. 点击菜单按钮
  await ctx.tools['gui_click_image']({
    image_path: '/images/menu-button.png',
    confidence: 0.9
  });
  
  // 2. 等待菜单出现
  await ctx.tools['gui_execute']({
    action_type: 'WAIT',
    parameters: { seconds: 0.5 }
  });
  
  // 3. 点击设置选项
  await ctx.tools['gui_click_image']({
    image_path: '/images/settings-option.png',
    confidence: 0.9
  });
  
  // 4. 在设置中搜索
  await ctx.tools['gui_execute']({
    action_type: 'TYPING',
    parameters: { text: '隐私' }
  });
}
```

## 最佳实践

### 1. 错误处理

```typescript
try {
  const result = await ctx.tools['gui_execute']({
    action_type: 'CLICK',
    parameters: { x: 100, y: 200 }
  });
  
  if (!result.success) {
    console.error('操作失败:', result.error);
    // 重试或提示用户
  }
} catch (error) {
  console.error('调用失败:', error);
}
```

### 2. 等待策略

```typescript
// 等待元素出现
await ctx.tools['gui_execute']({
  action_type: 'WAIT',
  parameters: { seconds: 1.0 }
});

// 或使用图像定位等待
let found = false;
for (let i = 0; i < 10; i++) {
  const result = await ctx.tools['gui_locate']({
    image_path: '/images/loading-done.png',
    confidence: 0.9
  });
  
  if (result.success) {
    found = true;
    break;
  }
  
  await new Promise(r => setTimeout(r, 500));
}

if (!found) {
  throw new Error('等待超时');
}
```

### 3. 日志记录

```typescript
// 记录操作
const actions = [];
const originalExecute = ctx.tools['gui_execute'];

ctx.tools['gui_execute'] = async (params) => {
  console.log(`[GUI] 执行: ${params.action_type}`, params.parameters);
  const result = await originalExecute(params);
  actions.push({
    timestamp: Date.now(),
    action: params,
    result
  });
  return result;
};
```

### 4. 性能优化

```typescript
// 批量操作减少 API 调用
await ctx.tools['gui_batch']({
  actions: [
    // ... 多个操作
  ]
});

// 而不是
// await ctx.tools['gui_execute']({ ... });
// await ctx.tools['gui_execute']({ ... });
// await ctx.tools['gui_execute']({ ... });
```

## 限制与注意事项

1. **权限要求**
   - macOS: 屏幕录制 + 辅助功能
   - Windows: 无特殊要求
   - Linux: 无特殊要求

2. **坐标系统**
   - 左上角为 (0, 0)
   - x 向右递增
   - y 向下递增

3. **性能考虑**
   - 截图操作较慢（~100ms）
   - 图像定位较慢（~200ms）
   - 批量操作更高效

4. **安全考虑**
   - 敏感操作需要用户确认
   - 支持操作回滚（部分）
   - 建议启用审计日志

## 故障排查

### 问题 1：权限不足

```
错误: 屏幕录制权限未授予
解决: 运行权限检查 UI
```

### 问题 2：坐标超出屏幕

```
错误: 坐标 (9999, 9999) 超出屏幕范围
解决: 检查屏幕尺寸，使用合理坐标
```

### 问题 3：图像未找到

```
错误: 未找到目标图片
解决: 降低置信度阈值，或使用更清晰的图片
```

## 下一步

- [ ] 添加更多使用示例
- [ ] 创建视频教程
- [ ] 编写最佳实践指南
- [ ] 添加故障排查手册
