import { useState, useEffect } from "react";
import {
  permissionManager,
  PermissionRequest,
} from "../../services/agents/permissions";
import { t } from "../../services/core/i18n";

interface PermissionModalProps {
  isOpen: boolean;
  request: PermissionRequest | null;
  onApprove: (alwaysAllow: boolean) => void;
  onDeny: () => void;
}

function PermissionModal({
  isOpen,
  request,
  onApprove,
  onDeny,
}: PermissionModalProps) {
  const [countdown, setCountdown] = useState(30);

  useEffect(() => {
    if (isOpen && request) {
      setCountdown(30);
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [isOpen, request]);

  if (!isOpen || !request) return null;

  const getIcon = () => {
    switch (request.type) {
      case "command":
        return "🖥️";
      case "file":
        return "📁";
      case "network":
        return "🌐";
      case "tool":
        return "🔧";
      default:
        return "⚠️";
    }
  };

  const getDetails = () => {
    const details = request.details;
    switch (request.type) {
      case "command":
        return (
          <div className="permission-details">
            <div className="detail-row">
              <span className="label">{t("Claw.Permissions.command")}:</span>
              <code>
                {details.command} {details.args?.join(" ")}
              </code>
            </div>
            {details.env && (
              <div className="detail-row">
                <span className="label">{t("Claw.Permissions.envVars")}:</span>
                <span>{Object.keys(details.env).join(", ")}</span>
              </div>
            )}
          </div>
        );
      case "file":
        return (
          <div className="permission-details">
            <div className="detail-row">
              <span className="label">{t("Claw.Permissions.file")}:</span>
              <code>{details.file}</code>
            </div>
          </div>
        );
      case "network":
        return (
          <div className="permission-details">
            <div className="detail-row">
              <span className="label">URL:</span>
              <code>{details.url}</code>
            </div>
          </div>
        );
      case "tool":
        return (
          <div className="permission-details">
            <div className="detail-row">
              <span className="label">{t("Claw.Permissions.tool")}:</span>
              <code>{details.tool}</code>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="modal-overlay permission-modal-overlay">
      <div className="permission-modal">
        <div className="permission-header">
          <span className="permission-icon">{getIcon()}</span>
          <div className="permission-title">
            <h3>{request.title}</h3>
            <span className="permission-timer">
              {countdown} {t("Claw.Permissions.second")}
            </span>
          </div>
        </div>

        <div className="permission-body">
          <p className="permission-desc">{request.description}</p>
          {getDetails()}
        </div>

        <div className="permission-actions">
          <button className="deny-btn" onClick={onDeny}>
            {t("Claw.Permissions.deny")}
          </button>
          <button className="approve-once-btn" onClick={() => onApprove(false)}>
            {t("Claw.Permissions.allowOnce")}
          </button>
          <button
            className="approve-always-btn"
            onClick={() => onApprove(true)}
          >
            {t("Claw.Permissions.allowAlways")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PermissionModal;
