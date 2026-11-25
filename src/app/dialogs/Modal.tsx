import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';

export function Modal(props: { title: string; onClose: () => void; footer?: ComponentChildren; children: ComponentChildren; width?: number }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        props.onClose();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);
  return (
    <div class="modal-back" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="modal" style={props.width ? { width: props.width } : undefined}>
        <div class="modal-h">
          <span class="grow">{props.title}</span>
          <button class="x" onClick={props.onClose} title="關閉">
            ×
          </button>
        </div>
        <div class="modal-b">{props.children}</div>
        {props.footer && <div class="modal-f">{props.footer}</div>}
      </div>
    </div>
  );
}
