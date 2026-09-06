import { style } from '@vanilla-extract/css';

import { tokens } from '../tokens.js';
import { vars } from '../theme.css.js';

export const button = style({
  color: vars.color.surface,
  background: vars.color.accent,
  padding: tokens.spacing.sm,
  borderRadius: tokens.radius.md,
  border: 'none',
  cursor: 'pointer',

  selectors: {
    '&:hover': {
      background: vars.color.accentHover,
    },
  },
});
