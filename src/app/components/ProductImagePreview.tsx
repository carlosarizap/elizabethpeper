'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title: string;
  imageUrl?: string | null;
  className?: string;
}

const POPOVER_WIDTH = 240;
const POPOVER_HEIGHT = 286;
const VIEWPORT_MARGIN = 12;

export default function ProductImagePreview({ title, imageUrl, className = '' }: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [position, setPosition] = useState({ left: VIEWPORT_MARGIN, top: VIEWPORT_MARGIN });
  const availableImage = imageUrl?.trim() && !imageFailed ? imageUrl.trim() : null;

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
      const left = Math.min(
        Math.max(VIEWPORT_MARGIN, rect.left + rect.width / 2 - width / 2),
        window.innerWidth - width - VIEWPORT_MARGIN,
      );
      const fitsBelow = rect.bottom + 8 + POPOVER_HEIGHT <= window.innerHeight;
      const top = fitsBelow
        ? rect.bottom + 8
        : Math.max(VIEWPORT_MARGIN, rect.top - POPOVER_HEIGHT - 8);
      setPosition({ left, top });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  if (!availableImage) return <span className={className}>{title}</span>;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-label={`Ver foto de ${title}`}
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex max-w-full cursor-zoom-in items-start text-left underline decoration-dotted decoration-slate-300 underline-offset-2 hover:decoration-blue-500 focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-blue-500 ${className}`}
      >
        <span>{title}</span>
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="tooltip"
              className="pointer-events-none fixed z-[100] w-[240px] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl print:hidden"
              style={{ left: position.left, top: position.top }}
            >
              <div className="flex h-56 items-center justify-center overflow-hidden rounded-xl bg-slate-50">
                {/* The source is dynamic catalog data and the image only loads on interaction. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={availableImage}
                  alt={`Foto principal de ${title}`}
                  className="h-full w-full object-contain"
                  onError={() => {
                    setImageFailed(true);
                    setOpen(false);
                  }}
                />
              </div>
              <p className="line-clamp-2 px-1 pb-1 pt-2 text-xs font-semibold leading-4 text-slate-700">
                {title}
              </p>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
