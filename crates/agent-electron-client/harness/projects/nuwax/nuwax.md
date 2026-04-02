# Nuwax Agent OS - 项目规范

> 适用于 Nuwax Agent OS 的开发规范

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端框架 | React 18 | 函数组件 + Hooks |
| 框架工具 | UmiJS Max | 约定式路由、插件体系 |
| UI 组件 | Ant Design | 优先 ProComponents |
| 图形引擎 | AntV X6 | 流程图、图可视化 |
| 状态管理 | Zustand / UmiJS model | 全局状态 |
| 样式 | CSS Modules / Less | 禁止全局污染 |
| 包管理 | pnpm | 优先使用 |
| 类型 | TypeScript | 严格模式 |

---

## 目录规范

```
src/
├── components/           # 通用组件
│   ├── Basic/          # 基础组件
│   ├── Business/        # 业务组件
│   └── Desktop/        # 桌面相关组件
├── pages/              # 页面
│   ├── AppDev/        # AppDev Web IDE
│   ├── Chat/          # 聊天模块
│   ├── Workflow/      # 工作流
│   └── Settings/       # 设置
├── models/             # UmiJS model (全局状态)
├── hooks/              # 自定义 Hooks
│   ├── useAppDev*.ts # AppDev 相关
│   └── use*.ts        # 通用
├── services/           # API 请求
│   ├── appDev.ts     # AppDev API
│   └── *.ts
├── utils/             # 工具函数
│   └── sseManager.ts # SSE 连接管理
├── constants/          # 常量
├── contexts/           # React Context
├── layouts/            # 布局组件
├── locales/            # 国际化
├── routes/             # 路由配置
├── plugins/            # UmiJS 插件
├── types/               # 类型定义
└── wrrappers/          # 封装组件
```

---

## 组件规范

### 文件命名

```
MyComponent.tsx        # 组件文件（首字母大写）
MyComponent.less         # 样式文件
MyComponent.props.ts    # Props 类型定义
index.ts               # 导出入口
```

### 组件结构

```tsx
/**
 * MyComponent - 组件描述
 * 
 * @description 功能描述、作用
 * @param props - 参数说明
 * @returns 返回值说明
 * 
 * @example
 * <MyComponent title="标题" />
 */

import { FC } from 'react';
import { Button } from 'antd';
import styles from './MyComponent.less';

interface Props {
  title: string;
  onClick?: () => void;
}

/**
 * 组件描述
 */
const MyComponent: FC<Props> = ({ title, onClick }) => {
  // 使用 useMemo 优化
  const displayTitle = useMemo(() => title.toUpperCase(), [title]);
  
  return (
    <div className={styles.container}>
      <span className={styles.title}>{displayTitle}</span>
      <Button onClick={onClick}>Click</Button>
    </div>
  );
};

export default MyComponent;
```

---

## API 服务规范

### 所有请求必须封装到 services/

```
services/
├── appDev.ts           # AppDev 相关 API
│   ├── getAppDevList()     // 获取列表
│   ├── createAppDev()       // 创建
│   ├── updateAppDev()       // 更新
│   └── deleteAppDev()       // 删除
└── types.ts            # API 类型定义
```

### API 封装模板

```typescript
/**
 * 获取应用列表
 * @param params - 查询参数
 * @returns 应用列表
 */
export async function getAppDevList(params: {
  page: number;
  pageSize: number;
}) {
  return request('/api/app-dev/list', {
    method: 'GET',
    params,
  });
}
```

### 禁止事项

- ❌ 禁止在组件内直接写 fetch/axios
- ❌ 禁止在组件内直接写 console.log
- ❌ 禁止不封装直接调用接口

---

## Ant Design 使用规范

### 优先使用 ProComponents

```tsx
// ✅ 推荐：使用 ProComponents
import { ProTable } from '@ant-design/pro-components';

<ProTable
  request={async (params) => {
    const result = await getAppDevList(params);
    return { data: result.data, success: true };
  }}
/>

// ❌ 避免：直接使用基础 Table
import { Table } from 'antd';

<Table dataSource={data} columns={columns} />
```

### 组件选择

| 场景 | 推荐组件 |
|------|----------|
| 表格列表 | ProTable |
| 表单弹窗 | ProModal + ProForm |
| 复杂表单 | ProForm + Form.Item |
| 搜索筛选 | ProForm + QueryFilter |
| 详情页 | ProDescriptions |

---

## AntV X6 图形规范

### 图形组件封装

```tsx
/**
 * WorkflowCanvas - 工作流画布组件
 * 
 * @description 基于 AntV X6 的工作流画布封装
 */
import { useCallback, useEffect, useRef } from 'react';
import { Graph } from '@antv/x6';

interface Props {
  data?: GraphData;
  onNodeClick?: (nodeId: string) => void;
}

/**
 * 画布初始化和数据绑定
 */
export const WorkflowCanvas: FC<Props> = ({ data, onNodeClick }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  
  // 初始化画布
  useEffect(() => {
    if (!containerRef.current) return;
    
    graphRef.current = new Graph({
      container: containerRef.current,
      // ... 配置
    });
    
    return () => graphRef.current?.dispose();
  }, []);
  
  // 更新数据
  useEffect(() => {
    if (graphRef.current && data) {
      graphRef.current.fromJSON(data);
    }
  }, [data]);
  
  return <div ref={containerRef} className={styles.canvas} />;
};
```

---

## 状态管理规范

### 全局状态用 UmiJS model

```typescript
// models/appDev.ts
import { Effect, Reducer } from 'umi';

export interface AppDevItem {
  id: string;
  name: string;
}

export interface AppDevModelState {
  list: AppDevItem[];
  current?: AppDevItem;
}

export interface AppDevModelType {
  namespace: 'appDev';
  state: AppDevModelState;
  effects: {
    fetchList: Effect;
    create: Effect;
  };
  reducers: {
    setList: Reducer<AppDevModelState>;
  };
}

const appDevModel: AppDevModelType = {
  namespace: 'appDev',
  state: {
    list: [],
  },
  effects: {
    *fetchList(_, { call, put }) {
      const response = yield call(getAppDevList);
      yield put({ type: 'setList', payload: response.data });
    },
  },
  reducers: {
    setList(state, action) {
      return { ...state, list: action.payload };
    },
  },
};

export default appDevModel;
```

---

## 性能优化规范

### 必须使用 useMemo/useCallback

```tsx
// ✅ 推荐：复杂计算用 useMemo
const filteredList = useMemo(() => 
  list.filter(item => item.name.includes(search)),
[list, search]);

// ✅ 推荐：回调函数用 useCallback
const handleClick = useCallback(() => {
  doSomething(id);
}, [id]);

// ❌ 避免：直接在 JSX 中写箭头函数
<Button onClick={() => handleClick(id)} />
```

### 组件拆分原则

| 原则 | 说明 |
|------|------|
| 单一职责 | 一个组件只做一件事 |
| 文件大小 | 单文件不超过 300 行 |
| Props | 超过 3 个 props 用对象传递 |

---

## 样式规范

### 使用 CSS Modules 或 Less

```less
// MyComponent.less
.container {
  padding: 16px;
  
  .title {
    font-size: 16px;
    font-weight: 500;
  }
}
```

### 禁止事项

- ❌ 禁止使用全局样式（除非在 styles/）
- ❌ 禁止使用 !important
- ❌ 禁止内联样式（除非动态值）

---

## 注释规范

### 必加注释

1. **文件顶部注释** - 文件描述、作者、日期
2. **组件注释** - 功能、参数、返回值、示例
3. **函数注释** - 功能、参数、返回值
4. **复杂逻辑注释** - 实现思路

```typescript
/**
 * @description 获取用户列表
 * @param {Object} params - 查询参数
 * @param {number} params.page - 页码
 * @param {number} params.pageSize - 每页条数
 * @returns {Promise<User[]>} 用户列表
 * @example
 * const users = await getUserList({ page: 1, pageSize: 10 });
 */
```

---

## Electron 特定（如有桌面端）

### 目录结构

```
src/
├── main/                 # Electron 主进程
│   ├── index.ts
│   └── ipc/
├── renderer/            # 渲染进程（UmiJS）
└── shared/              # 共享类型
```

### IPC 通信规范

- 必须定义 Interface
- 使用 contextBridge 暴露 API
- 禁止使用 remote module
