import type { ReactNode } from 'react';

export type FlexProps = {
  /** Main-axis distribution. */
  justify?: 'start' | 'center' | 'between';
  children?: ReactNode;
};

/**
 * Row layout primitive.
 * @invalidAlternative div.flex
 */
export function Flex({ justify = 'start', children }: FlexProps) {
  return <div data-justify={justify}>{children}</div>;
}
