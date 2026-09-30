import type { WeaponId } from '../types';

const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

export const WEAPON_ICON: Record<WeaponId, string> = {
  hammer: svg(
    '<g transform="rotate(45 12 12)"><rect x="10.9" y="8.5" width="2.2" height="14" rx="1"/>' +
      '<path d="M6.5 3.5h11a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z"/></g>',
  ),
  cannon: svg(
    '<path d="M3.2 13.6a2.8 2.8 0 0 1 .9-3.9l12.7-6.9 2.6 4.8-12.5 7.1a2.8 2.8 0 0 1-3.7-1.1z"/>' +
      '<path d="M17.3 1.9l3.5 6.3-1.4.8-3.5-6.3z"/>' +
      '<path fill-rule="evenodd" d="M10 12.5a4.75 4.75 0 1 1 0 9.5a4.75 4.75 0 1 1 0-9.5zm0 3a1.75 1.75 0 1 0 0 3.5a1.75 1.75 0 1 0 0-3.5z"/>',
  ),
  rocket: svg(
    '<g transform="rotate(45 12 12)">' +
      '<path fill-rule="evenodd" d="M12 1.8c2.4 2 3.4 4.6 3.4 7.6v7.1H8.6V9.4c0-3 1-5.6 3.4-7.6zM12 6.2a1.3 1.3 0 1 0 0 2.6a1.3 1.3 0 1 0 0-2.6z"/>' +
      '<path d="M8.6 12.2l-2.8 3.3v3.2l2.8-1.4zM15.4 12.2l2.8 3.3v3.2l-2.8-1.4z"/>' +
      '<path d="M9.9 17.6h4.2L12 22.4z" opacity=".55"/></g>',
  ),
  charge: svg(
    '<path fill-rule="evenodd" d="M4.5 10h15a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-7A1.5 1.5 0 0 1 4.5 10zM6 12.5v5h6.5v-5zM16.7 13.6a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8z"/>' +
      '<path d="M15.5 10c0-3.2 1.3-5.3 4.3-6.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  ),
  airstrike: svg(
    '<path d="M12 1.5c.9 0 1.6 1.1 1.6 2.6v4.6l7.9 4.7v2.2l-7.9-2.4v4.9l2.6 1.9v1.8L12 20.7l-4.2 1.1V20l2.6-1.9v-4.9l-7.9 2.4v-2.2l7.9-4.7V4.1c0-1.5.7-2.6 1.6-2.6z"/>',
  ),
  thermite: svg(
    '<path d="M5 11.5h14l-1.5 8.8a1.5 1.5 0 0 1-1.5 1.2H8a1.5 1.5 0 0 1-1.5-1.2z"/><rect x="4" y="10.3" width="16" height="1.8" rx=".6"/>' +
      '<path d="M12 1.8c.6 2.2 3.4 3.6 3.4 6.3a3.4 3.4 0 0 1-6.8 0c0-1.5.9-2.4 1.6-3.2.1 1.2.7 1.9 1.4 2.1-.3-1.8.1-3.6.4-5.2z"/>' +
      '<circle cx="5" cy="6" r=".9"/><circle cx="19.2" cy="4.8" r=".8"/><circle cx="18.2" cy="8.6" r=".6"/>',
  ),
  cutter: svg(
    '<path fill-rule="evenodd" d="M3 4h18v3.2l-9 6.3-9-6.3zM7.2 7.4h9.6L12 10.8z"/>' +
      '<path d="M11.2 13.8h1.6v4.2h-1.6z" opacity=".6"/><path d="M1.5 17.5h8.5v4H1.5zM14 17.5h8.5v4H14z"/>',
  ),
  wrecker: svg(
    '<g transform="rotate(-18 12 2)"><rect x="11.3" y="1.5" width="1.4" height="8.2"/><rect x="9.8" y="8.6" width="4.4" height="2" rx=".5"/><circle cx="12" cy="16.2" r="5.8"/></g>' +
      '<path d="M2.5 12.5h3.2M1.8 15.5h4.4M2.6 18.5h3.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  ),
  winch: svg(
    '<rect x="2" y="4.5" width="2" height="10" rx=".6"/><rect x="10" y="4.5" width="2" height="10" rx=".6"/>' +
      '<path fill-rule="evenodd" d="M4 6.5h6v6H4zM4 8.3h6v.9H4zM4 10.2h6v.9H4z"/><rect x="1" y="15.5" width="12" height="2.2" rx=".6"/>' +
      '<path d="M11 6.5h8.5V13" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
      '<path d="M19.5 12.8v2.4a2.3 2.3 0 1 1-4.6 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  ),
  gravgun: svg(
    '<path d="M2 12h7l2-2.5h2v8h-2l-2-2.5H2z"/><path d="M13 9.5l3-2 .9 1.2-3 2zM13 17.5l3 2 .9-1.2-3-2z"/>' +
      '<rect x="17.5" y="11" width="5" height="5" rx=".6" transform="rotate(14 20 13.5)"/>' +
      '<path d="M15.2 10.8a4 4 0 0 1 0 5.4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>',
  ),
  incendiary: svg(
    '<path fill-rule="evenodd" d="M10 8h4v2.6c2.2.9 3.5 2.9 3.5 5.3V20a1.8 1.8 0 0 1-1.8 1.8H8.3A1.8 1.8 0 0 1 6.5 20v-4.1c0-2.4 1.3-4.4 3.5-5.3zM8 15.8h8v1.4H8z"/>' +
      '<path d="M10.3 5.8h3.4V8h-3.4z"/>' +
      '<path d="M12 .6c.5 1.4 2 2 2 3.3a2 2 0 0 1-4 0c0-.8.4-1.2.8-1.7 0 .6.3 1 .7 1.1-.1-.9.2-1.9.5-2.7z"/>',
  ),
  megabomb: svg(
    '<path fill-rule="evenodd" d="M10.5 6.2a8 8 0 1 1 0 16a8 8 0 1 1 0-16zM7.5 9.6a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8z"/>' +
      '<path d="M14.8 7.6l2.1-2.1 1.8 1.8-2.1 2.1z"/>' +
      '<path d="M17.8 6.2c.4-1.2 1-2 1.9-2.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
      '<path transform="translate(16.6 -.4) scale(.3)" d="M12 2.2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.4l-6.1 3.4 1.4-6.8L2.2 9.3l6.9-.8z"/>',
  ),
  grinder: svg(
    '<rect x="1.5" y="9" width="13" height="5" rx="2.2"/><rect x="5" y="14" width="2.4" height="4" rx=".8"/>' +
      '<path fill-rule="evenodd" d="M18 5.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13zm0 5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3z" opacity=".75"/>' +
      '<path d="M13 16.5l-1.8 3.8M15 18l-.6 4M11.5 15l-3 2.4" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>',
  ),
  saw: svg(
    '<rect x="1.5" y="8" width="8" height="8" rx="1.6"/><path d="M3 8V5.8h5V8" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
      '<path fill-rule="evenodd" d="M9.5 9.5h11a2.5 2.5 0 0 1 0 5h-11zM11.5 11.3v1.4h8.5a.7.7 0 0 0 0-1.4z"/>' +
      '<path d="M11 9l.8-1 .8 1M14 9l.8-1 .8 1M17 9l.8-1 .8 1M11 15l.8 1 .8-1M14 15l.8 1 .8-1M17 15l.8 1 .8-1"/>',
  ),
  drill: svg(
    '<rect x="1.5" y="6" width="11" height="6.5" rx="1.8"/><path d="M6 12.5h4l-.8 8.5H5.2z"/>' +
      '<rect x="12.5" y="7.6" width="3" height="3.3"/>' +
      '<path d="M15.5 8.6h7M15.5 9.9h7" fill="none" stroke="currentColor" stroke-width=".9"/>' +
      '<path d="M16.5 8l1 3M18.5 8l1 3M20.5 8l1 3" fill="none" stroke="currentColor" stroke-width=".8"/>',
  ),
  shears: svg(
    '<rect x="1" y="10" width="9" height="4.5" rx="1.2"/><circle cx="11.5" cy="12.2" r="1.8"/>' +
      '<path d="M12.2 10.6l9.6-6.4-1.2 3.4-7.2 4.6z"/><path d="M12.2 13.8l9.6 6.4-1.2-3.4-7.2-4.6z"/>' +
      '<path d="M2.5 14.5v3.5h3" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  ),
  plasma: svg(
    '<path d="M2 16.5l7-7 2.2 2.2-7 7z"/><path d="M9.3 8.7l3-3 3 3-3 3z" opacity=".8"/>' +
      '<path d="M14.4 9.6l3.2 3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M18.2 13.4l1.4 2.2-2.2-.6 3.2 3-1.2-2.4 2.4.8z"/><circle cx="19.5" cy="14.8" r="3.4" opacity=".3"/>',
  ),
  torch: svg(
    '<path d="M1.5 18.5l8.5-8.5 1.6 1.6-8.5 8.5z"/><path d="M10.2 9.4l4.6-4.6 1.4 1.4-4.6 4.6z"/>' +
      '<path d="M3 15.5c1.5-2 2.5-3.5 7.2-6.3" fill="none" stroke="currentColor" stroke-width="1.1"/>' +
      '<path d="M16.2 6.2c1.8-1.1 3.2-.8 5 .4-1.5.2-2.3.8-2.6 1.8-.6-1-1.3-1.6-2.4-2.2z"/>' +
      '<path d="M17 4.2l.9-1.5M20 4l1.2-1" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity=".7"/>',
  ),
  planner: svg(
    '<path fill-rule="evenodd" d="M3.5 8h17A1.5 1.5 0 0 1 22 9.5v10a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 19.5v-10A1.5 1.5 0 0 1 3.5 8zM4.5 10.5v4h9v-4zM17.5 14a2 2 0 1 0 0 4a2 2 0 1 0 0-4z"/>' +
      '<path d="M5.5 13.5l1.5-1.6 1.5 1 1.5-1.8 1.5 1.2" fill="none" stroke="currentColor" stroke-width=".9" opacity=".6"/>' +
      '<path d="M4 8V4.5M4 4.5h6.5M10.5 4.5l1.5 1.5M14.5 3.5h4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".75"/>',
  ),
  excavator: svg(
    '<rect x="1.5" y="17" width="11" height="3.5" rx="1.75"/><path d="M3 12.5h7.5l1 4.5H3z"/><rect x="3.5" y="9.5" width="3.5" height="3"/>' +
      '<path d="M10.5 13L16 5l5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M21 8.5l1.3 5.2-3.8.6-.9-2.8z"/>',
  ),
  breaker: svg(
    '<rect x="4" y="2" width="16" height="2.6" rx="1.3"/><rect x="10.6" y="3.5" width="2.8" height="2"/>' +
      '<path d="M8.5 5.5h7l-.5 9h-6z"/><rect x="11" y="14.5" width="2" height="5"/><path d="M11 19.5h2L12 22.5z"/>' +
      '<path d="M5 20l2.5-1.2M19 20l-2.5-1.2M6 22.5l2.5-.4M18 22.5l-2.5-.4" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity=".7"/>',
  ),
  hose: svg(
    '<path d="M2 18.5a3 3 0 0 1 3-3h2.5v-3.5h3v6.5H5a.5.5 0 0 0-.5.5v3H2z"/><path d="M8.5 12l6.5-3.5 1 2-6.5 3.5z"/>' +
      '<path d="M16.5 8.5c2 .2 3.5 1 4.5 2.6M16.8 10.8c1.6.5 2.8 1.4 3.6 2.9M16.4 6.4c1.9-.3 3.6.1 5 1.2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-dasharray="1.4 1.6"/>',
  ),
  splitter: svg(
    '<path fill-rule="evenodd" d="M2 12.5h9v9H2zM13 12.5h9v9h-9z"/><path d="M11 12.5h2v9h-2z" opacity=".35"/>' +
      '<path d="M10.2 2h3.6v4.5l-.8 7h-2l-.8-7z"/><path d="M11.2 13.5L12 22l.8-8.5z" opacity=".8"/>' +
      '<path d="M7 11l1.2-2.2M17 11l-1.2-2.2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  ),
  wiresaw: svg(
    '<rect x="9" y="3" width="7" height="18" rx=".6" opacity=".45"/>' +
      '<path d="M8 11.5h9v2H8z"/><circle cx="4" cy="12.5" r="2.8"/>' +
      '<path d="M4 9.7L8 11.5M4 15.3L8 13.5M17 11.5c3.2 0 3.2 2 0 2" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
      '<circle cx="4" cy="12.5" r="1" fill="#000" opacity=".4"/>',
  ),
  grapple: svg(
    '<path d="M1.5 17.5l8.2-4.7 1.3 2.2-8.2 4.7z"/><rect x="3.2" y="18" width="2.2" height="4" rx=".5" transform="rotate(-30 4.3 20)"/>' +
      '<path d="M11 13.7C14 11 16 8 18.2 4.6" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="1.6 1.2"/>' +
      '<path d="M18.2 4.6l1-3M18.2 4.6c1.8-.4 3.2.4 3.8 1.8M18.2 4.6c-1.6-1-3.2-.9-4.2.2M18.2 4.6c.4 1.8 1.6 2.8 3.1 2.9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  ),
  tether: svg(
    '<circle cx="4" cy="6" r="2.3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="20" cy="9" r="2.3" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
      '<path d="M5.8 7.6C9 15.5 14.5 16 18.3 10.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M3 21h18" stroke="currentColor" stroke-width="1.4" opacity=".5"/><path d="M12 15.3v5.7" stroke="currentColor" stroke-width="1.1" stroke-dasharray="1.2 1" opacity=".6"/>',
  ),
  hoist: svg(
    '<path d="M12 1.5a1.6 1.6 0 1 1 0 3.2" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="8" y="5" width="8" height="7" rx="1.2"/>' +
      '<circle cx="12" cy="8.5" r="2" fill="#000" opacity=".35"/><path d="M13.5 7.5L21 2.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M11 12.5v1.6M13 14.4v1.6M11 16.3v1.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
      '<path d="M12 18.4v1.4a1.9 1.9 0 1 1-3.4 1.1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  ),
};

export const STAR = svg('<path d="M12 2.2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.4l-6.1 3.4 1.4-6.8L2.2 9.3l6.9-.8z"/>');

export const SEARCH = svg(
  '<path fill-rule="evenodd" d="M10.5 3a7.5 7.5 0 0 1 6 12l4.8 4.8-1.6 1.6-4.8-4.8A7.5 7.5 0 1 1 10.5 3zm0 2.4a5.1 5.1 0 1 0 0 10.2a5.1 5.1 0 1 0 0-10.2z"/>',
);

export const LOCK = svg(
  '<path fill-rule="evenodd" d="M7 10V7.5a5 5 0 0 1 10 0V10h1.5A1.5 1.5 0 0 1 20 11.5v9A1.5 1.5 0 0 1 18.5 22h-13A1.5 1.5 0 0 1 4 20.5v-9A1.5 1.5 0 0 1 5.5 10zm2.5 0h5V7.5a2.5 2.5 0 0 0-5 0z"/>',
);

export const MOUSE = svg(
  '<path fill-rule="evenodd" d="M12 2a6 6 0 0 1 6 6v8a6 6 0 0 1-12 0V8a6 6 0 0 1 6-6zM12 4a4 4 0 0 0-4 4v8a4 4 0 0 0 8 0V8a4 4 0 0 0-4-4z"/>' +
    '<rect x="11" y="6" width="2" height="4" rx="1"/>',
);

export const WARN = svg('<path fill-rule="evenodd" d="M12 2.5l10.5 18.5h-21zM11 9v6h2V9zm0 7.5v2h2v-2z"/>');
