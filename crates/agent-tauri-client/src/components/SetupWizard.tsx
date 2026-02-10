/**
 * 初始化向导组件
 */

import React, { useState, useEffect, useCallback } from "react";
import { Steps, Typography, Spin, Result } from "antd";
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
import SetupBasicConfig from "./SetupBasicConfig";
import SetupAccountLogin from "./SetupAccountLogin";
import SetupDependencies from "./SetupDependencies";
import SetupPreflight from "./SetupPreflight";
import { useAppInfo } from "../hooks/useAppInfo";

const { Text } = Typography;

const WIZARD_STEPS = [
  { key: 1, title: "基础设置", icon: <SettingOutlined /> },
  { key: 2, title: "账号登录", icon: <UserOutlined /> },
];

interface SetupWizardProps {
  onComplete: () => void;
}

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [preflightPassed, setPreflightPassed] = useState<boolean | null>(null);
  const [dependenciesReady, setDependenciesReady] = useState<boolean | null>(
    null,
  );
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [completed, setCompleted] = useState(false);
  const [startingServices, setStartingServices] = useState(false);
  const { appName, appVersion } = useAppInfo();

  useEffect(() => {
    const init = async () => {
      try {
        const depsInstalled = await getDepsInstalled();
        if (depsInstalled) {
          // 依赖已装好，跳过预检和依赖阶段
          setPreflightPassed(true);
          setDependenciesReady(true);
          const step = await getCurrentStep();
          setCurrentStep(step);
        } else {
          // 先展示预检
          setPreflightPassed(false);
          setDependenciesReady(false);
        }
      } catch (error) {
        console.error("[SetupWizard] 加载状态失败:", error);
        setPreflightPassed(false);
        setDependenciesReady(false);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  useEffect(() => {
    const setupListener = async () => {
      const unlisten = await listen("tauri://focus", async () => {});
      return unlisten;
    };
    const p = setupListener();
    return () => {
      p.then((u) => u());
    };
  }, []);

  const handlePreflightComplete = useCallback(() => {
    setPreflightPassed(true);
  }, []);

  const handleDepsComplete = useCallback(async () => {
    await setDepsInstalled(true);
    setDependenciesReady(true);
    setCurrentStep(1);
  }, []);

  const handleStep1Complete = useCallback(() => {
    setCurrentStep(2);
    saveStepProgress(2);
  }, []);

  const handleGoBack = useCallback(() => {
    if (currentStep > 1) {
      const s = currentStep - 1;
      setCurrentStep(s);
      saveStepProgress(s);
    }
  }, [currentStep]);

  const handleStepClick = useCallback(
    (step: number) => {
      if (step < currentStep) {
        setCurrentStep(step + 1);
        saveStepProgress(step + 1);
      }
    },
    [currentStep],
  );

  const handleStep2Complete = useCallback(async () => {
    setStartingServices(true);
    try {
      await restartAllServices();
      await completeSetup();
      setCompleted(true);
      setTimeout(() => onComplete(), 2000);
    } catch (error) {
      await completeSetup();
      setCompleted(true);
      setTimeout(() => onComplete(), 2000);
    } finally {
      setStartingServices(false);
    }
  }, [onComplete]);

  const renderStepContent = () => {
    if (completed) {
      return (
        <Result
          icon={<CheckCircleOutlined style={{ color: "#16a34a" }} />}
          title="初始化完成"
          subTitle="正在进入主界面..."
          extra={<Spin size="small" />}
        />
      );
    }
    if (startingServices) {
      return (
        <Result
          icon={<Spin size="large" />}
          title="正在启动服务..."
          subTitle="请稍候"
        />
      );
    }
    switch (currentStep) {
      case 1:
        return <SetupBasicConfig onComplete={handleStep1Complete} />;
      case 2:
        return (
          <SetupAccountLogin
            onComplete={handleStep2Complete}
            onBack={handleGoBack}
          />
        );
      default:
        return <SetupBasicConfig onComplete={handleStep1Complete} />;
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.center}>
          <Spin size="small" />
        </div>
      </div>
    );
  }

  // 环境预检阶段
  if (!preflightPassed) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              justifyContent: "center",
              marginBottom: 4,
            }}
          >
            <RobotOutlined style={{ fontSize: 18, color: "#18181b" }} />
            <span style={{ fontSize: 15, fontWeight: 600 }}>{appName}</span>
          </div>
          <div style={{ fontSize: 12, color: "#a1a1aa", textAlign: "center" }}>
            环境预检
          </div>
        </div>

        <div style={styles.content}>
          <SetupPreflight onComplete={handlePreflightComplete} />
        </div>

        <div style={styles.footer}>
          <Text style={{ fontSize: 11, color: "#a1a1aa" }}>
            {appName}{appVersion ? ` v${appVersion}` : ""}
          </Text>
        </div>
      </div>
    );
  }

  // 依赖安装阶段
  if (!dependenciesReady) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              justifyContent: "center",
              marginBottom: 4,
            }}
          >
            <RobotOutlined style={{ fontSize: 18, color: "#18181b" }} />
            <span style={{ fontSize: 15, fontWeight: 600 }}>{appName}</span>
          </div>
          <div style={{ fontSize: 12, color: "#a1a1aa", textAlign: "center" }}>
            检查和安装必需依赖
          </div>
        </div>

        <div style={styles.content}>
          <SetupDependencies onComplete={handleDepsComplete} />
        </div>

        <div style={styles.footer}>
          <Text style={{ fontSize: 11, color: "#a1a1aa" }}>
            {appName}{appVersion ? ` v${appVersion}` : ""}
          </Text>
        </div>
      </div>
    );
  }

  // 配置步骤
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifyContent: "center",
            marginBottom: 4,
          }}
        >
          <RobotOutlined style={{ fontSize: 18, color: "#18181b" }} />
          <span style={{ fontSize: 15, fontWeight: 600 }}>初始化向导</span>
        </div>
        <div style={{ fontSize: 12, color: "#a1a1aa", textAlign: "center" }}>
          完成配置后即可使用
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: "0 auto 12px", padding: "0 8px" }}>
        <Steps
          current={currentStep - 1}
          size="small"
          onChange={handleStepClick}
          items={WIZARD_STEPS.map((step) => ({
            title: step.title,
            icon: step.icon,
            disabled: step.key > currentStep,
          }))}
        />
      </div>

      <div style={styles.content}>{renderStepContent()}</div>

      <div style={styles.footer}>
        <Text style={{ fontSize: 11, color: "#a1a1aa" }}>
          {appName}{appVersion ? ` v${appVersion}` : ""} · 进度自动保存
        </Text>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: "#fafafa",
    padding: 16,
  },
  center: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
  },
  header: {
    marginBottom: 12,
  },
  content: {
    flex: 1,
    maxWidth: 640,
    width: "100%",
    margin: "0 auto",
    overflowY: "auto",
    background: "#fff",
    border: "1px solid #e4e4e7",
    borderRadius: 8,
    padding: 20,
  },
  footer: {
    textAlign: "center",
    marginTop: 8,
  },
};
