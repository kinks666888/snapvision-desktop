import React, { useCallback, useState } from 'react';
import { selectImageFile } from '../services/ocr-service';

interface DropZoneProps {
  onImageSelected: (filePath: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function DropZone({ onImageSelected, disabled = false, compact = false }: DropZoneProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setDragOver(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (disabled) return;

      const file = e.dataTransfer.files[0];
      if (file) {
        const filePath = (file as unknown as { path?: string }).path;
        if (filePath) {
          onImageSelected(filePath);
          return;
        }
        try {
          const dialogPath = await selectImageFile();
          if (dialogPath) onImageSelected(dialogPath);
        } catch {
          // silent
        }
      }
    },
    [disabled, onImageSelected]
  );

  const handleSelectFile = useCallback(async () => {
    if (disabled) return;
    try {
      const filePath = await selectImageFile();
      if (filePath) onImageSelected(filePath);
    } catch {
      // silent
    }
  }, [disabled, onImageSelected]);

  if (compact) {
    return (
      <div className="animate-fade-in">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleSelectFile}
          className={`
            card relative flex flex-col items-center justify-center gap-2.5
            py-5 cursor-pointer transition-colors duration-150
            ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
            ${dragOver ? 'border-accent' : ''}
          `}
          style={dragOver ? { backgroundColor: 'rgba(59, 130, 246, 0.04)', borderColor: '#3b82f6' } : undefined}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
            style={{ backgroundColor: dragOver ? 'rgba(59, 130, 246, 0.1)' : 'rgba(52, 60, 74, 0.3)' }}
          >
            <svg className={`w-4 h-4 transition-colors ${dragOver ? 'text-accent' : 'text-dark-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </div>
          <div className="text-center space-y-0.5">
            <p className="text-dark-300 text-[11px] font-medium">
              {dragOver ? '松开以上传' : '拖拽截图到此处'}
            </p>
            <p className="text-dark-600 text-[9px]">PNG / JPG / WEBP</p>
          </div>
        </div>
        <div className="flex items-center justify-center gap-1.5 mt-2">
          <button type="button" onClick={handleSelectFile} disabled={disabled} className="btn-primary text-[10px] px-3 py-1">
            选择图片
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Drop area */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleSelectFile}
        className={`
          relative flex flex-col items-center justify-center gap-4
          min-h-[200px] rounded-card cursor-pointer transition-colors duration-150
          ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
        `}
        style={{
          border: `1.5px dashed ${dragOver ? '#3b82f6' : '#333b48'}`,
          backgroundColor: dragOver ? 'rgba(59, 130, 246, 0.04)' : 'rgba(24, 28, 35, 0.5)',
        }}
      >
        {/* Icon */}
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center transition-colors"
          style={{ backgroundColor: dragOver ? 'rgba(59, 130, 246, 0.1)' : 'rgba(52, 60, 74, 0.3)' }}
        >
          <svg className={`w-5 h-5 transition-colors ${dragOver ? 'text-accent' : 'text-dark-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
        </div>

        {/* Text */}
        <div className="text-center space-y-1">
          <p className="text-dark-200 text-[12px] font-medium">
            {dragOver ? '松开以上传图片' : '拖拽截图到此处'}
          </p>
          <p className="text-dark-500 text-[10px]">
            支持 PNG / JPG / WEBP
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-center gap-2">
        <button type="button" onClick={handleSelectFile} disabled={disabled} className="btn-primary">
          选择图片
        </button>
      </div>
    </div>
  );
}
