import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  FilePreviewDescriptor,
  WorkbenchApiAdapter,
  WorkbenchConversationFile,
  WorkbenchHostBridge,
} from '../../../types';
import { FilePreview } from '../../business-component/FilePreview';
import { Icon } from '../icons';

interface Props {
  adapter: WorkbenchApiAdapter;
  hostBridge?: WorkbenchHostBridge;
  conversationId: string;
  selectedFileId?: string;
  onClose: () => void;
}

export function ConversationFilesPanel({ adapter, hostBridge, conversationId, selectedFileId, onClose }: Props) {
  const [files, setFiles] = useState<WorkbenchConversationFile[]>([]);
  const [selected, setSelected] = useState<string | undefined>(selectedFileId);
  const [descriptor, setDescriptor] = useState<FilePreviewDescriptor | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!adapter.listConversationFiles) return;
    setLoading(true);
    setError(null);
    try {
      setFiles(await adapter.listConversationFiles(conversationId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '文件列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [adapter, conversationId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openFile = useCallback(async (file: WorkbenchConversationFile | string) => {
    const id = typeof file === 'string' ? file : file.id;
    const source = typeof file === 'string' ? files.find((item) => item.id === file) : file;
    if (source?.isDirectory) return;
    setSelected(id);
    setError(null);
    try {
      const hostDescriptor = await hostBridge?.onFilePreview?.(id, { conversationId });
      if (hostDescriptor) {
        setDescriptor(hostDescriptor);
        return;
      }
      if (source?.previewUrl || source?.content !== undefined) {
        setDescriptor({
          src: source.previewUrl ?? '',
          fileName: source.name.split('/').pop() || source.name,
          content: source.content,
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '文件预览失败');
    }
  }, [conversationId, files, hostBridge]);

  useEffect(() => {
    if (selectedFileId) void openFile(selectedFileId);
  }, [selectedFileId, openFile]);

  const ordered = useMemo(() => [...files].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  }), [files]);

  if (descriptor) {
    return (
      <div className="open-app-files-preview">
        <div className="open-app-files-preview-actions">
          <button type="button" className="open-app-files-back" onClick={() => setDescriptor(null)}>‹ 文件列表</button>
          {descriptor.src && (
            <button type="button" onClick={() => hostBridge?.onPreviewDownload?.({ url: descriptor.src, filename: descriptor.fileName })}>下载</button>
          )}
        </div>
        <FilePreview {...descriptor} onClose={onClose} />
      </div>
    );
  }

  return (
    <section className="open-app-files-panel">
      <header>
        <strong><Icon name="folder" /> 文件</strong>
        <span>
          <button type="button" title="刷新" onClick={() => void refresh()}><Icon name="reload" /></button>
          <button type="button" title="关闭" onClick={onClose}><Icon name="close" /></button>
        </span>
      </header>
      {error && <div className="open-app-panel-error">{error}</div>}
      {loading ? <div className="open-app-panel-empty">正在加载文件…</div> : ordered.length === 0 ? (
        <div className="open-app-panel-empty">当前会话暂无文件</div>
      ) : (
        <div className="open-app-file-tree">
          {ordered.map((file) => (
            <button
              key={file.id}
              type="button"
              className={selected === file.id ? 'active' : undefined}
              style={{ paddingLeft: `${14 + Math.max(0, file.name.split('/').length - 1) * 14}px` }}
              onClick={() => void openFile(file)}
            >
              <Icon name={file.isDirectory ? 'folder' : 'page'} />
              <span>{file.name.split('/').pop()}</span>
              {file.sizeExceeded && <em>文件过大</em>}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
