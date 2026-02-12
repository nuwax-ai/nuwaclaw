import { useState, useEffect } from "react";
import { getName, getVersion } from "@tauri-apps/api/app";

interface AppInfo {
  appName: string;
  appVersion: string;
}

export function useAppInfo(): AppInfo {
  const [appName, setAppName] = useState("Nuwax Agent");
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    getName().then((n) => setAppName(n));
    getVersion().then((v) => setAppVersion(v));
  }, []);

  return { appName, appVersion };
}
