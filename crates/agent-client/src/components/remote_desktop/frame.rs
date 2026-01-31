//! 帧数据和视频画质定义

/// 帧数据 - 存储解码后的视频帧
#[derive(Clone)]
pub struct FrameData {
    /// RGBA 像素数据
    pub pixels: Vec<u8>,
    /// 宽度
    pub width: u32,
    /// 高度
    pub height: u32,
    /// 帧序号
    pub frame_number: u64,
}

impl FrameData {
    /// 创建空帧
    pub fn empty(width: u32, height: u32) -> Self {
        let size = (width * height * 4) as usize; // RGBA
        Self {
            pixels: vec![0; size],
            width,
            height,
            frame_number: 0,
        }
    }

    /// 从 RGB 数据创建（nuwax-rustdesk 解码输出）
    pub fn from_rgb(rgb_data: &[u8], width: u32, height: u32, frame_number: u64) -> Self {
        let pixel_count = (width * height) as usize;
        let mut pixels = Vec::with_capacity(pixel_count * 4);

        // 转换 RGB -> RGBA
        for i in 0..pixel_count {
            let idx = i * 3;
            if idx + 2 < rgb_data.len() {
                pixels.push(rgb_data[idx]); // R
                pixels.push(rgb_data[idx + 1]); // G
                pixels.push(rgb_data[idx + 2]); // B
                pixels.push(255); // A
            } else {
                pixels.extend_from_slice(&[0, 0, 0, 255]);
            }
        }

        Self {
            pixels,
            width,
            height,
            frame_number,
        }
    }
}

/// 视频画质设置
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum VideoQuality {
    /// 流畅模式 (低分辨率, 低帧率)
    Smooth,
    /// 标准模式 (中等分辨率, 中等帧率)
    #[default]
    Standard,
    /// 高清模式 (高分辨率, 高帧率)
    HD,
}

impl VideoQuality {
    /// 获取显示名称
    pub fn label(&self) -> &'static str {
        match self {
            Self::Smooth => "流畅",
            Self::Standard => "标准",
            Self::HD => "高清",
        }
    }

    /// 获取所有画质选项
    pub fn all() -> Vec<Self> {
        vec![Self::Smooth, Self::Standard, Self::HD]
    }

    /// 从索引创建
    pub fn from_index(index: usize) -> Self {
        match index {
            0 => Self::Smooth,
            1 => Self::Standard,
            _ => Self::HD,
        }
    }

    /// 转换为索引
    pub fn to_index(&self) -> usize {
        match self {
            Self::Smooth => 0,
            Self::Standard => 1,
            Self::HD => 2,
        }
    }
}
