/**
 * The Hotel Darshan logo, in one place.
 *
 * Two files, one component:
 *
 *   light theme -> /HotelDarshanLOGO.jpeg    the original artwork
 *   dark theme  -> /LOGOforDARKtheme.jpeg   the dark-background artwork
 *
 * Both are served from `public/`, so they are referenced by URL rather than
 * imported. A URL resolves the same way on the dev server and in the built
 * `dist/`, needs no bundler hash, and survives a hard refresh on every route.
 * Only the file for the active theme is ever requested, so switching theme does
 * not pull both down.
 *
 * Note what this costs: a URL is not checked at build time. A file that is
 * renamed or replaced with a different extension will not fail the build - the
 * dev server quietly answers the missing path with the app's own index.html, the
 * browser is handed HTML where it expects an image, the <img> reports natural
 * width 0 and renders nothing at all. The filename here therefore has to match
 * the file in public/ exactly, extension included.
 *
 * Which one is used comes from the theme the surface is actually running, read
 * from the same ThemeContext the rest of the app themes itself from - not from a
 * hard-coded surface list, and not from a media query. That is what keeps the
 * customer app, the admin portal and anything added later agreeing with each
 * other.
 *
 * No background or container is drawn here. The component is only an <img>: any
 * box behind it belongs to the surface that renders it, so a dark-theme logo is
 * never given a light plate behind it.
 *
 * Nothing here crops, redraws or restyles the artwork. Both files are square
 * (1600x1600 and 1254x1254) and `object-contain` keeps them that way inside
 * whatever box they are given - a non-square box letterboxes rather than
 * stretching, so proportions are never distorted.
 */
import { useTheme } from '../context/ThemeContext';

export const LOGO_SRC_LIGHT = '/HotelDarshanLOGO.jpeg';
export const LOGO_SRC_DARK = '/LOGOforDARKtheme.jpeg';

/** Box sizes matching the icon tiles this logo replaces, so layout does not shift. */
const SIZES = {
  xs: 'w-8 h-8',
  sm: 'w-9 h-9',
  md: 'w-10 h-10',
  lg: 'w-14 h-14',
  xl: 'w-16 h-16',
};

/**
 * @param size    one of xs|sm|md|lg|xl, matching the old icon tile
 * @param variant 'auto' follows the active theme; 'light' or 'dark' force one.
 *                Only needed for a surface that is permanently dark and has no
 *                theme of its own to follow.
 */
export default function BrandLogo({ size = 'sm', variant = 'auto', className = '', alt = 'Hotel Darshan' }) {
  // Surfaces outside a ThemeProvider (the staff login, kitchen and rider shells)
  // have no theme of their own; they keep the original artwork, which is the
  // app's documented light default.
  const { resolvedTheme } = useTheme() || {};
  const isDark = variant === 'dark' || (variant === 'auto' && resolvedTheme === 'dark');

  const box = SIZES[size] || SIZES.sm;
  return (
    <img
      src={isDark ? LOGO_SRC_DARK : LOGO_SRC_LIGHT}
      alt={alt}
      draggable={false}
      className={`${box} object-contain shrink-0 select-none ${className}`}
    />
  );
}
