"""
NuwaClaw GUI Agent - 跨平台支持
支持 macOS / Windows / Linux
"""

import sys
import platform
from enum import Enum
from typing import Dict, List, Optional

class Platform(Enum):
    """平台类型"""
    MACOS = "darwin"
    WINDOWS = "win32"
    LINUX = "linux"

class PlatformManager:
    """跨平台管理器"""
    
    def __init__(self):
        self.current_platform = self._detect_platform()
        self.hotkey_maps = self._get_hotkey_maps()
    
    def _detect_platform(self) -> Platform:
        """检测当前平台"""
        if sys.platform == 'darwin':
            return Platform.MACOS
        elif sys.platform == 'win32':
            return Platform.WINDOWS
        else:
            return Platform.LINUX
    
    def _get_hotkey_maps(self) -> Dict[Platform, Dict[str, List[str]]]:
        """获取平台特定的快捷键映射"""
        return {
            Platform.MACOS: {
                'copy': ['command', 'c'],
                'paste': ['command', 'v'],
                'cut': ['command', 'x'],
                'select_all': ['command', 'a'],
                'undo': ['command', 'z'],
                'redo': ['command', 'shift', 'z'],
                'find': ['command', 'f'],
                'save': ['command', 's'],
                'open': ['command', 'o'],
                'new': ['command', 'n'],
                'close': ['command', 'w'],
                'quit': ['command', 'q'],
                'spotlight': ['command', 'space'],
            },
            Platform.WINDOWS: {
                'copy': ['ctrl', 'c'],
                'paste': ['ctrl', 'v'],
                'cut': ['ctrl', 'x'],
                'select_all': ['ctrl', 'a'],
                'undo': ['ctrl', 'z'],
                'redo': ['ctrl', 'y'],
                'find': ['ctrl', 'f'],
                'save': ['ctrl', 's'],
                'open': ['ctrl', 'o'],
                'new': ['ctrl', 'n'],
                'close': ['alt', 'f4'],
                'quit': ['alt', 'f4'],
                'spotlight': ['win', 's'],
            },
            Platform.LINUX: {
                'copy': ['ctrl', 'c'],
                'paste': ['ctrl', 'v'],
                'cut': ['ctrl', 'x'],
                'select_all': ['ctrl', 'a'],
                'undo': ['ctrl', 'z'],
                'redo': ['ctrl', 'shift', 'z'],
                'find': ['ctrl', 'f'],
                'save': ['ctrl', 's'],
                'open': ['ctrl', 'o'],
                'new': ['ctrl', 'n'],
                'close': ['alt', 'f4'],
                'quit': ['alt', 'f4'],
                'spotlight': ['ctrl', 'space'],
            }
        }
    
    def get_hotkey(self, action: str) -> Optional[List[str]]:
        """获取平台特定的快捷键"""
        return self.hotkey_maps.get(self.current_platform, {}).get(action)
    
    def is_macos(self) -> bool:
        """是否是 macOS"""
        return self.current_platform == Platform.MACOS
    
    def is_windows(self) -> bool:
        """是否是 Windows"""
        return self.current_platform == Platform.WINDOWS
    
    def is_linux(self) -> bool:
        """是否是 Linux"""
        return self.current_platform == Platform.LINUX
    
    def get_platform_info(self) -> Dict[str, str]:
        """获取平台信息"""
        return {
            'platform': self.current_platform.value,
            'system': platform.system(),
            'release': platform.release(),
            'version': platform.version(),
            'machine': platform.machine(),
        }
    
    def get_screen_capture_method(self) -> str:
        """获取屏幕捕获方法"""
        if self.is_macos():
            return 'screencapture'
        elif self.is_windows():
            return 'win32api'
        else:
            return 'scrot'  # Linux
    
    def get_permission_requirements(self) -> Dict[str, bool]:
        """获取权限要求"""
        if self.is_macos():
            return {
                'screen_recording': True,
                'accessibility': True,
            }
        elif self.is_windows():
            return {
                'screen_recording': False,
                'accessibility': False,
            }
        else:  # Linux
            return {
                'screen_recording': False,
                'accessibility': False,
            }

# 全局实例
platform_manager = PlatformManager()

# ========== 便捷函数 ==========

def get_hotkey(action: str) -> Optional[List[str]]:
    """获取快捷键"""
    return platform_manager.get_hotkey(action)

def is_macos() -> bool:
    """是否是 macOS"""
    return platform_manager.is_macos()

def is_windows() -> bool:
    """是否是 Windows"""
    return platform_manager.is_windows()

def is_linux() -> bool:
    """是否是 Linux"""
    return platform_manager.is_linux()

def get_platform_info() -> Dict[str, str]:
    """获取平台信息"""
    return platform_manager.get_platform_info()

# ========== 测试 ==========

if __name__ == "__main__":
    print("="*60)
    print("NuwaClaw GUI Agent - 跨平台支持")
    print("="*60)
    
    print(f"\n📊 平台信息:")
    info = get_platform_info()
    for key, value in info.items():
        print(f"  {key}: {value}")
    
    print(f"\n🔧 权限要求:")
    perms = platform_manager.get_permission_requirements()
    for key, required in perms.items():
        status = "✅ 需要" if required else "❌ 不需要"
        print(f"  {key}: {status}")
    
    print(f"\n⌨️  快捷键映射:")
    actions = ['copy', 'paste', 'select_all', 'save']
    for action in actions:
        hotkey = get_hotkey(action)
        if hotkey:
            print(f"  {action}: {' + '.join(hotkey)}")
    
    print(f"\n📸 屏幕捕获方法: {platform_manager.get_screen_capture_method()}")
    
    print("\n" + "="*60)
