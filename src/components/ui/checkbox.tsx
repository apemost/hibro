import type { InputHTMLAttributes } from 'react';
import './controls.css';

/** A Hibro-painted checkbox that retains native labeling and keyboard semantics. */
export function Checkbox({
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <input
      {...props}
      type="checkbox"
      className={`hibro-checkbox ${className}`}
    />
  );
}
