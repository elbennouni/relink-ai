/**
 * ReLink AI — design tokens synced from relink-web/src/index.css
 * Warm Ink palette: deep navy + soft cream + amber accent
 */

const colors = {
  light: {
    // Legacy aliases
    text: '#1B2035',
    tint: '#C97B3A',

    // Core surfaces
    background: '#F7F4EE',
    foreground: '#1B2035',

    // Cards / elevated surfaces
    card: '#FAF8F3',
    cardForeground: '#1B2035',

    // Primary action (deep ink)
    primary: '#1B2035',
    primaryForeground: '#F7F4EE',

    // Accent / guiding light (warm amber)
    accent: '#C97B3A',
    accentForeground: '#F7F4EE',

    // Secondary
    secondary: '#C97B3A',
    secondaryForeground: '#F7F4EE',

    // Muted
    muted: '#E8E4DD',
    mutedForeground: '#686F87',

    // Destructive
    destructive: '#D9493A',
    destructiveForeground: '#FFFFFF',

    // Borders and inputs
    border: '#D6CFC9',
    input: '#D6CFC9',
    ring: '#C97B3A',

    // Messaging bubbles
    bubbleMe: '#1B2035',
    bubbleMeText: '#F7F4EE',
    bubbleThem: '#FAF8F3',
    bubbleThemText: '#1B2035',
  },

  dark: {
    text: '#F7F4EE',
    tint: '#C97B3A',

    background: '#141827',
    foreground: '#F7F4EE',

    card: '#1B2035',
    cardForeground: '#F7F4EE',

    primary: '#F7F4EE',
    primaryForeground: '#1B2035',

    accent: '#C97B3A',
    accentForeground: '#1B2035',

    secondary: '#C97B3A',
    secondaryForeground: '#1B2035',

    muted: '#2C3350',
    mutedForeground: '#B8B0A5',

    destructive: '#D9493A',
    destructiveForeground: '#FFFFFF',

    border: '#2C3350',
    input: '#2C3350',
    ring: '#C97B3A',

    bubbleMe: '#C97B3A',
    bubbleMeText: '#F7F4EE',
    bubbleThem: '#1B2035',
    bubbleThemText: '#F7F4EE',
  },

  // 0.75rem = 12px (matches web --radius: 0.75rem)
  radius: 12,
};

export default colors;
