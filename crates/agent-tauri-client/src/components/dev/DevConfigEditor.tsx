/**
 * 开发工具 - 配置编辑模态框
 * 编辑场景配置（服务端 + 本地服务）
 *
 * 注意：此组件仅在开发环境下加载
 */

import { useState, useEffect } from "react";
import {
  Modal,
  Form,
  Input,
  InputNumber,
  Space,
  Card,
  message,
  Alert,
} from "antd";
import { GlobalOutlined, DesktopOutlined } from "@ant-design/icons";
import {
  addCustomScene,
  updateCustomScene,
  SceneConfig,
  ServerConfig,
  LocalServicesConfig,
} from "../../services/config";
import {
  DEFAULT_FILE_SERVER_PORT,
  DEFAULT_PROXY_PORT,
  DEFAULT_VNC_PORT,
  DEFAULT_LOCAL_HOST,
  DEFAULT_TIMEOUT,
} from "../../constants";

interface DevConfigEditorProps {
  visible: boolean;
  onCancel: () => void;
  scene?: SceneConfig | null;
  isNew?: boolean;
  onSave?: () => void;
}

/**
 * 开发配置编辑器组件
 */
export default function DevConfigEditor({
  visible,
  onCancel,
  scene,
  isNew = false,
  onSave,
}: DevConfigEditorProps) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible && scene) {
      form.setFieldsValue({
        name: scene.name,
        description: scene.description,
        serverApiUrl: scene.server.apiUrl,
        serverTimeout: scene.server.timeout,
        agentHost: scene.local.agent.host,
        agentPort: scene.local.agent.port,
        agentScheme: scene.local.agent.scheme,
        vncHost: scene.local.vnc.host,
        vncPort: scene.local.vnc.port,
        fileServerHost: scene.local.fileServer.host,
        fileServerPort: scene.local.fileServer.port,
        fileServerScheme: scene.local.fileServer.scheme,
        websocketHost: scene.local.websocket.host,
        websocketPort: scene.local.websocket.port,
        websocketScheme: scene.local.websocket.scheme,
      });
    } else if (visible && isNew) {
      form.resetFields();
      // 设置默认值
      form.setFieldsValue({
        agentHost: DEFAULT_LOCAL_HOST,
        agentPort: DEFAULT_PROXY_PORT,
        agentScheme: "http",
        vncHost: DEFAULT_LOCAL_HOST,
        vncPort: DEFAULT_VNC_PORT,
        fileServerHost: DEFAULT_LOCAL_HOST,
        fileServerPort: DEFAULT_FILE_SERVER_PORT,
        websocketHost: DEFAULT_LOCAL_HOST,
        websocketPort: DEFAULT_PROXY_PORT,
      });
    }
  }, [visible, scene, isNew, form]);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const values = await form.validateFields();

      const serverConfig: ServerConfig = {
        apiUrl: values.serverApiUrl,
        timeout: values.serverTimeout || DEFAULT_TIMEOUT,
      };

      const localConfig: LocalServicesConfig = {
        agent: {
          host: values.agentHost,
          port: values.agentPort,
          scheme: values.agentScheme,
        },
        vnc: {
          host: values.vncHost,
          port: values.vncPort,
        },
        fileServer: {
          host: values.fileServerHost,
          port: values.fileServerPort,
          scheme: values.fileServerScheme,
        },
        websocket: {
          host: values.websocketHost,
          port: values.websocketPort,
          scheme: values.websocketScheme,
        },
      };

      if (isNew) {
        addCustomScene({
          name: values.name,
          description: values.description,
          server: serverConfig,
          local: localConfig,
        });
        message.success("配置已添加");
      } else if (scene) {
        updateCustomScene(scene.id, {
          name: values.name,
          description: values.description,
          server: serverConfig,
          local: localConfig,
        });
        message.success("配置已更新");
      }

      onCancel();
      onSave?.();
    } catch (error) {
      console.error("[DevConfigEditor] 验证失败:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={isNew ? "添加配置" : "编辑配置"}
      open={visible}
      onCancel={onCancel}
      onOk={handleSubmit}
      confirmLoading={loading}
      width={700}
      okText="保存"
      cancelText="取消"
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          serverTimeout: DEFAULT_TIMEOUT,
          agentScheme: "http",
          fileServerScheme: "http",
          websocketScheme: "ws",
        }}
      >
        {/* 基本信息 */}
        <Card size="small" title="基本信息" style={{ marginBottom: 16 }}>
          <Form.Item
            label="配置名称"
            name="name"
            rules={[{ required: true, message: "请输入配置名称" }]}
          >
            <Input placeholder="例如: 公司测试环境" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} placeholder="可选的描述信息" />
          </Form.Item>
        </Card>

        {/* 服务端配置 */}
        <Card
          size="small"
          title={
            <Space>
              <GlobalOutlined />
              <span>服务端配置</span>
            </Space>
          }
          style={{ marginBottom: 16 }}
        >
          <Alert
            message="API 服务器地址"
            description="用于客户端注册的服务器地址"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <Form.Item
            label="API 服务器地址"
            name="serverApiUrl"
            rules={[{ required: true, message: "请输入 API 服务器地址" }]}
          >
            <Input placeholder="https://api.example.com" />
          </Form.Item>
          <Form.Item label="请求超时 (毫秒)" name="serverTimeout">
            <InputNumber min={1000} max={60000} style={{ width: "100%" }} />
          </Form.Item>
        </Card>

        {/* 本地服务配置 */}
        <Card
          size="small"
          title={
            <Space>
              <DesktopOutlined />
              <span>本地服务配置</span>
            </Space>
          }
        >
          <Alert
            message="本地运行的服务地址"
            description="本机启动的 Agent、VNC、文件等服务地址"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
          >
            {/* Agent */}
            <Form.Item label="Agent 服务" style={{ marginBottom: 8 }}>
              <Space.Compact style={{ width: "100%" }}>
                <Form.Item
                  name="agentHost"
                  noStyle
                  rules={[{ required: true }]}
                >
                  <Input placeholder="127.0.0.1" style={{ width: "60%" }} />
                </Form.Item>
                <Form.Item
                  name="agentPort"
                  noStyle
                  rules={[{ required: true }]}
                >
                  <InputNumber
                    placeholder="端口"
                    min={1}
                    max={65535}
                    style={{ width: "40%" }}
                  />
                </Form.Item>
              </Space.Compact>
            </Form.Item>

            {/* VNC */}
            <Form.Item label="VNC 服务" style={{ marginBottom: 8 }}>
              <Space.Compact style={{ width: "100%" }}>
                <Form.Item name="vncHost" noStyle rules={[{ required: true }]}>
                  <Input placeholder="127.0.0.1" style={{ width: "60%" }} />
                </Form.Item>
                <Form.Item name="vncPort" noStyle rules={[{ required: true }]}>
                  <InputNumber
                    placeholder="端口"
                    min={1}
                    max={65535}
                    style={{ width: "40%" }}
                  />
                </Form.Item>
              </Space.Compact>
            </Form.Item>

            {/* 文件服务 */}
            <Form.Item label="文件服务" style={{ marginBottom: 8 }}>
              <Space.Compact style={{ width: "100%" }}>
                <Form.Item
                  name="fileServerHost"
                  noStyle
                  rules={[{ required: true }]}
                >
                  <Input placeholder="127.0.0.1" style={{ width: "60%" }} />
                </Form.Item>
                <Form.Item
                  name="fileServerPort"
                  noStyle
                  rules={[{ required: true }]}
                >
                  <InputNumber
                    placeholder="端口"
                    min={1}
                    max={65535}
                    style={{ width: "40%" }}
                  />
                </Form.Item>
              </Space.Compact>
            </Form.Item>

            {/* WebSocket */}
            <Form.Item label="WebSocket" style={{ marginBottom: 8 }}>
              <Space.Compact style={{ width: "100%" }}>
                <Form.Item
                  name="websocketHost"
                  noStyle
                  rules={[{ required: true }]}
                >
                  <Input placeholder="127.0.0.1" style={{ width: "60%" }} />
                </Form.Item>
                <Form.Item
                  name="websocketPort"
                  noStyle
                  rules={[{ required: true }]}
                >
                  <InputNumber
                    placeholder="端口"
                    min={1}
                    max={65535}
                    style={{ width: "40%" }}
                  />
                </Form.Item>
              </Space.Compact>
            </Form.Item>
          </div>
        </Card>
      </Form>
    </Modal>
  );
}
