/**
 * 场景切换组件
 */

import { useState, useEffect, useCallback } from "react";
import { Select, Typography } from "antd";
import { SwapOutlined } from "@ant-design/icons";
import {
  initConfigStore,
  getAllScenes,
  getCurrentScene,
  switchScene,
  SceneConfig,
} from "../services/config";

const { Text } = Typography;

interface SceneSwitcherProps {
  showLabel?: boolean;
  size?: "small" | "middle" | "large";
}

export default function SceneSwitcher({
  showLabel = true,
  size = "middle",
}: SceneSwitcherProps) {
  const [scenes, setScenes] = useState<SceneConfig[]>([]);
  const [currentSceneId, setCurrentSceneId] = useState<string>("");
  const [currentScene, setCurrentScene] = useState<SceneConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadScenes = async () => {
      try {
        await initConfigStore();
        const [scenesData, scene] = await Promise.all([
          getAllScenes(),
          getCurrentScene(),
        ]);
        setScenes(scenesData);
        setCurrentSceneId(scene.id);
        setCurrentScene(scene);
      } catch (error) {
        console.error("加载场景失败:", error);
      } finally {
        setLoading(false);
      }
    };
    loadScenes();
  }, []);

  const handleChange = useCallback(
    async (value: string) => {
      const success = await switchScene(value);
      if (success) {
        const scene = scenes.find((s) => s.id === value);
        if (scene) {
          setCurrentSceneId(value);
          setCurrentScene(scene);
        }
      }
    },
    [scenes],
  );

  if (loading || !currentScene) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Select
        value={currentSceneId}
        onChange={handleChange}
        options={scenes.map((s) => ({
          value: s.id,
          label: s.name,
        }))}
        style={{ width: 160 }}
        size={size}
        suffixIcon={<SwapOutlined />}
      />
      <Text style={{ fontSize: 11, color: "#a1a1aa" }}>
        {currentScene.server.apiUrl
          .replace("https://", "")
          .replace("http://", "")}
      </Text>
    </div>
  );
}
