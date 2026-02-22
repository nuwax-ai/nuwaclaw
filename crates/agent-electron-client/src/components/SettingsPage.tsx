import { useState, useEffect } from 'react';

interface Settings {
  anthropic_api_key: string;
  default_model: string;
  max_tokens: number;
  temperature: number;
}

const defaultSettings: Settings = {
  anthropic_api_key: '',
  default_model: 'claude-sonnet-4-20250514',
  max_tokens: 4096,
  temperature: 1.0,
};

interface SettingsPageProps {
  isOpen: boolean;
  onClose: () => void;
}

function SettingsPage({ isOpen, onClose }: SettingsPageProps) {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const saved = await window.electronAPI?.settings.get('app_settings');
      if (saved) {
        setSettings({ ...defaultSettings, ...(saved as Settings) });
      }
    } catch (error) {
      console.error('加载配置失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    setMessage('');
    try {
      await window.electronAPI?.settings.set('app_settings', settings);
      await window.electronAPI?.settings.set('anthropic_api_key', settings.anthropic_api_key);
      setMessage('配置已保存');
      setTimeout(() => setMessage(''), 2000);
    } catch (error) {
      console.error('保存配置失败:', error);
      setMessage('保存配置失败');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>设置</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {loading ? (
          <div className="loading">加载中...</div>
        ) : (
          <div className="settings-form">
            <div className="form-group">
              <label>API 密钥 (Anthropic)</label>
              <input
                type="password"
                value={settings.anthropic_api_key}
                onChange={(e) => setSettings({ ...settings, anthropic_api_key: e.target.value })}
                placeholder="sk-ant-..."
              />
              <span className="hint">从 <a href="https://console.anthropic.com" target="_blank" rel="noopener">Anthropic 控制台</a> 获取密钥</span>
            </div>

            <div className="form-group">
              <label>默认模型</label>
              <select
                value={settings.default_model}
                onChange={(e) => setSettings({ ...settings, default_model: e.target.value })}
              >
                <option value="claude-opus-4-20250514">Claude Opus 4</option>
                <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                <option value="claude-haiku-3-20240307">Claude Haiku 3</option>
              </select>
            </div>

            <div className="form-group">
              <label>最大 Token 数: {settings.max_tokens}</label>
              <input
                type="range"
                min="1024"
                max="8192"
                step="512"
                value={settings.max_tokens}
                onChange={(e) => setSettings({ ...settings, max_tokens: parseInt(e.target.value) })}
              />
            </div>

            <div className="form-group">
              <label>温度: {settings.temperature}</label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={settings.temperature}
                onChange={(e) => setSettings({ ...settings, temperature: parseFloat(e.target.value) })}
              />
            </div>

            <div className="form-actions">
              {message && <span className="message">{message}</span>}
              <button className="save-btn" onClick={saveSettings} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SettingsPage;
