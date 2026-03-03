import { useState, useEffect } from 'react';
import { permissionManager, PermissionRequest } from '../../services/agents/permissions';

interface PermissionModalProps {
  isOpen: boolean;
  request: PermissionRequest | null;
  onApprove: (alwaysAllow: boolean) => void;
  onDeny: () => void;
}

function PermissionModal({ isOpen, request, onApprove, onDeny }: PermissionModalProps) {
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
      case 'command': return '🖥️';
      case 'file': return '📁';
      case 'network': return '🌐';
      case 'tool': return '🔧';
      default: return '⚠️';
    }
  };

  const getDetails = () => {
    const details = request.details;
    switch (request.type) {
      case 'command':
        return (
          <div className="permission-details">
            <div className="detail-row">
              <span className="label">命令:</span>
              <code>{details.command} {details.args?.join(' ')}</code>
            </div>
            {details.env && (
              <div className="detail-row">
                <span className="label">环境变量:</span>
                <span>{Object.keys(details.env).join(', ')}</span>
              </div>
            )}
          </div>
        );
      case 'file':
        return (
          <div className="permission-details">
            <div className="detail-row">
              <span className="label">文件:</span>
              <code>{details.file}</code>
            </div>
          </div>
        );
      case 'network':
        return (
          <div className="permission-details">
            <div className="detail-row">
              <span className="label">URL:</span>
              <code>{details.url}</code>
            </div>
          </div>
        );
      case 'tool':
        return (
          <div className="permission-details">
            <div className="detail-row">
              <span className="label">工具:</span>
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
            <span className="permission-timer">{countdown} 秒</span>
          </div>
        </div>

        <div className="permission-body">
          <p className="permission-desc">{request.description}</p>
          {getDetails()}
        </div>

        <div className="permission-actions">
          <button className="deny-btn" onClick={onDeny}>
            拒绝
          </button>
          <button className="approve-once-btn" onClick={() => onApprove(false)}>
            本次允许
          </button>
          <button className="approve-always-btn" onClick={() => onApprove(true)}>
            始终允许
          </button>
        </div>
      </div>
    </div>
  );
}

export default PermissionModal;
