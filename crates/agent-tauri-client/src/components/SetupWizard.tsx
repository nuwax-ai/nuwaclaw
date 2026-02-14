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
import { invoke } from "@tauri-apps/api/core";
import {
  getCurrentStep,
  saveStepProgress,
  completeSetup,
  getDepsInstalled,
  setDepsInstalled,
} from "../services/setup";
import {
  restartAllServices,
  checkAllSetupDependencies,
} from "../services/dependencies";
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
        // 静默预检（端口/目录）
        try {
          await invoke("preflight_check");
          console.log("[SetupWizard] 预检完成");
        } catch (err) {
          console.warn("[SetupWizard] 预检失败（不阻塞）:", err);
        }
        setPreflightPassed(true);

        // 实际检测所有依赖状态
        const deps = await checkAllSetupDependencies();
        const allInstalled = deps.every(
          (d) => d.status === "installed" || d.status === "bundled",
        );
        console.log(
          "[SetupWizard] 依赖检测:",
          deps.map((d) => `${d.name}:${d.status}`).join(", "),
        );

        if (allInstalled) {
          // 所有依赖就绪，跳过安装阶段
          setDependenciesReady(true);
          await setDepsInstalled(true);
          const step = await getCurrentStep();
          setCurrentStep(step);
        } else {
          // 有依赖缺失，进入安装流程
          setDependenciesReady(false);
        }
      } catch (error) {
        console.error("[SetupWizard] 初始化失败:", error);
        setPreflightPassed(true);
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
    const log = (msg: string, extra?: unknown) =>
      console.log("[SetupWizard] handleStep2Complete:", msg, extra ?? "");
    log("开始");
    setStartingServices(true);
    try {
      log("即将调用 restartAllServices()");
      await restartAllServices();
      log("restartAllServices() 已返回");
      log("即将调用 completeSetup()");
      await completeSetup();
      log("completeSetup() 已返回");
      setCompleted(true);
      log("已 setCompleted(true)，2s 后触发 onComplete");
      setTimeout(() => onComplete(), 2000);
    } catch (error) {
      console.error("[SetupWizard] handleStep2Complete 发生错误:", error);
      log("catch 中仍执行 completeSetup()");
      await completeSetup();
      setCompleted(true);
      setTimeout(() => onComplete(), 2000);
    } finally {
      log("finally，setStartingServices(false)");
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
        <div
          style={{
            minHeight: 320,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Result
            icon={<Spin size="large" />}
            title="正在启动服务..."
            subTitle="请稍候"
          />
        </div>
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
            {appName}
            {appVersion ? ` v${appVersion}` : ""}
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
            {appName}
            {appVersion ? ` v${appVersion}` : ""}
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
          {appName}
          {appVersion ? ` v${appVersion}` : ""} · 进度自动保存
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
