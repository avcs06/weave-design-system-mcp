import type { Component, DesignToken } from './types.js';

/**
 * Seed content for the Weave design system.
 *
 * This is the single place to swap in the real source of truth — a generated
 * tokens JSON, a Style Dictionary build, or the `packages/ui` component
 * metadata. Everything else in this server reads through `design-system.ts`
 * and does not care where these arrays come from.
 */

export const tokens: DesignToken[] = [
  {
    name: 'color.surface.base',
    category: 'color',
    value: '#ffffff',
    cssVar: '--weave-color-surface-base',
    description: 'Default page background.',
  },
  {
    name: 'color.surface.raised',
    category: 'color',
    value: '#f6f7f9',
    cssVar: '--weave-color-surface-raised',
    description: 'Background for cards and panels that sit above the page.',
  },
  {
    name: 'color.text.primary',
    category: 'color',
    value: '#11181c',
    cssVar: '--weave-color-text-primary',
    description: 'Primary body and heading text.',
  },
  {
    name: 'color.text.muted',
    category: 'color',
    value: '#5c6b73',
    cssVar: '--weave-color-text-muted',
    description: 'Secondary text, captions, and helper copy.',
  },
  {
    name: 'color.accent.default',
    category: 'color',
    value: '#3b5bdb',
    cssVar: '--weave-color-accent-default',
    description:
      'Primary interactive accent used by default buttons and links.',
  },
  {
    name: 'color.accent.hover',
    category: 'color',
    value: '#364fc7',
    cssVar: '--weave-color-accent-hover',
    description: 'Accent colour under hover and active states.',
  },
  {
    name: 'color.danger.default',
    category: 'color',
    value: '#c92a2a',
    cssVar: '--weave-color-danger-default',
    description: 'Destructive actions and error states.',
  },
  {
    name: 'spacing.xs',
    category: 'spacing',
    value: '0.25rem',
    cssVar: '--weave-spacing-xs',
    description: 'Tightest spacing step (4px at root font size).',
  },
  {
    name: 'spacing.sm',
    category: 'spacing',
    value: '0.5rem',
    cssVar: '--weave-spacing-sm',
    description: 'Compact spacing between related elements.',
  },
  {
    name: 'spacing.md',
    category: 'spacing',
    value: '1rem',
    cssVar: '--weave-spacing-md',
    description: 'Default spacing step.',
  },
  {
    name: 'spacing.lg',
    category: 'spacing',
    value: '1.5rem',
    cssVar: '--weave-spacing-lg',
    description: 'Separation between sections within a surface.',
  },
  {
    name: 'spacing.xl',
    category: 'spacing',
    value: '2.5rem',
    cssVar: '--weave-spacing-xl',
    description: 'Separation between major page regions.',
  },
  {
    name: 'typography.body.font',
    category: 'typography',
    value: "'Inter', system-ui, sans-serif",
    cssVar: '--weave-typography-body-font',
    description: 'Body font stack.',
  },
  {
    name: 'typography.body.size',
    category: 'typography',
    value: '1rem',
    cssVar: '--weave-typography-body-size',
    description: 'Base body text size.',
  },
  {
    name: 'typography.heading.size',
    category: 'typography',
    value: '1.5rem',
    cssVar: '--weave-typography-heading-size',
    description: 'Default heading size for section titles.',
  },
  {
    name: 'radius.sm',
    category: 'radius',
    value: '4px',
    cssVar: '--weave-radius-sm',
    description: 'Corner radius for inputs and small controls.',
  },
  {
    name: 'radius.md',
    category: 'radius',
    value: '8px',
    cssVar: '--weave-radius-md',
    description: 'Corner radius for buttons and cards.',
  },
  {
    name: 'shadow.raised',
    category: 'shadow',
    value:
      '0 1px 2px rgba(17, 24, 28, 0.08), 0 4px 12px rgba(17, 24, 28, 0.06)',
    cssVar: '--weave-shadow-raised',
    description: 'Elevation for cards and popovers.',
  },
  {
    name: 'motion.duration.fast',
    category: 'motion',
    value: '120ms',
    cssVar: '--weave-motion-duration-fast',
    description: 'Duration for hover and focus transitions.',
  },
  {
    name: 'motion.easing.standard',
    category: 'motion',
    value: 'cubic-bezier(0.2, 0, 0, 1)',
    cssVar: '--weave-motion-easing-standard',
    description: 'Default easing curve for UI transitions.',
  },
];

export const components: Component[] = [
  {
    name: 'Button',
    category: 'actions',
    description:
      'Primary interactive control for triggering an action. Renders a native <button>.',
    importPath: '@avcs/weave-ui',
    props: [
      {
        name: 'variant',
        type: "'primary' | 'secondary' | 'ghost' | 'danger'",
        required: false,
        default: "'primary'",
        description: 'Visual emphasis of the button.',
      },
      {
        name: 'size',
        type: "'sm' | 'md' | 'lg'",
        required: false,
        default: "'md'",
        description: 'Control size, which drives padding and font size.',
      },
      {
        name: 'disabled',
        type: 'boolean',
        required: false,
        default: 'false',
        description: 'Disables interaction and reduces contrast.',
      },
      {
        name: 'onClick',
        type: '(event: MouseEvent) => void',
        required: false,
        description: 'Click handler.',
      },
    ],
    tokensUsed: [
      'color.accent.default',
      'color.accent.hover',
      'radius.md',
      'spacing.sm',
      'spacing.md',
      'motion.duration.fast',
    ],
    example: '<Button variant="primary" onClick={save}>Save changes</Button>',
    a11y: [
      'Always give the button a discernible label — visible text, or aria-label when icon-only.',
      'Do not remove the focus ring; it uses color.accent.default at 2px offset.',
      'Use a real <button>, never a clickable <div>, so keyboard and AT users get it for free.',
    ],
  },
  {
    name: 'Card',
    category: 'layout',
    description: 'A raised surface that groups related content.',
    importPath: '@avcs/weave-ui',
    props: [
      {
        name: 'padding',
        type: "'sm' | 'md' | 'lg'",
        required: false,
        default: "'md'",
        description: 'Inner padding, mapped to the spacing scale.',
      },
      {
        name: 'as',
        type: 'ElementType',
        required: false,
        default: "'div'",
        description: 'Element or component to render as, for semantic control.',
      },
    ],
    tokensUsed: [
      'color.surface.raised',
      'radius.md',
      'shadow.raised',
      'spacing.md',
    ],
    example:
      '<Card padding="lg">\n  <h2>Usage</h2>\n  <p>42 of 100 seats</p>\n</Card>',
    a11y: [
      'A Card is a container, not a landmark — pass `as="section"` with a heading when it is a page region.',
      'Never make the whole card clickable without an inner focusable control.',
    ],
  },
  {
    name: 'TextField',
    category: 'forms',
    description:
      'Single-line text input with a label, description, and error state.',
    importPath: '@avcs/weave-ui',
    props: [
      {
        name: 'label',
        type: 'string',
        required: true,
        description:
          'Visible label. Required — placeholder text is not a label.',
      },
      {
        name: 'value',
        type: 'string',
        required: true,
        description: 'Current value, for a controlled input.',
      },
      {
        name: 'onChange',
        type: '(value: string) => void',
        required: true,
        description: 'Called with the next value on every edit.',
      },
      {
        name: 'error',
        type: 'string',
        required: false,
        description:
          'Error message. Presence switches the field into its error state.',
      },
    ],
    tokensUsed: [
      'color.surface.base',
      'color.text.primary',
      'color.danger.default',
      'radius.sm',
      'spacing.sm',
    ],
    example:
      '<TextField\n  label="Workspace name"\n  value={name}\n  onChange={setName}\n  error={errors.name}\n/>',
    a11y: [
      'The label is wired to the input with a generated id — do not pass your own duplicate.',
      'Error text is announced via aria-describedby and aria-invalid.',
    ],
  },
  {
    name: 'Stack',
    category: 'layout',
    description:
      'Flex layout primitive that applies consistent spacing between children.',
    importPath: '@avcs/weave-ui',
    props: [
      {
        name: 'direction',
        type: "'row' | 'column'",
        required: false,
        default: "'column'",
        description: 'Main axis direction.',
      },
      {
        name: 'gap',
        type: "'xs' | 'sm' | 'md' | 'lg' | 'xl'",
        required: false,
        default: "'md'",
        description: 'Spacing between children, mapped to the spacing scale.',
      },
      {
        name: 'align',
        type: "'start' | 'center' | 'end' | 'stretch'",
        required: false,
        default: "'stretch'",
        description: 'Cross-axis alignment.',
      },
    ],
    tokensUsed: [
      'spacing.xs',
      'spacing.sm',
      'spacing.md',
      'spacing.lg',
      'spacing.xl',
    ],
    example:
      '<Stack direction="row" gap="sm" align="center">\n  <Button>Save</Button>\n  <Button variant="ghost">Cancel</Button>\n</Stack>',
    a11y: [
      'Purely presentational — it renders a plain div and adds no semantics.',
    ],
  },
];
