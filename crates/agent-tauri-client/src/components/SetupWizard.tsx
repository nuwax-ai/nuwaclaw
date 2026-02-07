/**
 * 初始化向导组件
 *
 * 管理客户端首次启动的配置流程:
 * 0. 依赖安装 - 自动执行，隐藏步骤（不可返回）
 * 1. 基础设置 - 服务器配置、端口、工作区
 * 2. 账号登录 - 网络权限检查、用户登录 → 完成后进入主界面
 */

import React, { useState, useEffect, useCallback } from "react";
import { Steps, Card, Typography, Space, Spin, Result } from "antd";
import {
  SettingOutlined,
  UserOutlined,
  CheckCircleOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { listen } from "@tauri-apps/api/event";
import {
  getCurrentStep,
  saveStepProgress,
  completeSetup,
  getDepsInstalled,
  setDepsInstalled,
} from "../services/setup";
import { restartAllServices } from "../services/dependencies";
import SetupStep1 from "./SetupStep1";
import SetupStep2 from "./SetupStep2";
import SetupStep3 from "./SetupStep3";

const { Title, Text } = Typography;

// 向导步骤配置（只显示 2 个配置步骤，依赖安装是隐藏的前置步骤）
const WIZARD_STEPS = [
  {
    key: 1,
    title: "基础设置",
    icon: <SettingOutlined />,
    description: "",
  },
  {
    key: 2,
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
  // 依赖是否安装完成（隐藏的前置步骤）
  const [dependenciesReady, setDependenciesReady] = useState<boolean | null>(null);
  // 当前配置步骤 (1=基础设置, 2=账号登录)
  const [currentStep, setCurrentStep] = useState<number>(1);
  // 是否正在加载初始状态
  const [loading, setLoading] = useState(true);
  // 是否完成
  const [completed, setCompleted] = useState(false);
  // 是否正在启动服务
  const [startingServices, setStartingServices] = useState(false);

  /**
   * 初始化: 加载保存的状态
   */
  useEffect(() => {
    const init = async () => {
      try {
        // 检查依赖是否已安装
        const depsInstalled = await getDepsInstalled();
        setDependenciesReady(depsInstalled);

        if (depsInstalled) {
          // 依赖已安装，加载配置步骤进度
          const step = await getCurrentStep();
          setCurrentStep(step);
          console.log("[SetupWizard] 依赖已安装，当前步骤:", step);
        } else {
          console.log("[SetupWizard] 需要先安装依赖");
        }
      } catch (error) {
        console.error("[SetupWizard] 加载状态失败:", error);
        setDependenciesReady(false);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  /**
   * 监听应用激活事件
   */
  useEffect(() => {
    const setupListener = async () => {
      const unlisten = await listen("tauri://focus", async () => {
        console.log("[SetupWizard] 应用激活");
      });
      return unlisten;
    };

    const unlistenPromise = setupListener();
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  /**
   * 依赖安装完成回调
   */
  const handleDepsComplete = useCallback(async () => {
    console.log("[SetupWizard] 依赖安装完成");
    await setDepsInstalled(true);
    setDependenciesReady(true);
    setCurrentStep(1);
  }, []);

  /**
   * 步骤1完成回调（基础设置）
   */
  const handleStep1Complete = useCallback(() => {
    setCurrentStep(2);
    saveStepProgress(2);
  }, []);

  /**
   * 返回上一步
   */
  const handleGoBack = useCallback(() => {
    if (currentStep > 1) {
      const newStep = currentStep - 1;
      setCurrentStep(newStep);
      saveStepProgress(newStep);
    }
  }, [currentStep]);

  /**
   * 点击步骤条切换步骤（只能切换到已完成的步骤）
   */
  const handleStepClick = useCallback(
    (step: number) => {
      // 只能回退到之前的步骤
      if (step < currentStep) {
        setCurrentStep(step + 1);
        saveStepProgress(step + 1);
      }
    },
    [currentStep],
  );

  /**
   * 步骤2完成回调（账号登录）- 直接进入主界面
   */
  const handleStep2Complete = useCallback(async () => {
    setStartingServices(true);

    try {
      // 启动服务
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

    // 配置步骤内容
    switch (currentStep) {
      case 1:
        return <SetupStep1 onComplete={handleStep1Complete} />;
      case 2:
        return (
          <SetupStep2 onComplete={handleStep2Complete} onBack={handleGoBack} />
        );
      default:
        return <SetupStep1 onComplete={handleStep1Complete} />;
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

  // 依赖安装阶段（隐藏步骤，无导航条）
  if (!dependenciesReady) {
    return (
      <div className="setup-wizard-container">
        {/* 简化的头部 */}
        <div className="setup-wizard-header">
          <Space>
            <RobotOutlined style={{ fontSize: 22, color: "#1890ff" }} />
            <Title level={4} style={{ margin: 0 }}>
              NuWax Agent 初始化
            </Title>
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            正在检查和安装必需依赖
          </Text>
        </div>

        {/* 依赖安装内容（无步骤导航） */}
        <div className="setup-wizard-content">
          <Card variant="borderless">
            <SetupStep3 onComplete={handleDepsComplete} />
          </Card>
        </div>

        {/* 底部 */}
        <div className="setup-wizard-footer">
          <Text type="secondary" style={{ fontSize: 12 }}>
            NuWax Agent v0.1.0
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

  // 配置步骤（显示步骤导航）
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
          完成以下配置后即可使用
        </Text>
      </div>

      {/* 步骤条（只显示 2 步） */}
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
            disabled: step.key > currentStep,
            style: step.key < currentStep ? { cursor: "pointer" } : undefined,
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
          max-width: 480px;
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
