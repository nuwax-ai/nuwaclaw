//! 消息分片模块
//!
//! 支持大消息的分片传输和重组

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;
use tracing::debug;

/// 默认分片大小 (64KB)
pub const DEFAULT_CHUNK_SIZE: usize = 64 * 1024;

/// 最大消息大小 (100MB)
pub const MAX_MESSAGE_SIZE: usize = 100 * 1024 * 1024;

/// 分片错误
#[derive(Error, Debug)]
pub enum ChunkError {
    #[error("消息过大: {size} 字节，最大允许 {max} 字节")]
    MessageTooLarge { size: usize, max: usize },
    #[error("分片序号超出范围: {index}/{total}")]
    IndexOutOfRange { index: u32, total: u32 },
    #[error("分片不完整: 已收到 {received}/{total}")]
    IncompleteChunks { received: usize, total: u32 },
    #[error("消息 ID 不匹配")]
    MessageIdMismatch,
    #[error("重组失败: {0}")]
    ReassemblyFailed(String),
    #[error("序列化错误: {0}")]
    SerializationError(String),
}

/// 消息分片
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageChunk {
    /// 消息 ID（所有分片共享）
    pub message_id: String,
    /// 分片序号（从 0 开始）
    pub chunk_index: u32,
    /// 总分片数
    pub total_chunks: u32,
    /// 原始消息总大小
    pub total_size: usize,
    /// 分片数据
    pub data: Vec<u8>,
}

/// 消息分片器
pub struct MessageChunker {
    /// 分片大小
    chunk_size: usize,
    /// 最大消息大小
    max_size: usize,
}

impl Default for MessageChunker {
    fn default() -> Self {
        Self::new()
    }
}

impl MessageChunker {
    /// 创建新的分片器
    pub fn new() -> Self {
        Self {
            chunk_size: DEFAULT_CHUNK_SIZE,
            max_size: MAX_MESSAGE_SIZE,
        }
    }

    /// 设置分片大小
    pub fn with_chunk_size(mut self, size: usize) -> Self {
        self.chunk_size = size;
        self
    }

    /// 设置最大消息大小
    pub fn with_max_size(mut self, size: usize) -> Self {
        self.max_size = size;
        self
    }

    /// 是否需要分片
    pub fn needs_chunking(&self, data: &[u8]) -> bool {
        data.len() > self.chunk_size
    }

    /// 将数据分片
    pub fn chunk(&self, message_id: &str, data: &[u8]) -> Result<Vec<MessageChunk>, ChunkError> {
        if data.len() > self.max_size {
            return Err(ChunkError::MessageTooLarge {
                size: data.len(),
                max: self.max_size,
            });
        }

        let total_size = data.len();
        let total_chunks = total_size.div_ceil(self.chunk_size) as u32;

        debug!(
            "Chunking message {} ({} bytes) into {} chunks",
            message_id, total_size, total_chunks
        );
        let chunks: Vec<MessageChunk> = data
            .chunks(self.chunk_size)
            .enumerate()
            .map(|(index, chunk_data)| MessageChunk {
                message_id: message_id.to_string(),
                chunk_index: index as u32,
                total_chunks,
                total_size,
                data: chunk_data.to_vec(),
            })
            .collect();

        Ok(chunks)
    }
}

/// 消息重组器
pub struct MessageReassembler {
    /// 待重组的消息分片缓冲
    buffers: HashMap<String, ReassemblyBuffer>,
    /// 超时时间（秒）
    timeout_secs: u64,
}

/// 重组缓冲区
struct ReassemblyBuffer {
    /// 总分片数
    total_chunks: u32,
    /// 总大小
    total_size: usize,
    /// 已接收的分片
    chunks: HashMap<u32, Vec<u8>>,
    /// 创建时间
    created_at: std::time::Instant,
}

impl Default for MessageReassembler {
    fn default() -> Self {
        Self::new()
    }
}

impl MessageReassembler {
    /// 创建新的重组器
    pub fn new() -> Self {
        Self {
            buffers: HashMap::new(),
            timeout_secs: 60,
        }
    }

    /// 设置超时时间
    pub fn with_timeout(mut self, secs: u64) -> Self {
        self.timeout_secs = secs;
        self
    }

    /// 添加分片，如果所有分片都收到则返回完整消息
    pub fn add_chunk(&mut self, chunk: MessageChunk) -> Result<Option<Vec<u8>>, ChunkError> {
        if chunk.chunk_index >= chunk.total_chunks {
            return Err(ChunkError::IndexOutOfRange {
                index: chunk.chunk_index,
                total: chunk.total_chunks,
            });
        }

        // 清理超时的缓冲区
        self.cleanup_expired();

        let buffer = self
            .buffers
            .entry(chunk.message_id.clone())
            .or_insert_with(|| ReassemblyBuffer {
                total_chunks: chunk.total_chunks,
                total_size: chunk.total_size,
                chunks: HashMap::new(),
                created_at: std::time::Instant::now(),
            });

        // 验证一致性
        if buffer.total_chunks != chunk.total_chunks {
            return Err(ChunkError::MessageIdMismatch);
        }

        // 存储分片
        buffer.chunks.insert(chunk.chunk_index, chunk.data);

        debug!(
            "Received chunk {}/{} for message {}",
            buffer.chunks.len(),
            buffer.total_chunks,
            chunk.message_id
        );

        // 检查是否收到所有分片
        if buffer.chunks.len() as u32 == buffer.total_chunks {
            // 重组
            let total_chunks = buffer.total_chunks;
            let mut result = Vec::with_capacity(buffer.total_size);

            for i in 0..total_chunks {
                let data = buffer
                    .chunks
                    .remove(&i)
                    .ok_or_else(|| ChunkError::ReassemblyFailed(format!("Missing chunk {}", i)))?;
                result.extend_from_slice(&data);
            }

            // 清理缓冲区
            self.buffers.remove(&chunk.message_id);

            debug!("Reassembled message: {} bytes", result.len());
            Ok(Some(result))
        } else {
            Ok(None)
        }
    }

    /// 获取等待中的消息数量
    pub fn pending_count(&self) -> usize {
        self.buffers.len()
    }

    /// 清理超时的缓冲区
    fn cleanup_expired(&mut self) {
        let timeout = std::time::Duration::from_secs(self.timeout_secs);
        self.buffers
            .retain(|_, buffer| buffer.created_at.elapsed() < timeout);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_no_chunking_needed() {
        let chunker = MessageChunker::new();
        let data = vec![0u8; 1000]; // Small data
        assert!(!chunker.needs_chunking(&data));
    }

    #[test]
    fn test_chunking_needed() {
        let chunker = MessageChunker::new().with_chunk_size(100);
        let data = vec![0u8; 500];
        assert!(chunker.needs_chunking(&data));
    }

    #[test]
    fn test_chunk_and_reassemble() {
        let chunker = MessageChunker::new().with_chunk_size(100);
        let data: Vec<u8> = (0..250).map(|i| (i % 256) as u8).collect();

        // 分片
        let chunks = chunker.chunk("test-msg-1", &data).unwrap();
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].chunk_index, 0);
        assert_eq!(chunks[1].chunk_index, 1);
        assert_eq!(chunks[2].chunk_index, 2);
        assert_eq!(chunks[0].total_chunks, 3);

        // 重组
        let mut reassembler = MessageReassembler::new();

        assert!(reassembler.add_chunk(chunks[0].clone()).unwrap().is_none());
        assert!(reassembler.add_chunk(chunks[2].clone()).unwrap().is_none()); // 乱序
        let result = reassembler.add_chunk(chunks[1].clone()).unwrap();

        assert!(result.is_some());
        assert_eq!(result.unwrap(), data);
        assert_eq!(reassembler.pending_count(), 0);
    }

    #[test]
    fn test_single_chunk() {
        let chunker = MessageChunker::new().with_chunk_size(1000);
        let data = vec![42u8; 100];

        let chunks = chunker.chunk("single", &data).unwrap();
        assert_eq!(chunks.len(), 1);

        let mut reassembler = MessageReassembler::new();
        let result = reassembler.add_chunk(chunks[0].clone()).unwrap();
        assert_eq!(result.unwrap(), data);
    }

    #[test]
    fn test_message_too_large() {
        let chunker = MessageChunker::new().with_max_size(100);
        let data = vec![0u8; 200];

        let result = chunker.chunk("too-large", &data);
        assert!(matches!(result, Err(ChunkError::MessageTooLarge { .. })));
    }

    #[test]
    fn test_invalid_chunk_index() {
        let mut reassembler = MessageReassembler::new();
        let chunk = MessageChunk {
            message_id: "bad".to_string(),
            chunk_index: 5,
            total_chunks: 3,
            total_size: 100,
            data: vec![],
        };

        let result = reassembler.add_chunk(chunk);
        assert!(matches!(result, Err(ChunkError::IndexOutOfRange { .. })));
    }
}
