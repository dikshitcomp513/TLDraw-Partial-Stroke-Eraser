import React from 'react';
import { Tldraw, useEditor, useValue } from 'tldraw';
import 'tldraw/tldraw.css';
import { ContinuousEraserTool } from './ContinuousEraserTool';

// 1. A simple custom toolbar component with a button to select the continuous eraser
function CustomToolbar() {
  const editor = useEditor();
  const currentTool = useValue('currentTool', () => editor.getCurrentToolId(), [editor]);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        display: 'flex',
        gap: 8,
        background: '#ffffff',
        padding: '8px 12px',
        borderRadius: 12,
        boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        border: '1px solid #e5e5e5',
      }}
    >
      <button
        type="button"
        onClick={() => editor.setCurrentTool('draw')}
        style={{
          padding: '6px 12px',
          borderRadius: 8,
          border: 'none',
          cursor: 'pointer',
          background: currentTool === 'draw' ? '#3b82f6' : '#f3f4f6',
          color: currentTool === 'draw' ? '#ffffff' : '#1f2937',
          fontWeight: 600,
        }}
      >
        Pen Tool
      </button>

      <button
        type="button"
        onClick={() => editor.setCurrentTool('continuous-eraser')}
        style={{
          padding: '6px 12px',
          borderRadius: 8,
          border: 'none',
          cursor: 'pointer',
          background: currentTool === 'continuous-eraser' ? '#ef4444' : '#f3f4f6',
          color: currentTool === 'continuous-eraser' ? '#ffffff' : '#1f2937',
          fontWeight: 600,
        }}
      >
        Continuous Eraser
      </button>

      <button
        type="button"
        onClick={() => editor.setCurrentTool('select')}
        style={{
          padding: '6px 12px',
          borderRadius: 8,
          border: 'none',
          cursor: 'pointer',
          background: currentTool === 'select' ? '#3b82f6' : '#f3f4f6',
          color: currentTool === 'select' ? '#ffffff' : '#1f2937',
          fontWeight: 600,
        }}
      >
        Select Tool
      </button>
    </div>
  );
}

// 2. Main Board Component registering the ContinuousEraserTool
export default function WhiteboardApp() {
  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <Tldraw
        tools={[ContinuousEraserTool]}
        components={{
          Toolbar: CustomToolbar,
        }}
      />
    </div>
  );
}
