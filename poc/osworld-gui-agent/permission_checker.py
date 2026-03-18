"""
NuwaClaw GUI Agent - macOS 权限检查与引导
检测并引导用户授予必要权限
"""

import subprocess
import sys
from enum import Enum
from dataclasses import dataclass
from typing import List, Optional

class PermissionType(Enum):
    """权限类型"""
    SCREEN_RECORDING = "屏幕录制"
    ACCESSIBILITY = "辅助功能"
    CAMERA = "摄像头"
    MICROPHONE = "麦克风"

@dataclass
class PermissionStatus:
    """权限状态"""
    permission_type: PermissionType
    granted: bool
    message: str

class MacOSPermissionChecker:
    """
    macOS 权限检查器
    
    功能：
    - 检测权限状态
    - 提供授权引导
    - 生成帮助文档
    """
    
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
            # 尝试截图来检查权限
            from PIL import ImageGrab
            img = ImageGrab.grab(bbox=(0, 0, 1, 1))
            # 如果能截图，说明有权限
            return PermissionStatus(
                permission_type=PermissionType.SCREEN_RECORDING,
                granted=True,
                message="✅ 屏幕录制权限已授予"
            )
        except Exception as e:
            # 截图失败，可能没有权限
            return PermissionStatus(
                permission_type=PermissionType.SCREEN_RECORDING,
                granted=False,
                message="❌ 屏幕录制权限未授予（截图功能不可用）"
            )
    
    def check_accessibility(self) -> PermissionStatus:
        """检查辅助功能权限"""
        try:
            # 尝试使用 pyautogui 检查
            import pyautogui
            
            # 尝试移动鼠标（会触发辅助功能检查）
            current_pos = pyautogui.position()
            
            # 如果能获取位置，说明有权限
            return PermissionStatus(
                permission_type=PermissionType.ACCESSIBILITY,
                granted=True,
                message="✅ 辅助功能权限已授予"
            )
        except Exception as e:
            return PermissionStatus(
                permission_type=PermissionType.ACCESSIBILITY,
                granted=False,
                message="❌ 辅助功能权限未授予（鼠标键盘控制不可用）"
            )
    
    def print_status(self):
        """打印权限状态"""
        print("\n" + "="*60)
        print("macOS 权限检查")
        print("="*60)
        
        for perm in self.permissions:
            print(f"\n{perm.permission_type.value}:")
            print(f"  {perm.message}")
        
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
    1. 打开「系统设置」→「隐私与安全性」→「屏幕录制」
    2. 找到并勾选「Terminal」或「Python」
    3. 重启终端或应用
    4. 重新运行此程序
    """)
                
                elif perm.permission_type == PermissionType.ACCESSIBILITY:
                    print("""
    1. 打开「系统设置」→「隐私与安全性」→「辅助功能」
    2. 点击左下角的锁图标解锁
    3. 找到并勾选「Terminal」或「Python」
    4. 重启终端或应用
    5. 重新运行此程序
    """)
    
    def open_system_preferences(self, permission_type: PermissionType):
        """打开系统偏好设置的对应面板"""
        try:
            if permission_type == PermissionType.SCREEN_RECORDING:
                # 打开屏幕录制设置
                subprocess.run([
                    "open",
                    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
                ])
                print(f"\n✅ 已打开屏幕录制设置页面")
            
            elif permission_type == PermissionType.ACCESSIBILITY:
                # 打开辅助功能设置
                subprocess.run([
                    "open",
                    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
                ])
                print(f"\n✅ 已打开辅助功能设置页面")
        
        except Exception as e:
            print(f"\n❌ 无法打开系统设置: {e}")
            print(f"请手动打开「系统设置」→「隐私与安全性」")


# ========== 测试 ==========

if __name__ == "__main__":
    checker = MacOSPermissionChecker()
    
    # 检查所有权限
    permissions = checker.check_all()
    
    # 打印状态
    checker.print_status()
    
    # 如果有权限未授予，提供快速跳转
    ungranted = [p for p in permissions if not p.granted]
    
    if ungranted:
        print("\n" + "="*60)
        print("快速跳转到系统设置")
        print("="*60)
        
        for perm in ungranted:
            response = input(f"\n是否打开「{perm.permission_type.value}」设置页面？ (y/n): ")
            
            if response.lower() == 'y':
                checker.open_system_preferences(perm.permission_type)
        
        print("\n授权完成后，请重启终端并重新运行此程序")
    
    else:
        print("\n" + "="*60)
        print("权限检查完成")
        print("="*60)
        print("\n✅ 所有必要的权限已授予")
        print("✅ NuwaClaw GUI Agent 可以正常工作")
