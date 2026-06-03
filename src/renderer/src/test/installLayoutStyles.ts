/**
 * Installs the minimal Tailwind layout rules isolated browser tests need when they do not boot globals.css.
 * @returns Style element that the caller removes in a finally block.
 * @example
 * const styleElement = installLayoutStyles()
 */
export function installLayoutStyles(): HTMLStyleElement {
  const styleElement = document.createElement('style')
  styleElement.textContent = `
    *, ::before, ::after { box-sizing: border-box; }
    .flex { display: flex; }
    .flex-col { flex-direction: column; }
    .flex-1 { flex: 1 1 0%; }
    .min-h-0 { min-height: 0; }
    .h-full { height: 100%; }
    .shrink-0 { flex-shrink: 0; }
    .overflow-auto { overflow: auto; }
    .p-4 { padding: 16px; }
    .px-4 { padding-left: 16px; padding-right: 16px; }
    .pt-4 { padding-top: 16px; }
    .pb-6 { padding-bottom: 24px; }
  `
  document.head.append(styleElement)
  return styleElement
}
