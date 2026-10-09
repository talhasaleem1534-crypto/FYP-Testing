import React from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, onClose, children, width = 540 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: width, padding: 28, margin: 16, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: 6, color: 'var(--text-secondary)' }}><X size={17} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
