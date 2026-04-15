/**
 * InteractiveQuestionCard — 交互式问题卡片
 *
 * 收到 question.requested 事件时，展示交互式 UI，
 * 支持按钮选择、下拉选择等交互方式。
 *
 * 用户响应后，调用 respondPermission 继续执行。
 *
 * @version 1.0.0
 * @updated 2026-04-15
 */

import React, { useState, useEffect, useCallback } from "react";
import { Card, Button, Select, Space, Tag, Typography, Spin } from "antd";
import {
  QuestionCircleOutlined,
  CheckOutlined,
  CloseOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { t } from "@renderer/services/core/i18n";
import styles from "../styles/components/PermissionRequestCard.module.css";

const { Text, Title } = Typography;

/** 待处理问题类型 */
export interface PendingQuestion {
  sessionId: string;
  questionId: string;
  title?: string | null;
  options: Array<{
    optionId: string;
    kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
    name: string;
  }>;
  rawInput?: unknown;
  arrivedAt: number;
}

interface InteractiveQuestionCardProps {
  questions: PendingQuestion[];
  onRespond: (sessionId: string, questionId: string, optionId: string) => void;
}

/** 默认超时时间 60s */
const DEFAULT_TIMEOUT_MS = 60_000;

const InteractiveQuestionCard: React.FC<InteractiveQuestionCardProps> = ({
  questions,
  onRespond,
}) => {
  const [selectedOptions, setSelectedOptions] = useState<
    Record<string, string>
  >({});
  const [countdown, setCountdown] = useState<Record<string, number>>({});

  // 初始化倒计时
  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];

    questions.forEach((q) => {
      if (!countdown[q.questionId]) {
        const remaining = Math.max(
          0,
          DEFAULT_TIMEOUT_MS - (Date.now() - q.arrivedAt),
        );
        setCountdown((prev) => ({
          ...prev,
          [q.questionId]: Math.ceil(remaining / 1000),
        }));

        // 每秒更新倒计时
        const timer = setInterval(() => {
          const newRemaining = Math.max(
            0,
            DEFAULT_TIMEOUT_MS - (Date.now() - q.arrivedAt),
          );
          setCountdown((prev) => ({
            ...prev,
            [q.questionId]: Math.ceil(newRemaining / 1000),
          }));

          if (newRemaining <= 0) {
            clearInterval(timer);
            // 超时自动拒绝
            onRespond(q.sessionId, q.questionId, "reject_timeout");
          }
        }, 1000);

        timers.push(timer);
      }
    });

    return () => {
      timers.forEach((t) => clearInterval(t));
    };
  }, [questions]);

  // 处理选择变更
  const handleSelectChange = useCallback(
    (questionId: string, optionId: string) => {
      setSelectedOptions((prev) => ({
        ...prev,
        [questionId]: optionId,
      }));
    },
    [],
  );

  // 处理按钮点击
  const handleButtonClick = useCallback(
    (sessionId: string, questionId: string, optionId: string) => {
      onRespond(sessionId, questionId, optionId);
    },
    [onRespond],
  );

  // 处理确认选择
  const handleConfirm = useCallback(
    (sessionId: string, questionId: string) => {
      const optionId = selectedOptions[questionId];
      if (optionId) {
        onRespond(sessionId, questionId, optionId);
      }
    },
    [selectedOptions, onRespond],
  );

  if (questions.length === 0) {
    return null;
  }

  return (
    <div className={styles.container}>
      {questions.map((q) => {
        const remaining = countdown[q.questionId] ?? 60;
        const isExpiring = remaining <= 10;

        return (
          <Card
            key={q.questionId}
            className={styles.card}
            size="small"
            title={
              <Space>
                <QuestionCircleOutlined
                  style={{ color: "#1890ff", fontSize: 18 }}
                />
                <Text strong>{q.title || t("Claw.Question.defaultTitle")}</Text>
              </Space>
            }
            extra={
              <Tag color={isExpiring ? "error" : "default"}>{remaining}s</Tag>
            }
          >
            <Space direction="vertical" style={{ width: "100%" }}>
              {/* 问题内容 */}
              {q.rawInput && typeof q.rawInput === "object" && (
                <Text type="secondary">
                  {JSON.stringify(q.rawInput).slice(0, 200)}
                </Text>
              )}

              {/* 选项渲染 */}
              <div className={styles.options}>
                {q.options.length <= 4 ? (
                  // 少量选项用按钮
                  <Space wrap>
                    {q.options.map((opt) => (
                      <Button
                        key={opt.optionId}
                        type={
                          opt.kind.startsWith("allow") ? "primary" : "default"
                        }
                        danger={opt.kind.startsWith("reject")}
                        size="small"
                        onClick={() =>
                          handleButtonClick(
                            q.sessionId,
                            q.questionId,
                            opt.optionId,
                          )
                        }
                      >
                        {opt.name}
                      </Button>
                    ))}
                  </Space>
                ) : (
                  // 多个选项用下拉
                  <Space.Compact style={{ width: "100%" }}>
                    <Select
                      style={{ width: "calc(100% - 80px)" }}
                      placeholder={t("Claw.Question.selectOption")}
                      value={selectedOptions[q.questionId]}
                      onChange={(value) =>
                        handleSelectChange(q.questionId, value)
                      }
                      options={q.options.map((opt) => ({
                        value: opt.optionId,
                        label: opt.name,
                      }))}
                    />
                    <Button
                      type="primary"
                      onClick={() => handleConfirm(q.sessionId, q.questionId)}
                      disabled={!selectedOptions[q.questionId]}
                    >
                      {t("Claw.Common.confirm")}
                    </Button>
                  </Space.Compact>
                )}
              </div>
            </Space>
          </Card>
        );
      })}
    </div>
  );
};

export default InteractiveQuestionCard;
