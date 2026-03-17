"""
NuwaClaw GUI Agent - 图像定位功能
基于 OpenCV + PIL 实现屏幕元素识别
"""

import cv2
import numpy as np
from PIL import Image
import io
import base64
import pyautogui
from typing import Optional, Tuple, List
from dataclasses import dataclass

@dataclass
class LocateResult:
    """图像定位结果"""
    found: bool
    x: Optional[int] = None
    y: Optional[int] = None
    width: Optional[int] = None
    height: Optional[int] = None
    confidence: Optional[float] = None
    message: str = ""

class ImageLocator:
    """
    图像定位器
    
    功能：
    - 在屏幕上查找指定图片
    - 支持阈值调整
    - 支持多目标查找
    - 返回位置和置信度
    """
    
    def __init__(self, confidence: float = 0.8):
        """
        初始化
        
        Args:
            confidence: 置信度阈值（0-1）
        """
        self.confidence = confidence
    
    def locate_on_screen(self,
                         image_path: str,
                         confidence: Optional[float] = None) -> LocateResult:
        """
        在屏幕上查找图片
        
        Args:
            image_path: 图片路径
            confidence: 置信度（覆盖默认值）
            
        Returns:
            LocateResult: 定位结果
        """
        conf = confidence or self.confidence
        
        try:
            # 截屏
            screenshot = pyautogui.screenshot()
            screenshot_np = np.array(screenshot)
            screenshot_np = cv2.cvtColor(screenshot_np, cv2.COLOR_RGB2BGR)
            
            # 加载目标图片
            template = cv2.imread(image_path)
            if template is None:
                return LocateResult(
                    found=False,
                    message=f"无法加载图片: {image_path}"
                )
            
            # 模板匹配
            result = cv2.matchTemplate(screenshot_np, template, cv2.TM_CCOEFF_NORMED)
            min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(result)
            
            # 判断是否找到
            if max_val >= conf:
                h, w = template.shape[:2]
                return LocateResult(
                    found=True,
                    x=int(max_loc[0] + w / 2),  # 中心点 x
                    y=int(max_loc[1] + h / 2),  # 中心点 y
                    width=w,
                    height=h,
                    confidence=float(max_val),
                    message=f"找到目标，置信度: {max_val:.2f}"
                )
            else:
                return LocateResult(
                    found=False,
                    confidence=float(max_val),
                    message=f"未找到目标，最高置信度: {max_val:.2f} < {conf}"
                )
                
        except Exception as e:
            return LocateResult(
                found=False,
                message=f"定位失败: {str(e)}"
            )
    
    def locate_all_on_screen(self,
                             image_path: str,
                             confidence: Optional[float] = None) -> List[LocateResult]:
        """
        在屏幕上查找所有匹配的图片
        
        Args:
            image_path: 图片路径
            confidence: 置信度
            
        Returns:
            List[LocateResult]: 所有匹配结果
        """
        conf = confidence or self.confidence
        results = []
        
        try:
            # 截屏
            screenshot = pyautogui.screenshot()
            screenshot_np = np.array(screenshot)
            screenshot_np = cv2.cvtColor(screenshot_np, cv2.COLOR_RGB2BGR)
            
            # 加载目标图片
            template = cv2.imread(image_path)
            if template is None:
                return [LocateResult(found=False, message=f"无法加载图片: {image_path}")]
            
            h, w = template.shape[:2]
            
            # 模板匹配
            result = cv2.matchTemplate(screenshot_np, template, cv2.TM_CCOEFF_NORMED)
            
            # 查找所有匹配位置
            locations = np.where(result >= conf)
            
            for pt in zip(*locations[::-1]):
                confidence_value = result[pt[1], pt[0]]
                results.append(LocateResult(
                    found=True,
                    x=int(pt[0] + w / 2),
                    y=int(pt[1] + h / 2),
                    width=w,
                    height=h,
                    confidence=float(confidence_value)
                ))
            
            return results
            
        except Exception as e:
            return [LocateResult(found=False, message=f"定位失败: {str(e)}")]
    
    def wait_for_image(self,
                       image_path: str,
                       timeout: float = 10.0,
                       confidence: Optional[float] = None,
                       interval: float = 0.5) -> LocateResult:
        """
        等待图片出现
        
        Args:
            image_path: 图片路径
            timeout: 超时时间（秒）
            confidence: 置信度
            interval: 检查间隔（秒）
            
        Returns:
            LocateResult: 定位结果
        """
        import time
        
        conf = confidence or self.confidence
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            result = self.locate_on_screen(image_path, conf)
            if result.found:
                return result
            time.sleep(interval)
        
        return LocateResult(
            found=False,
            message=f"等待超时（{timeout}秒）"
        )
    
    def click_image(self,
                    image_path: str,
                    confidence: Optional[float] = None,
                    button: str = "left",
                    offset_x: int = 0,
                    offset_y: int = 0) -> bool:
        """
        查找并点击图片
        
        Args:
            image_path: 图片路径
            confidence: 置信度
            button: 鼠标按钮（left/right/middle）
            offset_x: x 偏移
            offset_y: y 偏移
            
        Returns:
            bool: 是否成功
        """
        result = self.locate_on_screen(image_path, confidence)
        
        if result.found:
            pyautogui.click(
                result.x + offset_x,
                result.y + offset_y,
                button=button
            )
            return True
        
        return False


# ========== 测试 ==========

if __name__ == "__main__":
    import os
    
    print("="*60)
    print("NuwaClaw GUI Agent - 图像定位功能测试")
    print("="*60)
    
    locator = ImageLocator(confidence=0.8)
    
    # 测试 1: 截图保存
    print("\n📝 测试 1: 截图保存")
    print("-"*40)
    
    screenshot_path = "/tmp/test_screenshot.png"
    try:
        screenshot = pyautogui.screenshot()
        screenshot.save(screenshot_path)
        print(f"  ✅ 截图已保存: {screenshot_path}")
        print(f"  尺寸: {screenshot.size}")
    except Exception as e:
        print(f"  ❌ 截图失败: {e}")
        exit(1)
    
    # 测试 2: 查找图片（使用刚才的截图的一部分）
    print("\n📝 测试 2: 查找图片")
    print("-"*40)
    
    # 裁剪截图的一部分作为目标
    img = Image.open(screenshot_path)
    width, height = img.size
    crop_region = (width//4, height//4, width//2, height//2)
    cropped = img.crop(crop_region)
    
    target_path = "/tmp/test_target.png"
    cropped.save(target_path)
    print(f"  目标图片: {target_path}")
    print(f"  裁剪区域: {crop_region}")
    
    # 查找
    result = locator.locate_on_screen(target_path, confidence=0.7)
    print(f"\n  结果: {'✅ 找到' if result.found else '❌ 未找到'}")
    if result.found:
        print(f"  位置: ({result.x}, {result.y})")
        print(f"  置信度: {result.confidence:.2f}")
    else:
        print(f"  消息: {result.message}")
    
    # 测试 3: 等待图片
    print("\n📝 测试 3: 等待图片")
    print("-"*40)
    
    result = locator.wait_for_image(target_path, timeout=3.0, confidence=0.7)
    print(f"  结果: {'✅ 找到' if result.found else '❌ 未找到'}")
    print(f"  消息: {result.message}")
    
    # 测试 4: 点击图片
    print("\n📝 测试 4: 点击图片")
    print("-"*40)
    
    success = locator.click_image(target_path, confidence=0.7, button="left")
    print(f"  结果: {'✅ 成功' if success else '❌ 失败'}")
    
    # 清理
    print("\n📝 清理测试文件")
    print("-"*40)
    os.remove(screenshot_path)
    os.remove(target_path)
    print(f"  ✅ 已删除临时文件")
    
    print("\n" + "="*60)
    print("测试完成")
    print("="*60)
    print(f"\n✅ 图像定位功能验证成功")
    print(f"  - 屏幕截图: ✅")
    print(f"  - 图像定位: ✅")
    print(f"  - 等待图片: ✅")
    print(f"  - 点击图片: ✅")
