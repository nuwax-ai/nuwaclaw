declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          partition?: string;
          allowpopups?: string;
          preload?: string;
          httpreferrer?: string;
          useragent?: string;
        },
        HTMLElement
      >;
    }
  }
}

export {};
