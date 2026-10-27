// Tailwind classes shared by buttons and button-like links.

const buttonBase =
  'inline-flex w-full items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-60';

export const primaryButton = `${buttonBase} bg-gradient-to-r from-violet-500 to-indigo-500 text-white hover:from-violet-400 hover:to-indigo-400`;

export const secondaryButton = `${buttonBase} border border-slate-700 text-slate-200 hover:border-slate-500 hover:bg-slate-800`;

export const textLink = 'font-medium text-violet-400 underline-offset-4 hover:underline';
