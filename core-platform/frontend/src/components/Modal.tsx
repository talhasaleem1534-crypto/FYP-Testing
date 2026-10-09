import React from 'react';
import { X } from 'lucide-react';

/** A centred dialog on a dimmed backdrop. Styles: .modal-backdrop / .modal / .modal-head in index.css. */
export default function Modal({ title, onClose, children, width = 540 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="btn subtle icon" onClick={onClose} aria-label="Close" title="Close"><X size={17} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
