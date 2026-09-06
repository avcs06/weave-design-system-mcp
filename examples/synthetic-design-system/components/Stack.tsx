import type { ReactNode } from 'react';

export type StackProps = {
  /** Direction children flow in. */
  direction?: 'row' | 'column';
  children?: ReactNode;
};

/**
 * Lays its children out in one direction. Deliberately declares no
 * `@invalidAlternative`: a layout component doesn't stand in for one
 * particular element the way Button stands in for `button`.
 */
export function Stack({ direction = 'column', children }: StackProps) {
  return <div data-direction={direction}>{children}</div>;
}
