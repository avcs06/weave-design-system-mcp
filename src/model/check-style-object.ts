import type { Expression, ObjectExpression } from '@babel/types';

import type { DesignSystem, Finding, Surface } from './types.js';

/**
 * Maps a style-object property (every styling system this server supports
 * — and a plain React inline `style` prop — expresses styles as a JS object
 * with camelCase keys, so this is written once and shared, not duplicated
 * per implementation under `adapters/styles/`).
 *
 * Deliberately exhaustive across the common CSS surface, but the group
 * *names* are just a convention (whatever a real token source calls that
 * group) — a check only fires when the design system's token set actually
 * has a group by that exact name. `width`/`height` are deliberately
 * excluded: too overloaded (an icon's size and a card's layout width use
 * the same property) to map to one group without a high false-positive rate.
 */
const PROPERTY_TO_GROUP: Record<string, string> = {
  color: 'color',
  backgroundColor: 'color',
  background: 'color',
  borderColor: 'color',
  borderTopColor: 'color',
  borderRightColor: 'color',
  borderBottomColor: 'color',
  borderLeftColor: 'color',
  outlineColor: 'color',
  textDecorationColor: 'color',
  caretColor: 'color',
  fill: 'color',
  stroke: 'color',

  padding: 'spacing',
  paddingTop: 'spacing',
  paddingRight: 'spacing',
  paddingBottom: 'spacing',
  paddingLeft: 'spacing',
  paddingInline: 'spacing',
  paddingBlock: 'spacing',
  margin: 'spacing',
  marginTop: 'spacing',
  marginRight: 'spacing',
  marginBottom: 'spacing',
  marginLeft: 'spacing',
  marginInline: 'spacing',
  marginBlock: 'spacing',
  gap: 'spacing',
  rowGap: 'spacing',
  columnGap: 'spacing',
  inset: 'spacing',
  top: 'spacing',
  left: 'spacing',
  right: 'spacing',
  bottom: 'spacing',

  // typography — kept as separate groups, not folded into one "typography",
  // since real token sets (including the one this was built against) keep
  // fontFamily/fontSize/fontWeight/lineHeight as distinct top-level groups
  fontFamily: 'fontFamily',
  fontSize: 'fontSize',
  fontWeight: 'fontWeight',
  lineHeight: 'lineHeight',
  letterSpacing: 'letterSpacing',

  borderRadius: 'radius',
  borderTopLeftRadius: 'radius',
  borderTopRightRadius: 'radius',
  borderBottomLeftRadius: 'radius',
  borderBottomRightRadius: 'radius',

  // border width (distinct from border color, above)
  borderWidth: 'borderWidth',
  borderTopWidth: 'borderWidth',
  borderRightWidth: 'borderWidth',
  borderBottomWidth: 'borderWidth',
  borderLeftWidth: 'borderWidth',
  outlineWidth: 'borderWidth',

  boxShadow: 'shadow',
  textShadow: 'shadow',

  transitionDuration: 'motion',
  animationDuration: 'motion',
  transitionDelay: 'motion',
  animationDelay: 'motion',
  transitionTimingFunction: 'motion',
  animationTimingFunction: 'motion',

  opacity: 'opacity',
  zIndex: 'zIndex',
};

/** Generic values that are never a design decision worth tokenizing, regardless of property. */
const GENERIC_VALUES = new Set([
  'inherit',
  'initial',
  'unset',
  'none',
  'auto',
  'transparent',
  'currentcolor',
  '0',
]);

function isLiteralValue(node: Expression): string | undefined {
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'NumericLiteral') return String(node.value);
  // TemplateLiteral (e.g. `0 0 0 3px color-mix(in srgb, ${theme.shadow} 16%, transparent)`)
  // often mixes a real token reference with literal structure — resolving
  // that fully isn't worth the complexity, so it's treated as a reference
  // (not flagged) rather than risk a false positive.
  return undefined;
}

/**
 * Recursively walks an object literal — a style-authoring call's argument
 * (whichever styling system found it; this function has no opinion), a
 * variant/sub-variant object nested inside one, or a JSX `style={{}}` prop
 * (the TSX adapter calls this directly) — looking for a *governed* property
 * set to a literal value rather than a token/theme reference. No
 * special-casing of which nested key means what (selectors, media queries,
 * variants, ...): every nested object is just walked the same way, and
 * quoted keys (`'&:hover'` — `&` isn't a valid bare identifier) are read
 * the same as bare ones.
 *
 * Shared by every concrete implementation under `adapters/styles/` and by
 * the TSX adapter's inline `style` prop check, so "which properties map to
 * which token group" is written and fixed in exactly one place.
 */
export function checkStyleObject(obj: ObjectExpression, system: DesignSystem, surface: Surface): Finding[] {
  const findings: Finding[] = [];

  const walk = (node: ObjectExpression) => {
    for (const prop of node.properties) {
      if (prop.type !== 'ObjectProperty') continue;

      const key =
        prop.key.type === 'Identifier'
          ? prop.key.name
          : prop.key.type === 'StringLiteral'
            ? prop.key.value
            : undefined;
      if (key === undefined) continue;

      const value = prop.value as Expression;
      if (value.type === 'ObjectExpression') {
        walk(value);
        continue;
      }

      const group = PROPERTY_TO_GROUP[key];
      if (!group) continue; // not a governed property

      if (system.tokens(group).length === 0) continue; // this design system has no tokens for this group at all

      const literal = isLiteralValue(value);
      if (literal === undefined) continue; // a reference (identifier/member expression), not a literal — fine
      if (GENERIC_VALUES.has(literal.toLowerCase())) continue;

      const nearest = system.nearestToken(literal, group);
      const loc = value.loc;
      findings.push({
        rule: 'hardcoded-literal',
        severity: 'error',
        surface,
        line: loc ? loc.start.line : 0,
        column: loc ? loc.start.column + 1 : 0,
        message: `"${key}: ${literal}" hardcodes a ${group} value instead of using a design token.${
          nearest ? ` The closest token is "${nearest.name}".` : ''
        }`,
        suggestion: nearest?.reference,
      });
    }
  };

  walk(obj);
  return findings;
}
