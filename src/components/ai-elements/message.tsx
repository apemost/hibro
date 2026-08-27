"use client";

// Lightweight AI Elements message components. Message actions live in the
// panel, and Markdown rendering uses Streamdown without Shiki.

import { cn } from "@/lib/utils";
import { chartRenderer } from "@/panel/ChartBlock";
import { htmlRenderer } from "@/panel/HtmlBlock";
import { hibroMermaid } from "@/panel/mermaidPlugin";
import { RemoteMarkdownImage } from "@/panel/RemoteMarkdownImage";
import { cjk } from "@streamdown/cjk";
import { math } from "@streamdown/math";
import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

/** Positions one user or assistant message in the conversation. */
export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

/** Provides the visual surface for one message. */
export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

// Custom renderers add diagrams, charts, and sandboxed HTML previews. Images
// in model Markdown remain inert until the user approves one guarded request.
// Shiki is omitted to keep the extension bundle small, so code stays plain.
const streamdownPlugins = {
  cjk,
  math,
  mermaid: hibroMermaid,
  renderers: [chartRenderer, htmlRenderer]
};

/** Renders streamed Markdown with Hibro's safe fenced-block extensions. */
export const MessageResponse = memo(
  ({ className, components, ...props }: MessageResponseProps) => (
    <Streamdown
      {...props}
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className
      )}
      components={
        { ...components, img: RemoteMarkdownImage } as NonNullable<
          MessageResponseProps["components"]
        >
      }
      plugins={streamdownPlugins}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating
);

MessageResponse.displayName = "MessageResponse";
