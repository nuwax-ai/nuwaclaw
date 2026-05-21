import { useCallback, useEffect, useState } from 'react';

/**
 * Image with click-to-zoom lightbox + load-state placeholder.
 *
 * Mirrors nuwax's `OptimizedImage` (see nuwax
 * `src/components/MarkdownRenderer/OptimizedImage.tsx`) but avoids the
 * Antd `<Image preview>` dependency. The lightbox is a pure React + CSS
 * portal-less overlay: covers the viewport, closes on backdrop click or Esc.
 *
 * Load-state placeholder: while the original image is loading we render a
 * neutral background; on error we render a small fallback label so the user
 * still sees a tappable target.
 */
export interface OptimizedImageProps {
  src: string;
  alt?: string;
  title?: string;
}

export function OptimizedImage({ src, alt = '', title }: OptimizedImageProps): JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [preview, setPreview] = useState(false);

  const handleOpen = useCallback(() => {
    if (error) return;
    setPreview(true);
  }, [error]);
  const handleClose = useCallback(() => setPreview(false), []);

  // Esc to close + lock body scroll while the lightbox is open.
  useEffect(() => {
    if (!preview) return;
    if (typeof document === 'undefined') return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [preview, handleClose]);

  return (
    <span
      className={`md-image-wrapper${loaded ? ' md-image-wrapper--loaded' : ''}${
        error ? ' md-image-wrapper--error' : ''
      }`}
    >
      {error ? (
        <span className="md-image-error" role="img" aria-label={alt || 'image failed to load'}>
          {alt || 'Image unavailable'}
        </span>
      ) : (
        <img
          src={src}
          alt={alt}
          title={title}
          className="md-image"
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          onClick={handleOpen}
        />
      )}
      {preview && (
        <div
          className="md-image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={alt || 'Image preview'}
        >
          <div
            className="md-image-lightbox-backdrop"
            onClick={handleClose}
            data-testid="md-image-lightbox-backdrop"
          />
          <button
            type="button"
            className="md-image-lightbox-close"
            onClick={handleClose}
            aria-label="Close image preview"
          >
            {'×'}
          </button>
          <img src={src} alt={alt} className="md-image-lightbox-img" />
        </div>
      )}
    </span>
  );
}
