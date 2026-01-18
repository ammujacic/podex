'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Loader2, Mic, Paperclip, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SUPPORTED_IMAGE_TYPES, MAX_ATTACHMENT_SIZE_MB } from '@podex/shared';
import type { AttachmentFile } from '@podex/shared';
import type { ExtendedModelInfo } from '@/hooks/useModelLoading';
import { SlashCommandMenu, isBuiltInCommand, type BuiltInCommand } from './SlashCommandMenu';
import type { CustomCommand } from '@/lib/api';

interface AgentCardInputProps {
  sessionId: string;
  agentId: string;
  agentName: string;
  currentModelInfo: ExtendedModelInfo | undefined;
  isSending: boolean;
  isRecording: boolean;
  currentTranscript: string;
  onSendMessage: (message: string, attachments: AttachmentFile[]) => Promise<void>;
  onStartRecording: () => void;
  onStopRecording: () => Promise<void>;
  onSlashCommand: (command: BuiltInCommand | CustomCommand) => Promise<void>;
}

/**
 * Input area for agent chat with attachments, voice recording, and slash commands.
 * Extracted from AgentCard for better maintainability.
 */
export const AgentCardInput = React.memo<AgentCardInputProps>(function AgentCardInput({
  sessionId,
  agentId: _agentId,
  agentName,
  currentModelInfo,
  isSending,
  isRecording,
  currentTranscript,
  onSendMessage,
  onStartRecording,
  onStopRecording,
  onSlashCommand,
}) {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [_historyIndex, setHistoryIndex] = useState(-1);
  const [_savedInput, setSavedInput] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle input change with slash command detection
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setMessage(value);

    if (value.startsWith('/')) {
      setSlashQuery(value.slice(1));
      setShowSlashMenu(true);
    } else {
      setShowSlashMenu(false);
      setSlashQuery('');
    }
  }, []);

  // Handle send
  const handleSend = useCallback(async () => {
    if ((!message.trim() && attachments.length === 0) || isSending) return;

    const messageContent = message.trim();
    const currentAttachments = [...attachments];

    setMessage('');
    setAttachments([]);
    setHistoryIndex(-1);
    setSavedInput('');

    await onSendMessage(messageContent, currentAttachments);
  }, [message, attachments, isSending, onSendMessage]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showSlashMenu) {
      if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab'].includes(e.key)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSlashMenu(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Handle slash command selection
  const handleSlashCommandSelect = useCallback(
    async (command: BuiltInCommand | CustomCommand) => {
      setShowSlashMenu(false);
      setSlashQuery('');

      if (isBuiltInCommand(command)) {
        const builtIn = command as BuiltInCommand;

        // Handle commands that need args
        if (builtIn.args && builtIn.args.length > 0) {
          const argPlaceholders = builtIn.args
            .map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`))
            .join(' ');
          setMessage(`/${builtIn.name} ${argPlaceholders}`);
          setTimeout(() => {
            if (inputRef.current) {
              const start = builtIn.name.length + 2;
              inputRef.current.focus();
              inputRef.current.setSelectionRange(start, inputRef.current.value.length);
            }
          }, 0);
          return;
        }
      }

      // Delegate to parent for command execution
      await onSlashCommand(command);
      setMessage('');
    },
    [onSlashCommand]
  );

  // File attachment handling
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      if (!currentModelInfo?.supportsVision) {
        toast.error(
          `${currentModelInfo?.displayName ?? 'This model'} does not support image input`
        );
        return;
      }

      const newAttachments: AttachmentFile[] = [];

      for (const file of Array.from(files)) {
        if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
          toast.error(`Unsupported file type: ${file.name}. Use PNG, JPG, GIF, or WebP.`);
          continue;
        }

        const sizeMB = file.size / (1024 * 1024);
        if (sizeMB > MAX_ATTACHMENT_SIZE_MB) {
          toast.error(
            `File too large: ${file.name} (${sizeMB.toFixed(1)}MB). Max is ${MAX_ATTACHMENT_SIZE_MB}MB.`
          );
          continue;
        }

        const preview = URL.createObjectURL(file);
        newAttachments.push({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          name: file.name,
          type: file.type,
          size: file.size,
          preview,
          status: 'ready',
        });
      }

      setAttachments((prev) => [...prev, ...newAttachments]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [currentModelInfo]
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att?.preview) URL.revokeObjectURL(att.preview);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  // Clear attachments if model doesn't support vision
  useEffect(() => {
    if (!currentModelInfo?.supportsVision && attachments.length > 0) {
      toast.warning('Attachments cleared: selected model does not support images');
      attachments.forEach((att) => {
        if (att.preview) URL.revokeObjectURL(att.preview);
      });
      setAttachments([]);
    }
  }, [currentModelInfo?.supportsVision, attachments]);

  // Voice release handler
  const handleVoiceRelease = useCallback(async () => {
    await onStopRecording();
  }, [onStopRecording]);

  return (
    <div className="border-t border-border-subtle p-3" data-tour="agent-input">
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {attachments.map((att) => (
            <div key={att.id} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={att.preview}
                alt={att.name}
                className="h-16 w-16 object-cover rounded border border-border-subtle"
              />
              <button
                onClick={() => removeAttachment(att.id)}
                className="absolute -top-1 -right-1 bg-red-500 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity min-h-[28px] min-w-[28px] flex items-center justify-center"
                aria-label={`Remove ${att.name}`}
              >
                <X className="h-3 w-3 text-white" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Real-time transcription preview */}
      {isRecording && currentTranscript && (
        <div className="mb-2 rounded-md bg-elevated px-3 py-2 text-sm text-text-secondary">
          <span
            className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-accent-error"
            aria-hidden="true"
          />
          {currentTranscript}
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* Attachment button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!currentModelInfo?.supportsVision}
          className={cn(
            'rounded-md p-2 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center',
            currentModelInfo?.supportsVision
              ? 'bg-elevated text-text-muted hover:bg-overlay hover:text-text-secondary'
              : 'bg-elevated text-text-muted/50 cursor-not-allowed'
          )}
          aria-label={
            currentModelInfo?.supportsVision
              ? 'Attach image (PNG, JPG, GIF, WebP)'
              : `${currentModelInfo?.displayName ?? 'This model'} does not support images`
          }
        >
          <Paperclip className="h-4 w-4" />
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Mic button */}
        <button
          onMouseDown={onStartRecording}
          onMouseUp={handleVoiceRelease}
          onMouseLeave={handleVoiceRelease}
          onTouchStart={(e) => {
            e.preventDefault();
            onStartRecording();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            handleVoiceRelease();
          }}
          className={cn(
            'rounded-md p-2 transition-colors touch-none min-h-[44px] min-w-[44px] flex items-center justify-center',
            isRecording
              ? 'bg-accent-error text-text-inverse animate-pulse'
              : 'bg-elevated text-text-muted hover:bg-overlay hover:text-text-secondary'
          )}
          aria-label="Hold to speak"
        >
          <Mic className="h-4 w-4" />
        </button>

        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={message}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              isRecording
                ? 'Listening...'
                : `Type / for commands or ask ${agentName.toLowerCase()}...`
            }
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            className="w-full bg-elevated border border-border-default rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none selection:bg-accent-primary selection:text-white min-h-[44px]"
            disabled={isRecording}
            aria-label="Message input"
          />
          {showSlashMenu && (
            <SlashCommandMenu
              query={slashQuery}
              sessionId={sessionId}
              onSelect={handleSlashCommandSelect}
              onClose={() => setShowSlashMenu(false)}
            />
          )}
        </div>

        <button
          onClick={handleSend}
          disabled={
            (!message.trim() && attachments.length === 0) ||
            isSending ||
            isRecording ||
            (attachments.length > 0 && !currentModelInfo?.supportsVision)
          }
          className={cn(
            'rounded-md p-2 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center',
            (message.trim() || attachments.length > 0) && !isSending && !isRecording
              ? 'bg-accent-primary text-text-inverse hover:bg-opacity-90 cursor-pointer'
              : 'bg-elevated text-text-muted cursor-not-allowed'
          )}
          aria-label="Send message"
        >
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
});
