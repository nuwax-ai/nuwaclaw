import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './FilePreview.css';
import {
  type FileType,
  getFileTypeFromName,
  getExtension,
  getFileTypeIcon,
} from './fileTypes';

// ── Types ──────────────────────────────────────────────────────────

export interface FilePreviewProps {
  src?: string;
  content?: string;
  fileType?: FileType;
  fileName?: string;
  staticFileBasePath?: string;
  onClose?: () => void;
  className?: string;
}

type PreviewStatus = 'idle' | 'loading' | 'success' | 'error' | 'unsupported';

// ── Helpers ────────────────────────────────────────────────────────

const SANDBOX = [
  'allow-scripts',
  'allow-same-origin',
  'allow-popups',
  'allow-forms',
].join(' ');

function getErrorMessage(error: string | undefined, fileType?: string): string {
  const s = error?.toLowerCase() || '';
  if (s.includes('central directory') || s.includes('zip file') || s.includes('jszip'))
    return 'File format is not supported or the file is corrupted.';
  if (s.includes('network') || s.includes('fetch') || s.includes('failed to fetch'))
    return 'Network request failed. Please check your connection and retry.';
  if (s.includes('load') || s.includes('loading'))
    return 'Failed to load the file.';
  if (s.includes('parse') || s.includes('parsing'))
    return 'File parsing failed. The file may be corrupted.';

  switch (fileType) {
    case 'docx': return 'Failed to preview Word document.';
    case 'xlsx': return 'Failed to preview Excel spreadsheet.';
    case 'pdf':  return 'Failed to preview PDF.';
    case 'pptx': return 'Failed to preview PowerPoint.';
    case 'image': return 'Failed to load image.';
    default:     return 'Preview failed.';
  }
}

// ── Component ──────────────────────────────────────────────────────

export function FilePreview({
  src,
  content: propsContent,
  fileType,
  fileName,
  staticFileBasePath,
  onClose,
  className,
}: FilePreviewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const previewerRef = useRef<unknown>(null);

  const [status, setStatus] = useState<PreviewStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [detectedType, setDetectedType] = useState<FileType | undefined>();
  const [textContent, setTextContent] = useState('');
  const [htmlUrl, setHtmlUrl] = useState<string | null>(null);

  const resolvedType = fileType || detectedType;

  // ── Normalize image sources in markdown ────────────────────────

  const normalizeImageSrc = useCallback(
    (imgSrc: string) => {
      if (!imgSrc || !staticFileBasePath) return imgSrc;
      if (imgSrc.startsWith('http') || imgSrc.startsWith('data:')) return imgSrc;
      if (imgSrc.startsWith('/')) {
        if (imgSrc.startsWith('/api/computer/static/')) return imgSrc;
        return `${staticFileBasePath}${imgSrc}`;
      }
      const normalized = imgSrc.replace(/^\.\//, '').replace(/^\.\.\//, '').replace(/\/\.\//g, '/');
      return `${staticFileBasePath}/${normalized}`;
    },
    [staticFileBasePath],
  );

  const processedMarkdown = useMemo(() => {
    if (!textContent) return textContent;
    return textContent.replace(
      /(!\[[^\]]*\]\()([^)\s]+)(\))/g,
      (_match, prefix: string, url: string, suffix: string) =>
        `${prefix}${normalizeImageSrc(url)}${suffix}`,
    );
  }, [textContent, normalizeImageSrc]);

  // ── Preview initialisation ─────────────────────────────────────

  const initPreview = useCallback(async () => {
    if (!containerRef.current || (!src && !propsContent)) return;
    if (!src && propsContent) {
      // Inline content only — detect type from fileName
      const type = fileType || (fileName ? getFileTypeFromName(fileName) : 'text');
      setDetectedType(type);
      if (type === 'unsupported') { setStatus('unsupported'); return; }
      setTextContent(propsContent);
      setStatus('success');
      return;
    }
    if (!src) return;

    // Detect file type
    let type: FileType = fileType || 'unsupported';
    if (!fileType && typeof src === 'string') {
      type = getFileTypeFromName(src);
    }
    setDetectedType(type);
    if (type === 'unsupported') { setStatus('unsupported'); return; }

    // Native browser types — instant success
    if (type === 'image' || type === 'audio' || type === 'video') {
      setStatus('success');
      return;
    }

    // Text-based types
    if (type === 'markdown' || type === 'text') {
      if (propsContent) {
        setTextContent(propsContent);
        setStatus('success');
        return;
      }
      setStatus('loading');
      try {
        const response = await fetch(src);
        const text = await response.text();
        setTextContent(text);
        setStatus('success');
      } catch (err: unknown) {
        setStatus('error');
        setErrorMessage(getErrorMessage(err instanceof Error ? err.message : undefined, type));
      }
      return;
    }

    // HTML
    if (type === 'html') {
      if (propsContent) {
        setHtmlUrl(null);
        setTextContent(propsContent);
        setStatus('success');
        return;
      }
      setHtmlUrl(src);
      setTextContent('');
      setStatus('success');
      return;
    }

    // ── Office document types (lazy-loaded) ───────────────────────

    setStatus('loading');
    setErrorMessage('');

    if (previewerRef.current) {
      try { (previewerRef.current as { destroy?: () => void }).destroy?.(); } catch { /* ignore */ }
      previewerRef.current = null;
    }
    containerRef.current.innerHTML = '';

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let previewer: any;
      let previewSrc: string | ArrayBuffer = src;

      switch (type) {
        case 'docx': {
          const { default: jsPreviewDocx } = await import('@js-preview/docx');
          await import('@js-preview/docx/lib/index.css');
          previewer = jsPreviewDocx.init(containerRef.current);
          await previewer.preview(previewSrc);
          break;
        }
        case 'xlsx': {
          const { default: jsPreviewExcel } = await import('@js-preview/excel');
          await import('@js-preview/excel/lib/index.css');
          previewer = jsPreviewExcel.init(containerRef.current);
          await previewer.preview(previewSrc);
          break;
        }
        case 'pdf': {
          const { default: jsPreviewPdf } = await import('@js-preview/pdf');
          previewer = jsPreviewPdf.init(containerRef.current, {
            width: containerRef.current.clientWidth || undefined,
            onError: (e: unknown) => {
              setStatus('error');
              setErrorMessage(getErrorMessage(e instanceof Error ? e.message : undefined, 'pdf'));
            },
            onRendered: () => { setStatus('success'); },
          });
          await previewer.preview(previewSrc);
          break;
        }
        case 'pptx': {
          const { init: pptxInit } = await import('pptx-preview');
          const parentEl = containerRef.current.parentElement;
          const w = containerRef.current.clientWidth || parentEl?.clientWidth || 800;
          const h = containerRef.current.clientHeight || parentEl?.clientHeight || 600;
          previewer = pptxInit(containerRef.current, { width: w, height: h });
          if (typeof previewSrc === 'string') {
            const response = await fetch(previewSrc);
            previewSrc = await response.arrayBuffer();
          }
          await previewer.preview(previewSrc);
          break;
        }
        default:
          setStatus('unsupported');
          return;
      }

      previewerRef.current = previewer;
      if (type !== 'pdf') setStatus('success');
    } catch (err: unknown) {
      setStatus('error');
      setErrorMessage(getErrorMessage(err instanceof Error ? err.message : undefined, type));
    }
  }, [src, propsContent, fileType, fileName]);

  // Re-init when inputs change
  useEffect(() => {
    if (src || propsContent) {
      initPreview();
    } else {
      setStatus('idle');
    }
    return () => {
      if (previewerRef.current) {
        try { (previewerRef.current as { destroy?: () => void }).destroy?.(); } catch { /* ignore */ }
        previewerRef.current = null;
      }
    };
  }, [src, propsContent, fileType, initPreview]);

  // ResizeObserver for office docs
  const lastSizeRef = useRef<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const last = lastSizeRef.current;
      if (last && Math.abs(last.width - width) < 10 && Math.abs(last.height - height) < 10) return;
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (status === 'success' && resolvedType && ['pptx', 'xlsx', 'pdf', 'docx'].includes(resolvedType)) {
          lastSizeRef.current = { width, height };
          initPreview();
        }
      }, 500);
    });
    const parentEl = containerRef.current.parentElement;
    if (parentEl) {
      lastSizeRef.current = { width: parentEl.clientWidth, height: parentEl.clientHeight };
      observer.observe(parentEl);
    }
    return () => {
      if (timeout) clearTimeout(timeout);
      observer.disconnect();
    };
  }, [status, resolvedType, initPreview]);

  // ── Derived display name ───────────────────────────────────────

  const displayName = useMemo(() => {
    if (fileName) return fileName;
    if (typeof src === 'string') {
      const parts = src.split('/');
      return parts[parts.length - 1].split('?')[0] || 'file';
    }
    return 'file';
  }, [fileName, src]);

  const needsScroll = resolvedType ? ['docx', 'pdf', 'pptx'].includes(resolvedType) : false;
  const isDocType = resolvedType ? ['docx', 'xlsx', 'pdf', 'pptx'].includes(resolvedType) : false;

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className={`file-preview-root${needsScroll ? ' file-preview-scrollable' : ''}${className ? ` ${className}` : ''}`}>
      {/* Header */}
      <div className="file-preview-header">
        <span className="file-preview-header-icon">{resolvedType ? getFileTypeIcon(resolvedType) : '\u{1F4C4}'}</span>
        <span className="file-preview-header-name" title={displayName}>{displayName}</span>
        {onClose && (
          <button type="button" className="file-preview-close" onClick={onClose} title="Close preview">
            &times;
          </button>
        )}
      </div>

      {/* Body */}
      <div className="file-preview-body">
        {/* Loading */}
        {status === 'loading' && (
          <div className="file-preview-loading">
            <span className="file-preview-loading-icon">{resolvedType ? getFileTypeIcon(resolvedType) : '\u{1F4C4}'}</span>
            <div className="file-preview-spinner" />
            <span>Loading preview...</span>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="file-preview-error">
            <span className="file-preview-error-icon">{'\u{26A0}'}</span>
            <span className="file-preview-error-msg">{errorMessage || 'Preview failed.'}</span>
            <button type="button" className="file-preview-retry-btn" onClick={() => initPreview()}>
              Retry
            </button>
          </div>
        )}

        {/* Unsupported */}
        {status === 'unsupported' && (
          <div className="file-preview-unsupported">
            <span className="file-preview-unsupported-icon">{'\u{1F4C1}'}</span>
            <span className="file-preview-unsupported-text">Preview not supported for this file type</span>
            <span className="file-preview-unsupported-hint">.{getExtension(displayName)}</span>
          </div>
        )}

        {/* Image */}
        {status === 'success' && resolvedType === 'image' && (
          <div className="file-preview-image">
            <img src={src} alt="preview" />
          </div>
        )}

        {/* Audio */}
        {status === 'success' && resolvedType === 'audio' && (
          <div className="file-preview-audio">
            <span className="file-preview-audio-icon">{'\u{1F3B5}'}</span>
            <audio controls><source src={src} /></audio>
          </div>
        )}

        {/* Video */}
        {status === 'success' && resolvedType === 'video' && (
          <div className="file-preview-video">
            <video controls><source src={src} /></video>
          </div>
        )}

        {/* HTML */}
        {status === 'success' && resolvedType === 'html' && (
          <div className="file-preview-html">
            <iframe
              src={htmlUrl || undefined}
              srcDoc={htmlUrl ? undefined : textContent}
              sandbox={SANDBOX}
              title="HTML Preview"
            />
          </div>
        )}

        {/* Markdown */}
        {status === 'success' && resolvedType === 'markdown' && textContent && (
          <div className="file-preview-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {processedMarkdown}
            </ReactMarkdown>
          </div>
        )}

        {/* Text / Code */}
        {status === 'success' && resolvedType === 'text' && textContent && (
          <div className="file-preview-text">
            <pre><code>{textContent}</code></pre>
          </div>
        )}

        {/* Office document container (docx, xlsx, pdf, pptx) */}
        {isDocType && (
          <div
            ref={containerRef}
            className="file-preview-docs"
            style={{ display: status === 'success' ? 'block' : 'none' }}
          />
        )}

        {/* Hidden container ref for non-doc types */}
        {!isDocType && <div ref={containerRef} style={{ display: 'none' }} />}
      </div>
    </div>
  );
}

export { type FileType } from './fileTypes';
