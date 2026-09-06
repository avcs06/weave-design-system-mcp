import { Button } from './Button.js';

export default { component: Button };

export const Primary = { args: { variant: 'primary' } };

export const Sizes = { args: { variant: 'primary', size: 'lg' } };

/**
 * Superseded by `Primary` — `danger` is now expressed with the `tone` prop on
 * the surrounding form, not as a Button variant.
 * @deprecated
 */
export const DangerButton = { args: { variant: 'danger', size: 'sm' } };
