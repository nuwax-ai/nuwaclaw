/**
 * 初始化向导组件
 *
 * 管理客户端首次启动的配置流程:
 * 1. 依赖安装 - Node.js 检测/自动安装、npm 包安装
 * 2. 基础设置 - 服务器配置、端口、工作区
 * 3. 账号登录 - 网络权限检查、用户登录
 */

import React, { useState, useEffect, useCallback } from "react";
import { Steps, Card, Typography, Space, Button, Result, Spin } from "antd";
import {
  SettingOutlined,
  UserOutlined,
  CloudDownloadOutlined,
  CheckCircleOutlined,
  RobotOutlined,
  LeftOutlined,
} from "@ant-design/icons";
import { listen } from "@tauri-apps/api/event";
import {
  getCurrentStep,
  saveStepProgress,
  completeSetup,
} from "../services/setup";
import { restartAllServices } from "../services/dependencies";
import SetupStep1 from "./SetupStep1";
import SetupStep2 from "./SetupStep2";
import SetupStep3 from "./SetupStep3";

const { Title, Text } = Typography;

// 向导步骤配置（新顺序: 依赖安装 → 基础设置 → 账号登录）
const WIZARD_STEPS = [
  {
    key: 1,
    title: "依赖安装",
    icon: <CloudDownloadOutlined />,
    description: "",
  },
  {
    key: 2,
    title: "基础设置",
    icon: <SettingOutlined />,
    description: "",
  },
  {
    key: 3,
    title: "账号登录",
    icon: <UserOutlined />,
    description: "",
  },
];

interface SetupWizardProps {
  /** 完成回调 */
  onComplete: () => void;
}

/**
 * 初始化向导组件
 */
export default function SetupWizard({ onComplete }: SetupWizardProps) {
  // 当前步骤 (1/2/3)
  const [currentStep, setCurrentStep] = useState<number>(1);
  // 是否正在加载初始状态
  const [loading, setLoading] = useState(true);
  // 是否完成
  const [completed, setCompleted] = useState(false);
  // 是否正在启动服务
  const [startingServices, setStartingServices] = useState(false);

  /**
   * 初始化: 加载保存的步骤进度
   */
  useEffect(() => {
    const init = async () => {
      try {
        const step = await getCurrentStep();
        setCurrentStep(step);
        console.log("[SetupWizard] 当前步骤:", step);
      } catch (error) {
        console.error("[SetupWizard] 加载步骤失败:", error);
        setCurrentStep(1);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  /**
   * 监听应用激活事件（断点续传）
   * 当用户切换回应用时，如果在步骤3，重新检测依赖状态
   */
  useEffect(() => {
    const setupListener = async () => {
      const unlisten = await listen("tauri://focus", async () => {
        console.log("[SetupWizard] 应用激活，重新检测状态");
        // 如果在步骤3，重新检测依赖状态由 SetupStep3 组件处理
      });
      return unlisten;
    };

    const unlistenPromise = setupListener();
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  /**
   * 步骤1完成回调（依赖安装完成）
   */
  const handleStep1Complete = useCallback(() => {
    setCurrentStep(2);
    saveStepProgress(2);
  }, []);

  /**
   * 步骤2完成回调（基础配置完成）
   */
  const handleStep2Complete = useCallback(() => {
    setCurrentStep(3);
    saveStepProgress(3);
  }, []);

  /**
   * 返回上一步（最小值为2，不能回到步骤1-依赖安装）
   */
  const handleGoBack = useCallback(() => {
    if (currentStep > 2) {
      const newStep = currentStep - 1;
      setCurrentStep(newStep);
      saveStepProgress(newStep);
    }
  }, [currentStep]);

  /**
   * 点击步骤条切换步骤（只能切换到已完成的步骤，但不能回到步骤1）
   */
  const handleStepClick = useCallback(
    (step: number) => {
      const targetStep = step + 1; // Steps 的 current 是从 0 开始的
      // 不能回到步骤1（依赖安装），且只能回退到之前的步骤
      if (targetStep >= 2 && targetStep < currentStep) {
        setCurrentStep(targetStep);
        saveStepProgress(targetStep);
      }
    },
    [currentStep],
  );

  /**
   * 步骤3完成回调（登录成功 → 启动服务 → 进入主界面）
   */
  const handleStep3Complete = useCallback(async () => {
    setStartingServices(true);

    try {
      // 调用启动服务 (TODO: 实际启动逻辑后续实现)
      await restartAllServices();

      // 标记初始化完成
      await completeSetup();

      setCompleted(true);

      // 延迟后进入主界面
      setTimeout(() => {
        onComplete();
      }, 2000);
    } catch (error) {
      console.error("[SetupWizard] 完成初始化失败:", error);
      // 即使启动服务失败，也标记为完成
      await completeSetup();
      setCompleted(true);
      setTimeout(() => {
        onComplete();
      }, 2000);
    } finally {
      setStartingServices(false);
    }
  }, [onComplete]);

  /**
   * 渲染当前步骤内容
   */
  const renderStepContent = () => {
    // 完成状态
    if (completed) {
      return (
        <Result
          icon={<CheckCircleOutlined style={{ color: "#52c41a" }} />}
          title="初始化完成"
          subTitle="正在进入主界面..."
          extra={<Spin />}
        />
      );
    }

    // 正在启动服务
    if (startingServices) {
      return (
        <Result
          icon={<Spin size="large" />}
          title="正在启动服务..."
          subTitle="请稍候"
        />
      );
    }

    // 各步骤内容（新顺序: 依赖安装 → 基础配置 → 账号登录）
    switch (currentStep) {
      case 1:
        return <SetupStep3 onComplete={handleStep1Complete} />;
      case 2:
        return <SetupStep1 onComplete={handleStep2Complete} />;
      case 3:
        return (
          <SetupStep2 onComplete={handleStep3Complete} onBack={handleGoBack} />
        );
      default:
        return <SetupStep3 onComplete={handleStep1Complete} />;
    }
  };

  // 加载中
  if (loading) {
    return (
      <div className="setup-wizard-container">
        <div className="setup-wizard-loading">
          <Spin size="large" />
          <Text style={{ marginTop: 16 }}>正在加载...</Text>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-wizard-container">
      {/* 头部 */}
      <div className="setup-wizard-header">
        <Space>
          <RobotOutlined style={{ fontSize: 22, color: "#1890ff" }} />
          <Title level={4} style={{ margin: 0 }}>
            NuWax Agent 初始化向导
          </Title>
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>
          首次使用需要完成以下配置
        </Text>
      </div>

      {/* 步骤条 */}
      <div className="setup-wizard-steps">
        <Steps
          current={currentStep - 1}
          size="small"
          onChange={handleStepClick}
          items={WIZARD_STEPS.map((step) => ({
            title: step.title,
            description:
              currentStep === step.key ? step.description : undefined,
            icon: step.icon,
            // 步骤1完成后不能回退；后续步骤只有当前或已完成才能点击
            disabled:
              step.key > currentStep || (step.key === 1 && currentStep > 1),
            style:
              step.key >= 2 && step.key < currentStep
                ? { cursor: "pointer" }
                : undefined,
          }))}
        />
      </div>

      {/* 内容区 */}
      <div className="setup-wizard-content">
        <Card variant="borderless">{renderStepContent()}</Card>
      </div>

      {/* 底部 */}
      <div className="setup-wizard-footer">
        <Text type="secondary" style={{ fontSize: 12 }}>
          NuWax Agent v0.1.0 | 初始化进度会自动保存
        </Text>
      </div>

      {/* 内联样式 */}
      <style>{`
        .setup-wizard-container {
          display: flex;
          flex-direction: column;
          height: 100vh;
          background: linear-gradient(135deg, #f5f7fa 0%, #e4e8eb 100%);
          padding: 16px;
        }

        .setup-wizard-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
        }

        .setup-wizard-header {
          text-align: center;
          margin-bottom: 12px;
        }

        .setup-wizard-header .ant-space {
          margin-bottom: 4px;
        }

        .setup-wizard-steps {
          max-width: 720px;
          margin: 0 auto 12px;
          padding: 0 8px;
        }

        .setup-wizard-steps .ant-steps-item-title {
          font-size: 13px;
        }

        .setup-wizard-steps .ant-steps-item-description {
          font-size: 12px;
        }

        .setup-wizard-steps .ant-steps-item-icon {
          transform: scale(0.9);
        }

        .setup-wizard-steps .ant-steps-item {
          padding-inline-start: 4px;
        }

        .setup-wizard-content {
          flex: 1;
          max-width: 720px;
          width: 100%;
          margin: 0 auto;
          overflow-y: auto;
        }

        .setup-wizard-content .ant-card {
          min-height: 280px;
        }

        .setup-wizard-footer {
          text-align: center;
          margin-top: 8px;
        }
      `}</style>
    </div>
  );
}
