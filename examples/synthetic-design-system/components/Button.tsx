import type { ButtonHTMLAttributes } from 'react';

import * as styles from './Button.css.js';

const sizeStyles = { sm: {}, md: {}, lg: {} } as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Visual emphasis of the button. */
  variant?: 'primary' | 'secondary' | 'danger';
  /** Control size. */
  size?: keyof typeof sizeStyles;
};

/**
 * Primary interactive control for triggering an action.
 * @invalidAlternative button, MuiButton
 */
export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return <button className={`${styles.button} ${className ?? ''}`} {...props} />;
}
