"""
NuwaClaw GUI Agent - 跨平台权限检查
支持 macOS / Windows / Linux
"""

import sys
import platform
from enum import Enum
from dataclasses import dataclass
from typing import List, Optional, Dict

class Platform(Enum):
    """平台类型"""
    MACOS = "darwin"
    WINDOWS = "win32"
    LINUX = "linux"

@dataclass
class PermissionStatus:
    """权限状态"""
    permission_type: str
    granted: bool
    message: str

class CrossPlatformPermissionChecker:
    """跨平台权限检查器"""
    
    def __init__(self):
        self.permissions: List[PermissionStatus] = []
        self.platform = self._detect_platform()
    
    def _detect_platform(self) -> Platform:
        """检测当前平台"""
        if sys.platform == 'darwin':
            return Platform.MACOS
        elif sys.platform == 'win32':
            return Platform.WINDOWS
        else:
            return Platform.LINUX
    
    def check_all(self) -> List[PermissionStatus]:
        """检查所有必要权限"""
        if self.platform == Platform.MACOS:
            self.permissions = [
                self._check_screen_recording_macos(),
                self._check_accessibility_macos(),
            ]
        else:
            # Windows/Linux 无需特殊权限
            self.permissions = [
                PermissionStatus(
                    permission_type="screen_control",
                    granted=True,
                    message=f"✅ {platform.system()} 无需特殊权限"
                )
            ]
        
        return self.permissions
    
    def _check_screen_recording_macos(self) -> PermissionStatus:
        """检查屏幕录制权限（仅 macOS）"""
        try:
            from PIL import ImageGrab
            img = ImageGrab.grab(bbox=(0, 0, 1, 1))
            return PermissionStatus(
                permission_type="screen_recording",
                granted=True,
                message="✅ 屏幕录制权限已授予"
            )
        except Exception:
            return PermissionStatus(
                permission_type="screen_recording",
                granted=False,
                message="❌ 屏幕录制权限未授予"
            )
    
    def _check_accessibility_macos(self) -> PermissionStatus:
        """检查辅助功能权限（仅 macOS）"""
        try:
            import pyautogui
            pos = pyautogui.position()
            return PermissionStatus(
                permission_type="accessibility",
                granted=True,
                message="✅ 辅助功能权限已授予"
            )
        except Exception:
            return PermissionStatus(
                permission_type="accessibility",
                granted=False,
                message="❌ 辅助功能权限未授予"
            )
    
    def print_status(self):
        """打印权限状态"""
        print("\n" + "="*60)
        print(f"{platform.system()} 权限检查报告")
        print("="*60)
        
        for perm in self.permissions:
            print(f"\n{perm.message}")
        
        granted_count = sum(1 for p in self.permissions if p.granted)
        total_count = len(self.permissions)
        
        print("\n" + "-"*60)
        print(f"权限授予情况: {granted_count}/{total_count}")
        
        if granted_count == total_count:
            print("\n✅ 所有权限已授予，GUI Agent 可以正常工作")
        else:
            print("\n⚠️  部分权限未授予，部分功能可能受限")
            if self.platform == Platform.MACOS:
                self._print_macos_guide()
    
    def _print_macos_guide(self):
        """打印 macOS 授权引导"""
        print("\n" + "="*60)
        print("授权引导（macOS）")
        print("="*60)
        
        for perm in self.permissions:
            if not perm.granted:
                if perm.permission_type == "screen_recording":
                    print("""
📋 屏幕录制权限授权：
    1. 系统设置 → 隐私与安全性 → 屏幕录制
    2. 勾选「Terminal」或「Python」
    3. 重启终端
""")
                elif perm.permission_type == "accessibility":
                    print("""
📋 辅助功能权限授权：
    1. 系统设置 → 隐私与安全性 → 辅助功能
    2. 点击锁图标解锁
    3. 勾选「Terminal」或「Python」
    4. 重启终端
""")

if __name__ == "__main__":
    checker = CrossPlatformPermissionChecker()
    checker.check_all()
    checker.print_status()
