import { useState, useEffect, useRef } from "react";
import { t } from "../../services/core/i18n";
import { fileServerService } from "../../services/integrations/fileServer";
import { LOCAL_HOST_URL, DEFAULT_FILE_SERVER_PORT } from "@shared/constants";

interface SkillsSyncProps {
  isOpen: boolean;
  onClose: () => void;
}

function SkillsSync({ isOpen, onClose }: SkillsSyncProps) {
  const [baseUrl, setBaseUrl] = useState(
    `${LOCAL_HOST_URL}:${DEFAULT_FILE_SERVER_PORT}`,
  );
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    await fileServerService.loadConfig();
    const config = fileServerService.getConfig();
    setBaseUrl(config.baseUrl);
    checkConnection();
  };

  const saveConfig = async () => {
    fileServerService.setConfig({ baseUrl });
    await fileServerService.saveConfig();
    setMessage(t("Claw.SkillsSync.configSaved"));
    setTimeout(() => setMessage(""), 2000);
  };

  const checkConnection = async () => {
    setChecking(true);
    const isConnected = await fileServerService.checkConnection();
    setConnected(isConnected);
    setChecking(false);
  };

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setMessage(t("Claw.SkillsSync.selectZipFile"));
      return;
    }

    if (!file.name.endsWith(".zip")) {
      setMessage(t("Claw.SkillsSync.onlyZipSupported"));
      return;
    }

    setUploading(true);
    setMessage("");
    setLogs([]);

    try {
      // Generate unique IDs
      const userId = "local-user";
      const cId = crypto.randomUUID();

      addLog(t("Claw.SkillsSync.creatingWorkspaceAndSyncing"));
      addLog(`User ID: ${userId}`);
      addLog(`Session ID: ${cId}`);
      addLog(`File: ${file.name}`);

      const result = await fileServerService.createWorkspace(userId, cId, file);

      addLog(`✓ ${t("Claw.SkillsSync.workspaceCreatedSuccess")}`);
      addLog(`Message: ${result.message}`);
      setMessage(t("Claw.SkillsSync.syncSuccess"));
    } catch (error) {
      addLog(`✗ ${t("Claw.SkillsSync.errorPrefix", { 0: String(error) })}`);
      setMessage(t("Claw.SkillsSync.errorPrefix", { 0: String(error) }));
    } finally {
      setUploading(false);
    }
  };

  const addLog = (text: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${timestamp}] ${text}`]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setMessage(
        t("Claw.SkillsSync.fileSelected", {
          0: file.name,
          1: (file.size / 1024).toFixed(1),
        }),
      );
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content skills-sync-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{t("Claw.SkillsSync.title")}</h2>
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="skills-sync-section">
          <h3>{t("Claw.SkillsSync.fileServiceConnection")}</h3>

          <div className="form-group">
            <label>{t("Claw.SkillsSync.serviceAddress")}</label>
            <div className="input-with-button">
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={`${LOCAL_HOST_URL}:${DEFAULT_FILE_SERVER_PORT}`}
              />
              <button
                className={`check-btn ${checking ? "checking" : ""}`}
                onClick={checkConnection}
                disabled={checking}
              >
                {checking
                  ? "..."
                  : connected
                    ? `✓ ${t("Claw.SkillsSync.connected")}`
                    : `○ ${t("Claw.SkillsSync.testConnection")}`}
              </button>
            </div>
          </div>

          <button className="save-btn small" onClick={saveConfig}>
            {t("Claw.Common.save")}
          </button>
        </div>

        <div className="skills-sync-section">
          <h3>{t("Claw.SkillsSync.uploadSkillPackage")}</h3>

          <p
            className="hint"
            dangerouslySetInnerHTML={{
              __html: t("Claw.SkillsSync.uploadHint"),
            }}
          />

          <div className="upload-area">
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              onChange={handleFileChange}
              disabled={uploading}
            />

            <button
              className="upload-btn"
              onClick={handleUpload}
              disabled={uploading || !connected}
            >
              {uploading
                ? t("Claw.SkillsSync.uploading")
                : t("Claw.SkillsSync.syncSkills")}
            </button>
          </div>
        </div>

        {logs.length > 0 && (
          <div className="skills-sync-section">
            <h3>{t("Claw.SkillsSync.logs")}</h3>
            <div className="log-area">
              {logs.map((log, i) => (
                <div key={i} className="log-line">
                  {log}
                </div>
              ))}
            </div>
          </div>
        )}

        {message && (
          <div
            className={`skills-sync-message ${message.includes(t("Claw.SkillsSync.errorPrefix").split("{0}")[0]) ? "error" : "success"}`}
          >
            {message}
          </div>
        )}
      </div>
    </div>
  );
}

export default SkillsSync;
