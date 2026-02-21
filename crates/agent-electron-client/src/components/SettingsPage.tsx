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
      console.error('Failed to load settings:', error);
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
      setMessage('Settings saved!');
      setTimeout(() => setMessage(''), 2000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      setMessage('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>⚙️ Settings</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {loading ? (
          <div className="loading">Loading...</div>
        ) : (
          <div className="settings-form">
            <div className="form-group">
              <label>API Key (Anthropic)</label>
              <input
                type="password"
                value={settings.anthropic_api_key}
                onChange={(e) => setSettings({ ...settings, anthropic_api_key: e.target.value })}
                placeholder="sk-ant-..."
              />
              <span className="hint">Get your API key from <a href="https://console.anthropic.com" target="_blank" rel="noopener">Anthropic Console</a></span>
            </div>

            <div className="form-group">
              <label>Default Model</label>
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
              <label>Max Tokens: {settings.max_tokens}</label>
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
              <label>Temperature: {settings.temperature}</label>
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
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SettingsPage;
