import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// shadcn-style className combiner used by the AI Elements components.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
