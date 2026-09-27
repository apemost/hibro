'use client';

// Adapted from Vercel AI Elements. Copyright 2023 Vercel, Inc.
// Licensed under Apache-2.0; modified for Hibro.
// Lightweight AI Elements tool card built from native details and pre elements.

import { cn } from '@/lib/utils';
import type { HibroPart } from '@/shared/protocol';
import { usePanelI18n } from '@/panel/i18n';
import type { ComponentProps } from 'react';
import { useEffect, useRef } from 'react';

export type ToolPart = Extract<HibroPart, { type: 'tool-invocation' }>;

const statusDot: Record<ToolPart['state'], string> = {
  'input-available': 'bg-yellow-500 animate-pulse',
  'output-available': 'bg-green-500',
  'output-error': 'bg-red-500',
};

const SCROLLBAR_IDLE_DELAY_MS = 700;

const ToolScrollArea = ({ className, ...props }: ComponentProps<'pre'>) => {
  const scrollRef = useRef<HTMLPreElement>(null);
  const idleTimerRef = useRef<number | null>(null);
  const previousScrollLeftRef = useRef(0);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element || element.scrollLeft === previousScrollLeftRef.current)
      return;
    previousScrollLeftRef.current = element.scrollLeft;
    element.classList.add('is-scrolling-x');
    if (idleTimerRef.current !== null)
      window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      element.classList.remove('is-scrolling-x');
      idleTimerRef.current = null;
    }, SCROLLBAR_IDLE_DELAY_MS);
  };

  useEffect(
    () => () => {
      if (idleTimerRef.current !== null)
        window.clearTimeout(idleTimerRef.current);
      scrollRef.current?.classList.remove('is-scrolling-x');
    },
    [],
  );

  return (
    <pre
      className={cn(
        'tool-scroll overflow-x-auto rounded bg-muted p-2 text-xs',
        className,
      )}
      onScroll={handleScroll}
      ref={scrollRef}
      {...props}
    />
  );
};

export type ToolProps = {
  part: ToolPart;
  className?: string;
};

/** Renders one tool call and its input or result. */
export const Tool = ({ part, className }: ToolProps) => {
  const { messages } = usePanelI18n();
  const body = part.state === 'output-error' ? part.errorText : part.output;
  const hasInput = part.input && Object.keys(part.input).length > 0;
  return (
    <details
      className={cn(
        'my-1 rounded-md border border-border p-2 text-sm',
        className,
      )}
      open={part.state !== 'output-available'}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 select-none">
        <span
          className={cn(
            'inline-block size-2 shrink-0 rounded-full',
            statusDot[part.state],
          )}
        />
        <span className="font-medium">{part.toolName}</span>
        <span className="text-xs text-muted-foreground">
          {messages.toolStatus[part.state]}
        </span>
      </summary>
      <div className="mt-2 space-y-2">
        {hasInput && (
          <ToolScrollArea>{JSON.stringify(part.input, null, 2)}</ToolScrollArea>
        )}
        {body !== undefined && body !== null && body !== '' && (
          <ToolScrollArea>{String(body)}</ToolScrollArea>
        )}
      </div>
    </details>
  );
};
