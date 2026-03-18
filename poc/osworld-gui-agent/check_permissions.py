"""
NuwaClaw GUI Agent - macOS 权限检查（自动化版）
自动检测权限并生成报告
"""

import subprocess
import sys
from enum import Enum
from dataclasses import dataclass
from typing import List

class PermissionType(Enum):
    """权限类型"""
    SCREEN_RECORDING = "屏幕录制"
    ACCESSIBILITY = "辅助功能"

@dataclass
class PermissionStatus:
    """权限状态"""
    permission_type: PermissionType
    granted: bool
    message: str

class MacOSPermissionChecker:
    """macOS 权限检查器"""
    
    def __init__(self):
        self.permissions: List[PermissionStatus] = []
    
    def check_all(self) -> List[PermissionStatus]:
        """检查所有必要权限"""
        self.permissions = [
            self.check_screen_recording(),
            self.check_accessibility(),
        ]
        return self.permissions
    
    def check_screen_recording(self) -> PermissionStatus:
        """检查屏幕录制权限"""
        try:
            from PIL import ImageGrab
            img = ImageGrab.grab(bbox=(0, 0, 1, 1))
            return PermissionStatus(
                permission_type=PermissionType.SCREEN_RECORDING,
                granted=True,
                message="✅ 屏幕录制权限已授予"
            )
        except Exception as e:
            return PermissionStatus(
                permission_type=PermissionType.SCREEN_RECORDING,
                granted=False,
                message="❌ 屏幕录制权限未授予"
            )
    
    def check_accessibility(self) -> PermissionStatus:
        """检查辅助功能权限"""
        try:
            import pyautogui
            current_pos = pyautogui.position()
            return PermissionStatus(
                permission_type=PermissionType.ACCESSIBILITY,
                granted=True,
                message="✅ 辅助功能权限已授予"
            )
        except Exception as e:
            return PermissionStatus(
                permission_type=PermissionType.ACCESSIBILITY,
                granted=False,
                message="❌ 辅助功能权限未授予"
            )
    
    def print_status(self):
        """打印权限状态"""
        print("\n" + "="*60)
        print("macOS 权限检查报告")
        print("="*60)
        
        for perm in self.permissions:
            status = "✅" if perm.granted else "❌"
            print(f"\n{status} {perm.permission_type.value}:")
            print(f"   {perm.message}")
        
        # 统计
        granted_count = sum(1 for p in self.permissions if p.granted)
        total_count = len(self.permissions)
        
        print("\n" + "-"*60)
        print(f"权限授予情况: {granted_count}/{total_count}")
        
        if granted_count == total_count:
            print("\n✅ 所有权限已授予，GUI Agent 可以正常工作")
        else:
            print("\n⚠️  部分权限未授予，部分功能可能受限")
            self.print_guide()
    
    def print_guide(self):
        """打印授权引导"""
        print("\n" + "="*60)
        print("授权引导")
        print("="*60)
        
        for perm in self.permissions:
            if not perm.granted:
                print(f"\n📋 {perm.permission_type.value}权限授权步骤：")
                
                if perm.permission_type == PermissionType.SCREEN_RECORDING:
                    print("""
    方法 1: 系统设置
    1. 打开「系统设置」→「隐私与安全性」→「屏幕录制」
    2. 找到并勾选「Terminal」或「Python」
    3. 重启终端
    
    方法 2: 命令行（推荐）
    ```bash
    # 打开屏幕录制设置
    open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
    ```
    """)
                
                elif perm.permission_type == PermissionType.ACCESSIBILITY:
                    print("""
    方法 1: 系统设置
    1. 打开「系统设置」→「隐私与安全性」→「辅助功能」
    2. 点击左下角的锁图标解锁
    3. 找到并勾选「Terminal」或「Python」
    4. 重启终端
    
    方法 2: 命令行（推荐）
    ```bash
    # 打开辅助功能设置
    open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    ```
    """)
    
    def get_missing_permissions(self) -> List[PermissionType]:
        """获取缺失的权限列表"""
        return [p.permission_type for p in self.permissions if not p.granted]


if __name__ == "__main__":
    checker = MacOSPermissionChecker()
    
    # 检查所有权限
    permissions = checker.check_all()
    
    # 打印状态
    checker.print_status()
    
    # 列出缺失的权限
    missing = checker.get_missing_permissions()
    
    if missing:
        print("\n" + "="*60)
        print("缺失的权限")
        print("="*60)
        print(f"\n需要授权的权限: {', '.join([p.value for p in missing])}")
        print("\n授权后请重启终端并重新运行此程序进行验证")
    
    else:
        print("\n" + "="*60)
        print("权限检查完成")
        print("="*60)
        print("\n✅ 所有必要的权限已授予")
        print("✅ NuwaClaw GUI Agent 可以正常工作")
