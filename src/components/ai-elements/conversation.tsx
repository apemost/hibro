'use client';

// Adapted from Vercel AI Elements. Copyright 2023 Vercel, Inc.
// Licensed under Apache-2.0; modified for Hibro.
// Lightweight AI Elements conversation components with bottom-following and
// transient scrollbar feedback.

import { cn } from '@/lib/utils';
import type { ComponentProps, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';

const SCROLLBAR_IDLE_DELAY_MS = 700;
type ScrollAxis = 'x' | 'y';

export type ConversationProps = ComponentProps<typeof StickToBottom>;

/** Provides the scrollable conversation region. */
export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn(
      'relative flex-1 overflow-x-hidden overflow-y-hidden',
      className,
    )}
    initial="instant"
    resize="instant"
    role="log"
    {...props}
  />
);

export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

/** Renders conversation content and tracks active scroll axes. */
export const ConversationContent = ({
  className,
  scrollClassName,
  ...props
}: ConversationContentProps) => {
  const { scrollRef } = useStickToBottomContext();
  const idleTimerRef = useRef<Record<ScrollAxis, number | null>>({
    x: null,
    y: null,
  });

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const log = viewport.parentElement;
    if (!log) return;
    const previousTabIndex = viewport.getAttribute('tabindex');
    viewport.tabIndex = 0;

    let previousScrollLeft = viewport.scrollLeft;
    let previousScrollTop = viewport.scrollTop;

    const clearAxis = (axis: ScrollAxis) => {
      log.classList.remove(`is-scrolling-${axis}`);
      viewport.classList.remove(`is-scrolling-${axis}`);
      idleTimerRef.current[axis] = null;
    };

    const markAxis = (axis: ScrollAxis) => {
      const trackInset = 2;
      if (axis === 'x') {
        const scrollRange = viewport.scrollWidth - viewport.clientWidth;
        if (scrollRange <= 0) return;
        const trackWidth = Math.max(0, viewport.clientWidth - trackInset * 2);
        const thumbWidth = Math.max(
          32,
          trackWidth * (viewport.clientWidth / viewport.scrollWidth),
        );
        const thumbTravel = Math.max(0, trackWidth - thumbWidth);
        const thumbLeft =
          trackInset + (viewport.scrollLeft / scrollRange) * thumbTravel;
        log.style.setProperty(
          '--conversation-scrollbar-left',
          `${thumbLeft}px`,
        );
        log.style.setProperty(
          '--conversation-scrollbar-width',
          `${thumbWidth}px`,
        );
      } else {
        const scrollRange = viewport.scrollHeight - viewport.clientHeight;
        if (scrollRange <= 0) return;
        const trackHeight = Math.max(0, viewport.clientHeight - trackInset * 2);
        const thumbHeight = Math.max(
          32,
          trackHeight * (viewport.clientHeight / viewport.scrollHeight),
        );
        const thumbTravel = Math.max(0, trackHeight - thumbHeight);
        const thumbTop =
          trackInset + (viewport.scrollTop / scrollRange) * thumbTravel;
        log.style.setProperty('--conversation-scrollbar-top', `${thumbTop}px`);
        log.style.setProperty(
          '--conversation-scrollbar-height',
          `${thumbHeight}px`,
        );
      }

      log.classList.add(`is-scrolling-${axis}`);
      viewport.classList.add(`is-scrolling-${axis}`);
      const currentTimer = idleTimerRef.current[axis];
      if (currentTimer !== null) window.clearTimeout(currentTimer);
      idleTimerRef.current[axis] = window.setTimeout(() => {
        clearAxis(axis);
      }, SCROLLBAR_IDLE_DELAY_MS);
    };

    const markScrolling = () => {
      const nextScrollLeft = viewport.scrollLeft;
      const nextScrollTop = viewport.scrollTop;
      if (nextScrollLeft !== previousScrollLeft) markAxis('x');
      if (nextScrollTop !== previousScrollTop) markAxis('y');
      previousScrollLeft = nextScrollLeft;
      previousScrollTop = nextScrollTop;
    };

    viewport.addEventListener('scroll', markScrolling, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', markScrolling);
      for (const axis of ['x', 'y'] as const) {
        const timer = idleTimerRef.current[axis];
        if (timer !== null) window.clearTimeout(timer);
        clearAxis(axis);
      }
      if (previousTabIndex === null) viewport.removeAttribute('tabindex');
      else viewport.setAttribute('tabindex', previousTabIndex);
    };
  }, [scrollRef]);

  return (
    <StickToBottom.Content
      className={cn('flex flex-col gap-4 p-3', className)}
      scrollClassName={cn('conversation-scroll', scrollClassName)}
      {...props}
    />
  );
};

export type ConversationEmptyStateProps = ComponentProps<'div'> & {
  title?: string;
  description?: string;
  icon?: ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = 'No messages yet',
  description,
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      'flex size-full flex-col items-center justify-center gap-3 p-8 text-center',
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{title}</h3>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);
