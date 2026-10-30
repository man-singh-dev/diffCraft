// Tailwind classes shared by buttons and button-like links.

const buttonBase =
  'inline-flex w-full items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-60';

export const primaryButton = `${buttonBase} bg-gradient-to-r from-violet-500 to-indigo-500 text-white hover:from-violet-400 hover:to-indigo-400`;

export const secondaryButton = `${buttonBase} border border-slate-700 text-slate-200 hover:border-slate-500 hover:bg-slate-800`;

export const textLink = 'font-medium text-violet-400 underline-offset-4 hover:underline';

export const dangerButton = `${buttonBase} border border-red-800 bg-red-950/40 text-red-200 hover:border-red-600 hover:bg-red-900/50`;

// Compact buttons for controls inside a list row.
const smallButtonBase =
  'inline-flex items-center justify-center rounded-md px-2.5 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-60';

export const smallSecondaryButton = `${smallButtonBase} border border-slate-700 text-slate-200 hover:border-slate-500 hover:bg-slate-800`;

export const smallDangerButton = `${smallButtonBase} border border-red-800 text-red-300 hover:border-red-600 hover:bg-red-950/60`;

export const inputClass =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30 aria-invalid:border-red-500 disabled:opacity-60';
